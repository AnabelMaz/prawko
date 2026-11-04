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

test('service worker stores the player response and does not copy this computer disk', () => {
  expect(SW).toMatch(/function isStationMediaUrl\(url\)/);
  expect(SW).toMatch(/function viewedMediaStaysOnDisk\(url\)/);
  expect(SW).toMatch(/if \(isStationMediaUrl\(url\)\) \{/);
  expect(SW).toMatch(/if \(!viewedMediaStaysOnDisk\(url\)\) event\.respondWith\(fetchAndRememberMedia\(event, url\)\)/);
  const remember = SW.slice(SW.indexOf('async function fetchAndRememberMedia'), SW.indexOf('function isStationMediaUrl'));
  expect(remember).toMatch(/res\.clone\(\)/);
  expect(remember).toMatch(/rememberPlayedMedia/);
  expect(remember).toMatch(/return res/);
  const disk = SW.slice(SW.indexOf('function viewedMediaStaysOnDisk'), SW.indexOf('function playedMediaKind'));
  expect(disk).toMatch(/isLoopbackHostName/);
  expect(disk).toMatch(/\\\/media\\\//);
  expect(SW).toMatch(/host === 'localhost'/);
  expect(SW).not.toMatch(/passThroughAndAssemble/);
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
});

test('service worker clones the app-shell response before opening the cache', () => {
  const block = handlerBlock(
    '// App shell — network first',
    "self.addEventListener('message'"
  );
  expect(block).toMatch(/const copy = response\.clone\(\);/);
  expect(block).toMatch(/safeCachePut\(cache, event\.request, copy\)/);
  expect(block).not.toMatch(/caches\.open\(APP_SHELL_CACHE\)\.then\(\(cache\) => \{\s*safeCachePut\(cache, event\.request, response\.clone\(\)/);
});
