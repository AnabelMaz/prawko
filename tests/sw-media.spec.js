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

test('service worker serves cached station media and lets uncached files pass through', () => {
  expect(SW).toMatch(/function isStationMediaUrl\(url\)/);
  expect(SW).toMatch(/if \(isStationMediaUrl\(url\)\) \{/);
  expect(SW).toMatch(/if \(remoteMediaCached\(url\.href\)\) \{/);
  expect(SW).toMatch(/event\.respondWith\(respondFromStationCache\(event, url\)\)/);
  expect(SW).not.toMatch(/passThroughAndAssemble/);
  expect(SW).not.toMatch(/isAssemblableVideo/);
  expect(SW).not.toMatch(/shouldAssembleVideo/);
});

test('service worker answers player Range from a cached full video', () => {
  expect(SW).toMatch(/serveCachedMedia\(cached, event\.request\)/);
  expect(SW).toMatch(/playerRangeReply/);
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
  expect(block).toMatch(/respondFromStationCache/);
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
