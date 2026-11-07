const { test, expect } = require('@playwright/test');
const fs = require('fs');
const path = require('path');

const SW = fs.readFileSync(path.join(__dirname, '..', 'src', 'sw.js'), 'utf8');

function handlerBlock(marker, nextMarker) {
  const start = SW.indexOf(marker);
  expect(start, `missing ${marker}`).toBeGreaterThan(-1);
  const from = SW.slice(start);
  const end = from.indexOf(nextMarker);
  expect(end, `missing ${nextMarker} after ${marker}`).toBeGreaterThan(-1);
  return from.slice(0, end);
}

test('service worker serves stored media, remembers viewed misses, skips this computer disk', () => {
  expect(SW).toMatch(/function isStationMediaUrl\(url\)/);
  expect(SW).toMatch(/function viewedMediaStaysOnDisk\(url\)/);
  expect(SW).toMatch(/if \(isStationMediaUrl\(url\)\) \{/);
  expect(SW).toMatch(/if \(!viewedMediaStaysOnDisk\(url\)\) event\.respondWith\(fetchAndRememberMedia\(event, url\)\)/);
  const pass = SW.slice(SW.indexOf('async function fetchAndRememberMedia'), SW.indexOf('function isStationMediaUrl'));
  expect(pass).toMatch(/matchOfflineMedia/);
  expect(pass).toMatch(/serveCachedMedia/);
  expect(pass).toMatch(/rememberPlayedMedia/);
  expect(pass).toMatch(/return res/);
  expect(SW).toMatch(/function isLoopbackHostName\(host\)/);
  const disk = SW.slice(SW.indexOf('function viewedMediaStaysOnDisk'), SW.indexOf('function playedMediaKind'));
  expect(disk).toMatch(/isLoopbackHostName\(self\.location\.hostname\)/);
  expect(disk).toMatch(/url\.origin === self\.location\.origin/);
  expect(disk).toMatch(/\\\/media\\\//);
  expect(SW).toMatch(/rememberPlayedMedia/);
  expect(SW).toMatch(/playedMediaAssembler/);
});

test('service worker answers player Range from a cached full video', () => {
  expect(SW).toMatch(/serveCachedMedia\(cached, event\.request\)/);
  const start = SW.indexOf('async function serveCachedMedia');
  expect(start).toBeGreaterThan(-1);
  const block = SW.slice(start, SW.indexOf('async function matchOfflineMedia', start));
  expect(block).toMatch(/parseRequestRange/);
  expect(block).toMatch(/blob\.slice/);
  expect(block).toMatch(/Content-Range/);
  expect(block).not.toMatch(/arrayBuffer\(\)/);
});

test('service worker matches cached video by URL, not the player Range request', () => {
  const start = SW.indexOf('async function matchOfflineMedia');
  expect(start).toBeGreaterThan(-1);
  const block = SW.slice(start, SW.indexOf('self.addEventListener(\'fetch\'', start));
  expect(block).toMatch(/videoAssemblyKey/);
  expect(block).not.toMatch(/cache\.match\(request/);
  // Exact URL match only — skipping query on match is an O(N) scan on large caches in Chrome.
  expect(block).not.toMatch(/ignoreSearch\s*:/);
  expect(block).not.toMatch(/ignoreVary\s*:/);
  expect(block).toMatch(/cache\.match\(url\)/);
});

test('service worker treats CDN and /media/ as one cached-media path', () => {
  const start = SW.indexOf('function isStationMediaUrl');
  expect(start).toBeGreaterThan(-1);
  const block = SW.slice(start, SW.indexOf('self.addEventListener(\'fetch\'', start));
  expect(block).toMatch(/url\.origin !== self\.location\.origin/);
  expect(block).toMatch(/\\\/media\\\//);
  const fetchBlock = SW.slice(SW.indexOf("self.addEventListener('fetch'"));
  expect(fetchBlock).toMatch(/isStationMediaUrl\(url\)/);
  expect(fetchBlock).toMatch(/fetchAndRememberMedia\(event, url\)/);
});

test('service worker precaches the local Noto mark font and cache-firsts /fonts/', () => {
  expect(SW).toMatch(/\.\/fonts\/NotoSansSymbols-Regular\.ttf/);
  expect(SW).toMatch(/url\.pathname\.includes\('\/fonts\/'\)/);
  expect(SW).toMatch(/url\.pathname\.includes\('\/icons\/'\)/);
  // Offline miss must not reject (no ERR_INTERNET_DISCONNECTED spam for cursors).
  const iconsBlock = SW.slice(
    SW.indexOf("url.pathname.includes('/icons/')"),
    SW.indexOf('// App shell — online:'),
  );
  expect(iconsBlock).toMatch(/catch\s*\{/);
  expect(iconsBlock).toMatch(/status: 404/);
});

test('service worker serves app shell from cache when offline without fetch', () => {
  const block = handlerBlock(
    '// App shell — online:',
    "self.addEventListener('message'"
  );
  expect(block).toMatch(/navigator\.onLine === false/);
  expect(block).toMatch(/safeCachePut\(cache, event\.request, response\.clone\(\)/);
  expect(block).toMatch(/await fetch\(event\.request\)/);
});
