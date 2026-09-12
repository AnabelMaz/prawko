const { test, expect } = require('@playwright/test');
const { goToCategories } = require('./helpers');

async function openCategories(page) {
  await page.goto('/');
  await goToCategories(page);
  await page.waitForSelector('.category-grid .category-card[data-category="B"] .offline-btn');
}

async function stubRemoteMedia(page) {
  await page.route('**/local.json', async (route) => {
    await route.fulfill({ status: 200, contentType: 'application/json', body: '{}' });
  });
  await page.route('**/js/data.js', async (route) => {
    const response = await route.fetch();
    const body = (await response.text()).replace(
        /export let MEDIA_BASE = [^;]+;/,
        "export let MEDIA_BASE = 'https://cdn.example.test/prawko';"
    );
    await route.fulfill({
      status: 200,
      contentType: 'text/javascript',
      body,
    });
  });
}

async function fakeOffline(page) {
  await page.evaluate(() => {
    Object.defineProperty(navigator, 'onLine', { configurable: true, get: () => false });
    window.dispatchEvent(new Event('offline'));
  });
}

test.describe('Category media access', () => {
  test('access matrix covers local, downloaded, online, and blocked', async ({ page }) => {
    await page.goto('/');
    await page.waitForSelector('#home.active');
    const table = await page.evaluate(async () => {
      const { getCategoryMediaAccess } = await import(new URL('./js/offline.js', location.href).href);
      const cases = [
        { localMedia: true, downloaded: false, online: false },
        { localMedia: true, loopback: false, downloaded: false, online: true },
        { localMedia: true, loopback: false, downloaded: false, online: false },
        { localMedia: false, downloaded: true, online: false },
        { localMedia: false, downloaded: false, online: true },
        { localMedia: false, downloaded: false, online: false },
      ];
      return cases.map((opts) => {
        const set = new Set(opts.downloaded ? ['B'] : []);
        return { ...opts, ...getCategoryMediaAccess('B', set, opts) };
      });
    });
    expect(table[0]).toMatchObject({ available: true, offlineReady: true, canDownload: false });
    expect(table[1]).toMatchObject({ available: true, offlineReady: false, canDownload: true });
    expect(table[2]).toMatchObject({ available: false, offlineReady: false, canDownload: false });
    expect(table[3]).toMatchObject({ available: true, offlineReady: true, canDownload: false });
    expect(table[4]).toMatchObject({ available: true, offlineReady: false, canDownload: true });
    expect(table[5]).toMatchObject({ available: false, offlineReady: false, canDownload: false });
  });

  test('local.json mediaBase cdn treats this host like github.io', async ({ page }) => {
    await page.route('**/local.json', async (route) => {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({ mediaBase: 'cdn' }),
      });
    });
    await openCategories(page);
    await expect(page.locator('html')).toHaveAttribute('data-local-media', 'false');
    await expect(page.locator('.category-grid .category-card[data-category="B"] .offline-btn')).toContainText(/Pobierz offline|Save offline/);
  });

  test('local media URLs stay on this origin and skip Backblaze and R2', async ({ page }) => {
    await page.route('**/local.json', async (route) => {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({ mediaBase: 'media' }),
      });
    });
    await page.goto('/');
    await page.waitForSelector('#home.active');
    const urls = await page.evaluate(async () => {
      const { getMediaUrls, usesLocalMedia, OFFLINE_DOWNLOAD } = await import(new URL('./js/data.js', location.href).href);
      return {
        local: usesLocalMedia(),
        offline: OFFLINE_DOWNLOAD,
        img: getMediaUrls('foo.webp', 'image'),
        vid: getMediaUrls('bar.mp4', 'video'),
      };
    });
    expect(urls.local).toBe(true);
    expect(urls.offline).toBe('files');
    expect(urls.img.join(' ')).toMatch(/media\/img\//);
    expect(urls.vid.join(' ')).toMatch(/media\/vid\//);
    expect(urls.img.join(' ')).not.toMatch(/backblaze|r2\.dev/i);
    expect(urls.vid.join(' ')).not.toMatch(/backblaze|r2\.dev/i);
    await expect(page.locator('html')).toHaveAttribute('data-local-media', 'true');
  });

  test('local.json is applied even when the page is not named localhost', async () => {
    const fs = require('fs');
    const path = require('path');
    const src = fs.readFileSync(path.join(__dirname, '..', 'src', 'js', 'data.js'), 'utf8');
    expect(src).not.toMatch(/isLocalDevHost/);
    expect(src).toMatch(/hostedOnGitHubPages/);
    expect(src).toMatch(/fetch\(new URL\('local\.json'/);
  });

  test('local media marks every category available offline', async ({ page }) => {
    await openCategories(page);
    const local = await page.locator('html').getAttribute('data-local-media');
    test.skip(local !== 'true', 'this server uses remote CDN media');

    const cards = page.locator('.category-grid .category-card');
    await expect(cards.first().locator('.offline-btn')).toHaveClass(/downloaded/);
    await expect(cards.first().locator('.offline-btn')).toContainText(/Dostępne offline|Available offline/);
    await expect(page.locator('.category-grid .category-card.category-unavailable')).toHaveCount(0);

    await fakeOffline(page);
    await expect(page.locator('.category-grid .category-card[data-category="B"]')).toHaveAttribute('data-media-access', 'offline');
    await expect(page.locator('.category-grid .category-card.category-unavailable')).toHaveCount(0);
    await page.click('.category-grid .category-card[data-category="B"]');
    await expect(page.locator('#quiz.active')).toBeVisible();
  });

  test('remote media stays usable online and greys out when offline', async ({ page }) => {
    await stubRemoteMedia(page);
    await openCategories(page);

    const card = page.locator('.category-grid .category-card[data-category="B"]');
    await expect(page.locator('html')).toHaveAttribute('data-local-media', 'false');
    await expect(card).toHaveAttribute('data-media-access', 'online');
    await expect(card).not.toHaveClass(/category-unavailable/);
    await expect(card.locator('.offline-btn')).toContainText(/Pobierz offline|Save offline/);

    await fakeOffline(page);
    await expect(card).toHaveClass(/category-unavailable/);
    await expect(card).toHaveAttribute('data-media-access', 'blocked');
    await expect(card.locator('.offline-btn')).toContainText(/Niedostępne offline|Unavailable offline/);

    await page.locator('.category-grid .category-card[data-category="B"]').click({ force: true });
    await expect(page.locator('#categories.active')).toBeVisible();
    await expect(page.locator('#quiz.active')).toHaveCount(0);
  });

  test('a downloaded remote category stays available while others grey out', async ({ page }) => {
    await page.addInitScript(() => {
      localStorage.setItem('prawko_offline', JSON.stringify(['B']));
      localStorage.setItem('prawko_offline_manifest', JSON.stringify({ B: [] }));
    });
    await stubRemoteMedia(page);
    await openCategories(page);
    await fakeOffline(page);

    const b = page.locator('.category-grid .category-card[data-category="B"]');
    const c = page.locator('.category-grid .category-card[data-category="C"]');
    await expect(b).toHaveAttribute('data-media-access', 'offline');
    await expect(b).not.toHaveClass(/category-unavailable/);
    await expect(b.locator('.offline-btn')).toHaveClass(/downloaded/);
    await expect(c).toHaveClass(/category-unavailable/);
    await expect(c).toHaveAttribute('data-media-access', 'blocked');
  });

  test('coverage math maps cache hits to 0–100 and red–green hue', async ({ page }) => {
    await page.goto('/');
    await page.waitForSelector('#home.active');
    const result = await page.evaluate(async () => {
      const { coverageFromUrls, offlineCoverageHue } = await import(new URL('./js/offline.js', location.href).href);
      const cached = new Set(['foo.webp', 'https://cdn.example.test/img/bar.webp']);
      return {
        empty: coverageFromUrls([], cached),
        none: coverageFromUrls(['https://cdn.example.test/img/missing.webp'], cached),
        half: coverageFromUrls(
          ['https://cdn.example.test/img/foo.webp', 'https://cdn.example.test/img/missing.webp'],
          cached
        ),
        all: coverageFromUrls(['https://cdn.example.test/img/foo.webp', 'https://cdn.example.test/img/bar.webp'], cached),
        hue0: offlineCoverageHue(0),
        hue50: offlineCoverageHue(50),
        hue100: offlineCoverageHue(100),
      };
    });
    expect(result.empty).toMatchObject({ have: 0, total: 0, pct: 100 });
    expect(result.none).toMatchObject({ have: 0, total: 1, pct: 0 });
    expect(result.half).toMatchObject({ have: 1, total: 2, pct: 50 });
    expect(result.all).toMatchObject({ have: 2, total: 2, pct: 100 });
    expect(result.hue0).toBe(0);
    expect(result.hue50).toBe(60);
    expect(result.hue100).toBe(120);
  });

  test('file-mode coverage counts shared question media, not zip packs', async ({ page }) => {
    await stubRemoteMedia(page);
    await page.goto('/');
    await page.waitForSelector('#home.active');
    const result = await page.evaluate(async () => {
      const { getMediaUrls } = await import(new URL('./js/data.js', location.href).href);
      const { getCategoriesOfflineCoverage } = await import(new URL('./js/offline.js', location.href).href);
      const [bankB, bankA] = await Promise.all([
        fetch('data/B.json').then((res) => res.json()),
        fetch('data/A.json').then((res) => res.json()),
      ]);
      const bMedia = new Map();
      for (const q of bankB.questions || []) {
        if (q.media) bMedia.set(String(q.media), q.mediaType);
      }
      const aMedia = new Set();
      for (const q of bankA.questions || []) {
        if (q.media) aMedia.add(String(q.media));
      }
      const shared = [...bMedia.entries()].filter(([name]) => aMedia.has(name));
      if (!shared.length) return { shared: false };
      const cache = await caches.open('prawko-offline-media-v1');
      for (const [name, mediaType] of shared) {
        const urls = getMediaUrls(name, mediaType);
        await cache.put(
          new Request(urls[0], { mode: 'cors' }),
          new Response(new Uint8Array([1, 2, 3]), { headers: { 'Content-Type': 'image/webp' } }),
        );
      }
      const map = await getCategoriesOfflineCoverage(['A', 'B']);
      return {
        shared: true,
        count: shared.length,
        a: map.A,
        b: map.B,
      };
    });
    expect(result.shared).toBe(true);
    expect(result.a.have).toBeGreaterThan(0);
    expect(result.b.have).toBeGreaterThan(0);
    expect(result.a.pct).toBeGreaterThan(0);
    expect(result.b.pct).toBeGreaterThan(0);
  });

  test('partial cache paints percent and hue on sibling categories', async ({ page }) => {
    await stubRemoteMedia(page);
    await openCategories(page);

    await page.evaluate(async () => {
      const { applyOfflineCoverageToButtons } = await import(new URL('./js/ui.js', location.href).href);
      applyOfflineCoverageToButtons({
        B: { have: 37, total: 100, pct: 37 },
        C: { have: 100, total: 100, pct: 100 },
      }, new Set());
    });

    const b = page.locator('.category-grid .category-card[data-category="B"] .offline-btn');
    const c = page.locator('.category-grid .category-card[data-category="C"] .offline-btn');
    await expect(b).toHaveClass(/partial/);
    await expect(b).toHaveAttribute('data-offline-pct', '37');
    await expect(b).toContainText(/37% offline/);
    expect(await b.evaluate((el) => el.style.getPropertyValue('--offline-hue'))).toBe('44');
    await expect(c).toHaveClass(/downloaded/);
    await expect(c).toContainText(/Dostępne offline|Available offline/);
    await expect(c).not.toHaveClass(/partial/);
  });

  test('downloading keeps the coverage hue on the progress fill', async ({ page }) => {
    await stubRemoteMedia(page);
    await openCategories(page);
    const bg = await page.evaluate(() => {
      const b = document.querySelector('.category-grid .category-card[data-category="B"] .offline-btn');
      b.classList.add('partial', 'downloading');
      b.style.setProperty('--offline-hue', '60');
      b.style.setProperty('--dl-progress', '50');
      return getComputedStyle(b).backgroundImage;
    });
    expect(bg).toMatch(/linear-gradient/i);
  });

  test('file download skips media already in cache from another category', async ({ page }) => {
    await stubRemoteMedia(page);
    await page.goto('/');
    await page.waitForSelector('#home.active');
    const result = await page.evaluate(async () => {
      const { getMediaUrls } = await import(new URL('./js/data.js', location.href).href);
      const { downloadCategoryMediaFromFiles } = await import(new URL('./js/offline.js', location.href).href);
      const bank = await fetch('data/PT.json').then((res) => res.json());
      const cache = await caches.open('prawko-offline-media-v1');
      const seen = new Set();
      for (const q of bank.questions || []) {
        if (!q.media || seen.has(q.media)) continue;
        seen.add(q.media);
        for (const url of getMediaUrls(q.media, q.mediaType)) {
          await cache.put(
            new Request(url, { mode: 'cors' }),
            new Response(new Uint8Array([9]), { headers: { 'Content-Type': 'application/octet-stream' } }),
          );
        }
      }
      let fetches = 0;
      const origFetch = window.fetch.bind(window);
      window.fetch = (input, init) => {
        const href = String(input?.url || input);
        if (/\.(webp|mp4|webm|jpg|jpeg|png|gif)(\?|$)/i.test(href)) fetches += 1;
        return origFetch(input, init);
      };
      try {
        const downloaded = await downloadCategoryMediaFromFiles('PT');
        return { fetches, success: downloaded.success, total: downloaded.total };
      } finally {
        window.fetch = origFetch;
      }
    });
    expect(result.total).toBeGreaterThan(0);
    expect(result.fetches).toBe(0);
    expect(result.success).toBe(true);
  });

  test('LAN http fallback stores media in IndexedDB when Cache Storage is missing', async ({ page }) => {
    await page.goto('/');
    await page.waitForSelector('#home.active');
    const result = await page.evaluate(async () => {
      const { storeMediaBlob, getStoredMediaBlob, getCachedUrlSet, resolvePlayableMediaUrl } = await import(new URL('./js/offline.js', location.href).href);
      const origOpen = caches.open.bind(caches);
      caches.open = () => Promise.reject(new Error('insecure origin'));
      try {
        const payload = new Uint8Array(40).fill(7);
        await storeMediaBlob('media/img/idb-fallback.webp', new Blob([payload], { type: 'image/webp' }));
        const blob = await getStoredMediaBlob('idb-fallback.webp', 'image');
        const cached = await getCachedUrlSet();
        const play = await resolvePlayableMediaUrl('idb-fallback.webp', 'image');
        const bytes = blob ? new Uint8Array(await blob.arrayBuffer()) : [];
        if (play) URL.revokeObjectURL(play);
        return {
          size: blob?.size || 0,
          first: bytes[0],
          hit: [...cached].some((key) => String(key).includes('idb-fallback')),
          blobUrl: Boolean(play && String(play).startsWith('blob:')),
        };
      } finally {
        caches.open = origOpen;
      }
    });
    expect(result.size).toBe(40);
    expect(result.first).toBe(7);
    expect(result.hit).toBe(true);
    expect(result.blobUrl).toBe(true);
  });

  test('insecure origin keeps files in IndexedDB after Cache Storage disappears', async ({ page }) => {
    await page.goto('/');
    await page.waitForSelector('#home.active');
    const result = await page.evaluate(async () => {
      Object.defineProperty(window, 'isSecureContext', { configurable: true, get: () => false });
      const { storeMediaBlob, getStoredMediaBlob } = await import(new URL('./js/offline.js', location.href).href);
      const payload = new Uint8Array([31, 32, 33, 34]);
      await storeMediaBlob('media/vid/ephemeral-cache.mp4', new Blob([payload], { type: 'video/mp4' }));
      await caches.delete('prawko-offline-media-v1');
      const blob = await getStoredMediaBlob('ephemeral-cache.mp4', 'video');
      const bytes = blob ? new Uint8Array(await blob.arrayBuffer()) : [];
      return { size: blob?.size || 0, first: bytes[0] };
    });
    expect(result.size).toBe(4);
    expect(result.first).toBe(31);
  });

  test('IndexedDB playback finds mixed-case video names without hitting the network', async ({ page }) => {
    await page.goto('/');
    await page.waitForSelector('#home.active');
    const result = await page.evaluate(async () => {
      const { storeMediaBlob, getStoredMediaBlob, resolvePlayableMediaUrl } = await import(new URL('./js/offline.js', location.href).href);
      const origOpen = caches.open.bind(caches);
      caches.open = () => Promise.reject(new Error('insecure origin'));
      try {
        const payload = new Uint8Array(256).fill(11);
        await storeMediaBlob('media/vid/1_1456ztV.mp4', new Blob([payload], { type: 'video/mp4' }));
        const blob = await getStoredMediaBlob('1_1456ztV.mp4', 'video');
        const play = await resolvePlayableMediaUrl('1_1456ztV.mp4', 'video');
        const bytes = blob ? new Uint8Array(await blob.arrayBuffer()) : [];
        if (play) URL.revokeObjectURL(play);
        return {
          size: blob?.size || 0,
          first: bytes[0],
          type: blob?.type || '',
          blobUrl: Boolean(play && String(play).startsWith('blob:')),
        };
      } finally {
        caches.open = origOpen;
      }
    });
    expect(result.size).toBe(256);
    expect(result.first).toBe(11);
    expect(result.type).toMatch(/video\/mp4/);
    expect(result.blobUrl).toBe(true);
  });

  test('file download stores a 200 blob instead of a raw 206 video response', async ({ page }) => {
    await page.goto('/');
    await page.waitForSelector('#home.active');
    const result = await page.evaluate(async () => {
      const { storeMediaBlob } = await import(new URL('./js/offline.js', location.href).href);
      const url = new URL('media/vid/store-200.mp4', location.href).href;
      await storeMediaBlob(url, new Blob([new Uint8Array([1, 2, 3, 4, 5])], { type: 'video/mp4' }));
      const cache = await caches.open('prawko-offline-media-v1');
      const res = await cache.match(url);
      return {
        ok: Boolean(res),
        status: res?.status || 0,
        size: res ? (await res.blob()).size : 0,
      };
    });
    expect(result.ok).toBe(true);
    expect(result.status).toBe(200);
    expect(result.size).toBe(5);
  });

  test('plays from Cache Storage even when the file was stored under a CDN URL', async ({ page }) => {
    await page.goto('/');
    await page.waitForSelector('#home.active');
    const result = await page.evaluate(async () => {
      const { getStoredMediaBlob, resolvePlayableMediaUrl } = await import(new URL('./js/offline.js', location.href).href);
      const cache = await caches.open('prawko-offline-media-v1');
      const payload = new Uint8Array(256).fill(21);
      const cdn = 'https://f003.backblazeb2.com/file/prawko-maz/vid/from-cdn-cache.mp4';
      await cache.put(
        new Request(cdn, { mode: 'cors' }),
        new Response(new Blob([payload], { type: 'video/mp4' }), {
          status: 200,
          headers: { 'Content-Type': 'video/mp4' },
        }),
      );
      const blob = await getStoredMediaBlob('from-cdn-cache.mp4', 'video');
      const play = await resolvePlayableMediaUrl('from-cdn-cache.mp4', 'video');
      const bytes = blob ? new Uint8Array(await blob.arrayBuffer()) : [];
      if (play) URL.revokeObjectURL(play);
      return {
        size: blob?.size || 0,
        first: bytes[0],
        blobUrl: Boolean(play && String(play).startsWith('blob:')),
      };
    });
    expect(result.size).toBe(256);
    expect(result.first).toBe(21);
    expect(result.blobUrl).toBe(true);
  });

  test('offline quiz plays IndexedDB media and never requests /media/', async ({ page }) => {
    const mediaHits = [];
    await page.addInitScript(() => {
      const origOpen = caches.open.bind(caches);
      caches.open = (name) => {
        if (name === 'prawko-offline-media-v1') return Promise.reject(new Error('insecure origin'));
        return origOpen(name);
      };
    });
    await page.route('**/data/B.json', async (route) => {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
          category: 'B',
          questions: [{
            id: 801,
            q: 'Offline IDB playback',
            type: 'basic',
            correct: 'T',
            points: 3,
            media: 'offline-idb.png',
            mediaType: 'image',
          }],
        }),
      });
    });
    await page.route('**/media/**', async (route) => {
      mediaHits.push(route.request().url());
      await route.abort();
    });
    await page.goto('/');
    await page.waitForSelector('#home.active');
    await page.evaluate(async () => {
      const { storeMediaBlob } = await import(new URL('./js/offline.js', location.href).href);
      const bin = atob('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==');
      const png = new Uint8Array(bin.length);
      for (let i = 0; i < bin.length; i++) png[i] = bin.charCodeAt(i);
      await storeMediaBlob('media/img/offline-idb.png', new Blob([png], { type: 'image/png' }));
    });
    await fakeOffline(page);
    await goToCategories(page);
    await page.click('.mode-btn[data-mode="learn"]');
    await page.click('.category-grid .category-card[data-category="B"]');
    await page.waitForSelector('#quiz.active');
    const img = page.locator('#quiz .media-area img');
    await expect(img).toHaveAttribute('src', /^blob:/);
    expect(mediaHits).toEqual([]);
  });
});
