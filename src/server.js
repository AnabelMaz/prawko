#!/usr/bin/env node
'use strict';

const fs = require('fs');
const http = require('http');
const https = require('https');
const path = require('path');
const { URL } = require('url');

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.webp': 'image/webp',
  '.gif': 'image/gif',
  '.ico': 'image/x-icon',
  '.woff': 'font/woff',
  '.woff2': 'font/woff2',
  '.ttf': 'font/ttf',
  '.mp4': 'video/mp4',
  '.webm': 'video/webm',
  '.map': 'application/json',
};

function argValue(name, fallback) {
  const i = process.argv.indexOf(name);
  if (i >= 0 && process.argv[i + 1]) return process.argv[i + 1];
  return fallback;
}

const root = path.resolve(argValue('--root', process.cwd()));
const httpPort = Number(argValue('--http-port', process.env.PRAWKO_HTTP_PORT || 5173));
const httpsPort = Number(argValue('--https-port', process.env.PRAWKO_HTTPS_PORT || 5174));
const certDir = path.resolve(argValue('--cert-dir', path.join(root, '..', 'certs')));
const certPath = argValue('--cert', path.join(certDir, 'tls.crt'));
const keyPath = argValue('--key', path.join(certDir, 'tls.key'));
const pfxPath = argValue('--pfx', path.join(certDir, 'tls.pfx'));
const pfxPassPath = path.join(certDir, 'tls.pass');

function httpsRedirectEnabled() {
  const file = path.join(root, 'local.json');
  try {
    if (!fs.existsSync(file)) return true;
    const parsed = JSON.parse(fs.readFileSync(file, 'utf8'));
    if (!parsed || typeof parsed !== 'object') return true;
    return parsed.httpsRedirect !== false;
  } catch {
    return true;
  }
}

function loadTls() {
  try {
    if (fs.existsSync(certPath) && fs.existsSync(keyPath)) {
      return {
        cert: fs.readFileSync(certPath),
        key: fs.readFileSync(keyPath),
      };
    }
    if (fs.existsSync(pfxPath)) {
      let passphrase = argValue('--pass', '');
      if (!passphrase && fs.existsSync(pfxPassPath)) {
        passphrase = fs.readFileSync(pfxPassPath, 'utf8').trim();
      }
      return { pfx: fs.readFileSync(pfxPath), passphrase };
    }
  } catch (err) {
    console.error('TLS files unreadable:', err.message);
  }
  console.error(`HTTPS off: no tls.crt+tls.key or tls.pfx in ${certDir}`);
  return null;
}

function redirectUrl(req, port) {
  const raw = String(req.headers.host || 'localhost');
  let host = raw;
  if (raw.startsWith('[')) {
    const end = raw.indexOf(']');
    host = end >= 0 ? raw.slice(0, end + 1) : raw;
  } else {
    host = raw.split(':')[0] || 'localhost';
  }
  const pathAndQuery = req.url && req.url.startsWith('/') ? req.url : `/${req.url || ''}`;
  return `https://${host}:${port}${pathAndQuery}`;
}

function safeJoin(base, rel) {
  const decoded = decodeURIComponent(rel.split('?')[0]);
  const resolved = path.resolve(base, '.' + decoded);
  const rootResolved = path.resolve(base);
  if (resolved !== rootResolved && !resolved.startsWith(rootResolved + path.sep)) return null;
  return resolved;
}

function sendFile(req, res, file) {
  const stat = fs.statSync(file);
  const ext = path.extname(file).toLowerCase();
  const type = MIME[ext] || 'application/octet-stream';
  const headers = { 'Content-Type': type };
  if (/\.(html|js|css)$/i.test(ext)) headers['Cache-Control'] = 'no-cache';
  const range = req.headers.range;
  if (range && /^bytes=/i.test(range)) {
    const m = /^bytes=(\d*)-(\d*)$/.exec(range.trim());
    if (m) {
      const start = m[1] ? Number(m[1]) : 0;
      const end = m[2] ? Number(m[2]) : stat.size - 1;
      if (start <= end && start < stat.size) {
        const to = Math.min(end, stat.size - 1);
        headers['Content-Range'] = `bytes ${start}-${to}/${stat.size}`;
        headers['Accept-Ranges'] = 'bytes';
        headers['Content-Length'] = String(to - start + 1);
        res.writeHead(206, headers);
        fs.createReadStream(file, { start, end: to }).pipe(res);
        return;
      }
    }
  }
  headers['Content-Length'] = String(stat.size);
  headers['Accept-Ranges'] = 'bytes';
  res.writeHead(200, headers);
  fs.createReadStream(file).pipe(res);
}

function serveStatic(req, res) {
  if (req.method !== 'GET' && req.method !== 'HEAD') {
    res.writeHead(405, { Allow: 'GET, HEAD' });
    res.end();
    return;
  }
  let pathname = '/';
  try {
    pathname = new URL(req.url, 'http://127.0.0.1').pathname;
  } catch {
    res.writeHead(400);
    res.end();
    return;
  }
  if (pathname === '/') pathname = '/index.html';
  const file = safeJoin(root, pathname);
  if (!file) {
    res.writeHead(400);
    res.end();
    return;
  }
  if (fs.existsSync(file) && fs.statSync(file).isFile()) {
    if (req.method === 'HEAD') {
      const ext = path.extname(file).toLowerCase();
      res.writeHead(200, { 'Content-Type': MIME[ext] || 'application/octet-stream' });
      res.end();
      return;
    }
    sendFile(req, res, file);
    return;
  }
  const index = path.join(root, 'index.html');
  if (fs.existsSync(index)) {
    sendFile(req, res, index);
    return;
  }
  res.writeHead(404);
  res.end('Not found');
}

function httpHandler(tlsOn) {
  return (req, res) => {
    if (tlsOn && httpsRedirectEnabled()) {
      const loc = redirectUrl(req, httpsPort);
      res.writeHead(302, {
        Location: loc,
        'Cache-Control': 'no-store',
      });
      res.end();
      return;
    }
    serveStatic(req, res);
  };
}

const tls = loadTls();
const httpServer = http.createServer(httpHandler(Boolean(tls)));
httpServer.listen(httpPort, '0.0.0.0', () => {
  console.log(`Prawko HTTP http://0.0.0.0:${httpPort}  root=${root}`);
  if (tls) {
    console.log(`HTTP→HTTPS redirect ${httpsRedirectEnabled() ? 'on' : 'off'} (local.json httpsRedirect)`);
  }
});

if (tls) {
  const httpsServer = https.createServer(tls, serveStatic);
  httpsServer.listen(httpsPort, '0.0.0.0', () => {
    console.log(`Prawko HTTPS https://0.0.0.0:${httpsPort}`);
  });
  httpsServer.on('error', (err) => {
    console.error('HTTPS listen failed:', err.message);
  });
}
