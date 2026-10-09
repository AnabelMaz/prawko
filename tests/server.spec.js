const { test, expect } = require('@playwright/test');
const { spawn } = require('child_process');
const fs = require('fs');
const http = require('http');
const https = require('https');
const path = require('path');
const os = require('os');

const ROOT = path.join(__dirname, '..');
const FIX = path.join(__dirname, 'fixtures', 'https');

function req(url, { method = 'GET', follow = false, rejectUnauthorized = false } = {}) {
  return new Promise((resolve, reject) => {
    const lib = url.startsWith('https:') ? https : http;
    const req = lib.request(url, { method, rejectUnauthorized }, (res) => {
      const chunks = [];
      res.on('data', (c) => chunks.push(c));
      res.on('end', () => {
        resolve({
          status: res.statusCode,
          location: res.headers.location || '',
          body: Buffer.concat(chunks).toString('utf8'),
        });
      });
    });
    req.on('error', reject);
    req.end();
    void follow;
  });
}

function waitPort(child, needle, ms = 8000) {
  return new Promise((resolve, reject) => {
    let buf = '';
    const t = setTimeout(() => reject(new Error(`server start timeout: ${buf}`)), ms);
    const onData = (chunk) => {
      buf += String(chunk);
      if (buf.includes(needle)) {
        clearTimeout(t);
        child.stdout.off('data', onData);
        child.stderr.off('data', onData);
        resolve(buf);
      }
    };
    child.stdout.on('data', onData);
    child.stderr.on('data', onData);
  });
}

async function startServer(dir, extra = []) {
  const child = spawn(process.execPath, [
    path.join(ROOT, 'src', 'server.js'),
    '--root', dir,
    '--http-port', '18081',
    '--https-port', '18443',
    '--cert', path.join(FIX, 'tls.crt'),
    '--key', path.join(FIX, 'tls.key'),
    ...extra,
  ], { cwd: dir, stdio: ['ignore', 'pipe', 'pipe'] });
  await waitPort(child, 'Prawko HTTPS');
  return child;
}

function writeLocal(dir, obj) {
  fs.writeFileSync(path.join(dir, 'local.json'), `${JSON.stringify(obj)}\n`);
}

test.describe('Prawko HTTP/HTTPS server', () => {
  /** @type {import('child_process').ChildProcess} */
  let child;
  let dir;

  test.beforeAll(async () => {
    dir = fs.mkdtempSync(path.join(os.tmpdir(), 'prawko-srv-'));
    fs.writeFileSync(path.join(dir, 'index.html'), '<!doctype html><title>Prawko</title>ok');
    fs.mkdirSync(path.join(dir, 'data'));
    fs.writeFileSync(path.join(dir, 'data', 'meta.json'), '{"ok":true}');
    writeLocal(dir, { mediaBase: 'media', httpsRedirect: true });
    child = await startServer(dir);
  });

  test.afterAll(async () => {
    if (child) child.kill();
  });

  test('HTTP redirects any path and query to HTTPS', async () => {
    const a = await req('http://127.0.0.1:18081/foo/bar?x=1#ignored');
    expect(a.status).toBe(302);
    expect(a.location).toBe('https://127.0.0.1:18443/foo/bar?x=1');
    const b = await req('http://127.0.0.1:18081/');
    expect(b.status).toBe(302);
    expect(b.location).toBe('https://127.0.0.1:18443/');
    const c = await req('http://127.0.0.1:18081/data/meta.json');
    expect(c.status).toBe(302);
    expect(c.location).toBe('https://127.0.0.1:18443/data/meta.json');
    const head = await req('http://127.0.0.1:18081/anywhere', { method: 'HEAD' });
    expect(head.status).toBe(302);
    expect(head.location).toBe('https://127.0.0.1:18443/anywhere');
  });

  test('HTTPS serves files', async () => {
    const res = await req('https://127.0.0.1:18443/');
    expect(res.status).toBe(200);
    expect(res.body).toContain('Prawko');
    const json = await req('https://127.0.0.1:18443/data/meta.json');
    expect(json.status).toBe(200);
    expect(json.body).toContain('"ok":true');
  });

  test('httpsRedirect false serves HTTP without jumping', async () => {
    writeLocal(dir, { mediaBase: 'media', httpsRedirect: false });
    const res = await req('http://127.0.0.1:18081/data/meta.json');
    expect(res.status).toBe(200);
    expect(res.body).toContain('"ok":true');
    writeLocal(dir, { mediaBase: 'media', httpsRedirect: true });
    const back = await req('http://127.0.0.1:18081/still/here');
    expect(back.status).toBe(302);
    expect(back.location).toBe('https://127.0.0.1:18443/still/here');
  });

  test('missing or broken local.json still redirects when HTTPS is up', async () => {
    fs.unlinkSync(path.join(dir, 'local.json'));
    const missing = await req('http://127.0.0.1:18081/gone');
    expect(missing.status).toBe(302);
    expect(missing.location).toBe('https://127.0.0.1:18443/gone');
    fs.writeFileSync(path.join(dir, 'local.json'), '{not-json');
    const broken = await req('http://127.0.0.1:18081/broke?x=1');
    expect(broken.status).toBe(302);
    expect(broken.location).toBe('https://127.0.0.1:18443/broke?x=1');
    writeLocal(dir, { httpsRedirect: true });
  });
});
