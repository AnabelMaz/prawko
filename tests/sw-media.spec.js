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

test('service worker serves packed local /media/ and only intercepts uncached videos to assemble', () => {
  const block = handlerBlock(
    'if (url.pathname.match(/\\/media\\//))',
    "if (url.pathname.includes('/icons/') || url.pathname.includes('/fonts/'))"
  );
  expect(block).toMatch(/if \(remoteMediaCached\(url\.href\)\) \{/);
  expect(block).toMatch(/if \(isAssemblableVideo\(url\)\) \{/);
  expect(block).toMatch(/passThroughAndAssemble\(event\)/);
  expect(block).not.toMatch(/safeCachePut/);
});

test('service worker serves packed CDN media and only intercepts uncached videos to assemble', () => {
  const block = handlerBlock(
    'if (url.origin !== self.location.origin)',
    '// Category JSON & translation files'
  );
  expect(block).toMatch(/if \(indexReady && !known\) \{/);
  expect(block).toMatch(/if \(isAssemblableVideo\(url\)\) event\.respondWith\(passThroughAndAssemble\(event\)\)/);
  expect(block).toMatch(/if \(isAssemblableVideo\(url\)\) return passThroughAndAssemble\(event\)/);
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
