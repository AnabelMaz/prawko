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

test('service worker lets local /media/ pass through unless the offline pack has the file', () => {
  const block = handlerBlock(
    'if (url.pathname.match(/\\/media\\//))',
    "if (url.pathname.includes('/icons/'))"
  );
  expect(block).toMatch(/if \(!remoteMediaCached\(url\.href\)\) return;/);
  expect(block).not.toMatch(/safeCachePut/);
});

test('service worker lets CDN media pass through unless the offline pack has the file', () => {
  const block = handlerBlock(
    'if (url.origin !== self.location.origin)',
    '// Category JSON & translation files'
  );
  expect(block).toMatch(/if \(indexReady && !remoteMediaCached\(url\.href\)\) return;/);
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
