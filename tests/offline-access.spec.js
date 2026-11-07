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

  test('local.json mediaBase cdn keeps the published Backblaze host', async ({ page }) => {
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

  test('UI fonts are same-origin files, not Google', () => {
    const fs = require('fs');
    const path = require('path');
    const html = fs.readFileSync(path.join(__dirname, '..', 'src', 'index.html'), 'utf8');
    const css = fs.readFileSync(path.join(__dirname, '..', 'src', 'css', 'style.css'), 'utf8');
    expect(html).not.toMatch(/fonts\.googleapis|fonts\.gstatic/);
    expect(html).toMatch(/font-src 'self'/);
    expect(css).toMatch(/fonts\/inter-latin-wght-normal\.woff2/);
    expect(css).toMatch(/fonts\/dm-sans-latin-wght-normal\.woff2/);
  });

  test('without local.json media stays on the published CDN', async () => {
    const fs = require('fs');
    const path = require('path');
    const src = fs.readFileSync(path.join(__dirname, '..', 'src', 'js', 'data.js'), 'utf8');
    expect(src).not.toMatch(/isLocalDevHost/);
    expect(src).not.toMatch(/hostedOnGitHubPages/);
    expect(src).not.toMatch(/github\.io/);
    expect(src).toMatch(/export let MEDIA_BASE = ''/);
    expect(src).toMatch(/if \(!MEDIA_BASE\) MEDIA_BASE = MEDIA_CDN/);
    expect(src).toMatch(/export let OFFLINE_DOWNLOAD = 'packs'/);
    expect(src).toMatch(/fetch\(new URL\('local\.json'/);
    expect(src).toMatch(/LOCAL_JSON_WAIT_MS = 1000/);
    expect(src).toMatch(/firstScreenLocalConfig/);
    expect(src).toMatch(/LOCAL_JSON_HANG_MS/);
    expect(src).not.toMatch(/abort\(\), LOCAL_JSON_WAIT_MS/);
  });

  test('a missing local.json does not switch to same-origin media', async ({ page }) => {
    await page.route('**/local.json', async (route) => {
      await route.fulfill({ status: 404, body: '' });
    });
    await page.goto('/');
    await page.waitForSelector('#home.active');
    const urls = await page.evaluate(async () => {
      const { getMediaUrls, usesLocalMedia, OFFLINE_DOWNLOAD } = await import(new URL('./js/data.js', location.href).href);
      return {
        local: usesLocalMedia(),
        offline: OFFLINE_DOWNLOAD,
        img: getMediaUrls('foo.webp', 'image').join(' '),
        vid: getMediaUrls('bar.mp4', 'video').join(' '),
      };
    });
    expect(urls.local).toBe(false);
    expect(urls.offline).toBe('packs');
    expect(urls.img).toMatch(/backblazeb2/);
    expect(urls.vid).toMatch(/backblazeb2/);
    expect(urls.img).not.toMatch(/\/media\/img\//);
    await expect(page.locator('html')).toHaveAttribute('data-local-media', 'false');
  });

  test('a slow local.json still selects same-origin media', async ({ page }) => {
    await page.route('**/local.json', async (route) => {
      await new Promise((resolve) => setTimeout(resolve, 1500));
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({ mediaBase: 'media' }),
      });
    });
    const started = Date.now();
    await page.goto('/');
    await page.waitForSelector('#home.active');
    expect(Date.now() - started).toBeLessThan(2500);
    await expect(page.locator('html')).toHaveAttribute('data-local-media', 'true');
    const img = await page.evaluate(async () => {
      const { getMediaUrls } = await import(new URL('./js/data.js', location.href).href);
      return getMediaUrls('foo.webp', 'image').join(' ');
    });
    expect(img).not.toMatch(/backblazeb2/);
    expect(img).toMatch(/media\/img\//);
  });

  test('a hanging local.json does not block the first screen', async ({ page }) => {
    let pending;
    await page.route('**/local.json', (route) => {
      pending = route;
    });
    const started = Date.now();
    await page.goto('/');
    await expect(page.locator('#home.active')).toBeVisible();
    await expect(page.locator('#home-spinner')).toHaveClass(/hidden/);
    await expect(page.locator('html')).toHaveAttribute('data-local-media', 'false');
    expect(Date.now() - started).toBeLessThan(3000);
    if (pending) {
      try {
        await pending.fulfill({ status: 404, body: '' });
      } catch { /* fetch already aborted */ }
    }
  });

  test('local media marks every category available offline', async ({ page }) => {
    await page.route('**/local.json', async (route) => {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({ mediaBase: 'media' }),
      });
    });
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
    await stubRemoteMedia(page);
    await page.goto('/');
    await page.waitForSelector('#home.active');
    // Seed a full B cache so reconcile keeps the downloaded flag (empty list is cleared).
    const seeded = await page.evaluate(async () => {
      const { getMediaUrls, fetchCategoryMediaList } = await import(new URL('./js/data.js', location.href).href);
      const list = await fetchCategoryMediaList('B');
      const names = [...new Set((list.questions || []).map((q) => q.media).filter(Boolean))];
      if (!names.length) return false;
      const cache = await caches.open('prawko-offline-media-v1');
      const allUrls = [];
      for (const name of names) {
        const kind = /\.mp4$/i.test(name) ? 'video' : 'image';
        for (const url of getMediaUrls(name, kind)) {
          allUrls.push(url);
          await cache.put(
            new Request(url, { mode: 'cors' }),
            new Response(new Uint8Array([1]), { headers: { 'Content-Type': 'application/octet-stream' } }),
          );
        }
      }
      localStorage.setItem('prawko_offline', JSON.stringify(['B']));
      localStorage.setItem('prawko_offline_manifest', JSON.stringify({ B: allUrls }));
      return true;
    });
    expect(seeded).toBe(true);
    await goToCategories(page);
    await page.waitForSelector('.category-grid .category-card[data-category="B"] .offline-btn');
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

  test('coverage matches media and CDN needed URLs via basename', async ({ page }) => {
    await page.goto('/');
    await page.waitForSelector('#home.active');
    const result = await page.evaluate(async () => {
      const { coverageFromUrls } = await import(new URL('./js/offline.js', location.href).href);
      const cached = new Set(['/img/shared.webp', 'clip.mp4']);
      return {
        fromMedia: coverageFromUrls(['media/img/shared.webp', 'media/vid/clip.mp4'], cached),
        fromCdn: coverageFromUrls([
          'https://cdn.example.test/prawko/img/shared.webp',
          'https://cdn.example.test/prawko/vid/clip.mp4',
        ], cached),
        mixed: coverageFromUrls(
          ['media/img/shared.webp', 'https://cdn.example.test/prawko/img/missing.webp'],
          cached
        ),
      };
    });
    expect(result.fromMedia).toMatchObject({ have: 2, total: 2, pct: 100 });
    expect(result.fromCdn).toMatchObject({ have: 2, total: 2, pct: 100 });
    expect(result.mixed).toMatchObject({ have: 1, total: 2, pct: 50 });
  });

  test('sw.js serves local.json network-first and caches only 200', () => {
    const fs = require('fs');
    const path = require('path');
    const src = fs.readFileSync(path.join(__dirname, '..', 'src', 'sw.js'), 'utf8');
    expect(src).toMatch(/endsWith\('\/local\.json'\)/);
    expect(src).toMatch(/safeCachePut\(cache, event\.request, response\.clone\(\)\)/);
    expect(src).toMatch(/cache\.delete\(event\.request\)/);
    expect(src).not.toMatch(/endsWith\('\/local\.json'\)\) return;/);
  });

  test('sw.js splits shell vs data precache without duplication', () => {
    const fs = require('fs');
    const path = require('path');
    const src = fs.readFileSync(path.join(__dirname, '..', 'src', 'sw.js'), 'utf8');
    const shellBlock = src.slice(src.indexOf('const APP_SHELL'), src.indexOf('const DATA_PRECACHE'));
    const dataBlock = src.slice(src.indexOf('const DATA_PRECACHE'), src.indexOf('function videoAssemblyKey'));
    expect(shellBlock).toMatch(/media-feed\.js/);
    expect(shellBlock).toMatch(/icon-512\.png/);
    expect(shellBlock).not.toMatch(/data\/B\.json/);
    expect(shellBlock).not.toMatch(/questions\.json/);
    expect(dataBlock).toMatch(/data\/B\.json/);
    expect(dataBlock).toMatch(/data\/meta\.json/);
    expect(dataBlock).toMatch(/questions\.json/);
    expect(src).toMatch(/precacheUrls\(DATA_CACHE, DATA_PRECACHE\)/);
    expect(src).toMatch(/pathname\.includes\('\/data\/'\)/);
    expect(fs.existsSync(path.join(__dirname, '..', 'src', 'data', 'media-trim.json'))).toBe(false);
  });

  test('category JSON fetch has no cache-bust query', () => {
    const fs = require('fs');
    const path = require('path');
    const src = fs.readFileSync(path.join(__dirname, '..', 'src', 'js', 'data.js'), 'utf8');
    expect(src).not.toMatch(/CATEGORY_FILE_REV/);
    expect(src).toMatch(/fetch\(`data\/\$\{encodeURIComponent\(cat\)\}\.json`\)/);
  });

  test('in-progress flag alone paints percent not Przerwij', async ({ page }) => {
    await stubRemoteMedia(page);
    await openCategories(page);
    await page.evaluate(async () => {
      localStorage.setItem('prawko_offline_in_progress', JSON.stringify({ categoryId: 'B' }));
      const { applyOfflineCoverageToButtons } = await import(new URL('./js/ui.js', location.href).href);
      applyOfflineCoverageToButtons({
        B: { have: 52, total: 100, pct: 52 },
        C: { have: 10, total: 100, pct: 10 },
      }, new Set());
    });
    const b = page.locator('.category-grid .category-card[data-category="B"] .offline-btn');
    const c = page.locator('.category-grid .category-card[data-category="C"] .offline-btn');
    await expect(b).toHaveClass(/partial/);
    await expect(b).not.toHaveClass(/downloading/);
    await expect(b).toContainText(/52% offline/);
    await expect(b).not.toContainText(/Przerwij|Stop|Stoppen|Зупинити/);
    await expect(c).toHaveClass(/download-locked/);
  });

  test('offline in-progress keeps the flag; online resumes a live job', async ({ page }) => {
    await stubRemoteMedia(page);
    await page.route('**/media/**', async (route) => {
      await new Promise(() => {});
    });
    await page.route('https://cdn.example.test/**', async (route) => {
      await new Promise(() => {});
    });
    await page.goto('/');
    await page.waitForSelector('#home.active');
    await page.evaluate(() => {
      localStorage.setItem('prawko_offline_in_progress', JSON.stringify({ categoryId: 'B' }));
      Object.defineProperty(navigator, 'onLine', { configurable: true, get: () => false });
      window.dispatchEvent(new Event('offline'));
    });
    await page.locator('#home [data-navigate="categories"]').first().click();
    await page.waitForSelector('#categories.active');
    await page.evaluate(async () => {
      const { applyOfflineCoverageToButtons } = await import(new URL('./js/ui.js', location.href).href);
      applyOfflineCoverageToButtons({ B: { have: 40, total: 100, pct: 40 } }, new Set());
    });
    const b = page.locator('.category-grid .category-card[data-category="B"] .offline-btn');
    await expect(b).not.toHaveClass(/downloading/);
    await expect(b).toContainText(/40% offline/);
    const stillPending = await page.evaluate(() => localStorage.getItem('prawko_offline_in_progress'));
    expect(stillPending).toContain('"B"');

    await page.evaluate(() => {
      Object.defineProperty(navigator, 'onLine', { configurable: true, get: () => true });
      window.dispatchEvent(new Event('online'));
    });
    await expect(b).toHaveClass(/downloading/, { timeout: 10000 });
    await expect(b).toContainText(/Przerwij|Stop|Stoppen|Зупинити/);
    const active = await page.evaluate(async () => {
      const { getActiveDownloadCategory } = await import(new URL('./js/offline.js', location.href).href);
      return getActiveDownloadCategory();
    });
    expect(active).toBe('B');
  });

  test('offline status waits for question facts, not translations', async ({ page }) => {
    await stubRemoteMedia(page);
    let releaseFacts;
    const factsHeld = new Promise((resolve) => { releaseFacts = resolve; });
    let translationsDone = false;
    await page.route('**/data/questions.json', async (route) => {
      await factsHeld;
      await route.continue();
    });
    await page.route('**/data/translations_pl.json', async (route) => {
      await new Promise((resolve) => setTimeout(resolve, 20000));
      translationsDone = true;
      await route.continue();
    });
    await page.goto('/');
    await goToCategories(page);
    const btn = page.locator('.category-grid .category-card[data-category="B"] .offline-btn');
    await expect(btn).toHaveClass(/coverage-pending/);
    await expect(btn).toHaveAttribute('aria-busy', 'true');
    await expect(btn).not.toContainText(/Pobierz|Save offline|% offline/);
    await btn.click();
    await expect(btn).not.toHaveClass(/downloading/);
    releaseFacts();
    await expect(btn).not.toHaveClass(/coverage-pending/, { timeout: 15000 });
    await expect(btn).toContainText(/Pobierz offline|Save offline/);
    expect(translationsDone).toBe(false);
  });

  test('file-mode coverage counts shared question media, not zip packs', async ({ page }) => {
    await stubRemoteMedia(page);
    await page.goto('/');
    await page.waitForSelector('#home.active');
    const result = await page.evaluate(async () => {
      const { getMediaUrls, fetchCategory } = await import(new URL('./js/data.js', location.href).href);
      const { getCategoriesOfflineCoverage } = await import(new URL('./js/offline.js', location.href).href);
      const [bankB, bankA] = await Promise.all([
        fetchCategory('B'),
        fetchCategory('A'),
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

  test('coverage under 1% shows 0% offline once anything is stored', async ({ page }) => {
    await stubRemoteMedia(page);
    await openCategories(page);

    await page.evaluate(async () => {
      const { applyOfflineCoverageToButtons } = await import(new URL('./js/ui.js', location.href).href);
      applyOfflineCoverageToButtons({
        B: { have: 2, total: 5000, pct: 0 },
        C: { have: 0, total: 100, pct: 0 },
      }, new Set());
    });

    const b = page.locator('.category-grid .category-card[data-category="B"] .offline-btn');
    const c = page.locator('.category-grid .category-card[data-category="C"] .offline-btn');
    await expect(b).toHaveClass(/partial/);
    await expect(b).toHaveAttribute('data-offline-pct', '0');
    await expect(b).toContainText(/0% offline/);
    expect(await b.evaluate((el) => el.style.getPropertyValue('--offline-hue'))).toBe('0');
    await expect(c).not.toHaveClass(/partial/);
    await expect(c).toContainText(/Pobierz offline|Save offline/);
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
      const { getMediaUrls, fetchCategory } = await import(new URL('./js/data.js', location.href).href);
      const { downloadCategoryMediaFromFiles } = await import(new URL('./js/offline.js', location.href).href);
      const bank = await fetchCategory('PT');
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

  test('same-origin media resumes a partial image or video with a one-chunk rewind', async ({ page }) => {
    await page.route('**/local.json', async (route) => {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({ mediaBase: 'media', offlineDownload: 'files' }),
      });
    });
    await page.goto('/');
    await page.waitForSelector('#home.active');
    const target = await page.evaluate(async () => {
      const { fetchCategory, getMediaUrls } = await import(new URL('./js/data.js', location.href).href);
      const bank = await fetchCategory('PT');
      const q = (bank.questions || []).find((item) => item.media);
      const url = getMediaUrls(q.media, q.mediaType)[0];
      return { media: q.media, mediaType: q.mediaType || 'image', url: new URL(url, location.href).href };
    });
    const payload = Buffer.alloc(300 * 1024, 0x61);
    const rewind = 256 * 1024;
    const first = rewind + 32 * 1024;
    const ranges = [];
    const type = target.mediaType === 'video' ? 'video/mp4' : 'image/webp';
    await page.route(target.url, async (route) => {
      const range = route.request().headers().range || '';
      ranges.push(range);
      if (!range) {
        await route.fulfill({
          status: 200,
          contentType: type,
          headers: { 'Content-Length': String(payload.length), 'Accept-Ranges': 'bytes' },
          body: payload.subarray(0, first),
        });
        return;
      }
      const start = Number((/bytes=(\d+)-/i.exec(range) || [])[1]);
      await route.fulfill({
        status: 206,
        contentType: type,
        headers: {
          'Content-Range': `bytes ${start}-${payload.length - 1}/${payload.length}`,
          'Content-Length': String(payload.length - start),
          'Accept-Ranges': 'bytes',
        },
        body: payload.subarray(start),
      });
    });
    const result = await page.evaluate(async ({ media, url }) => {
      const { fetchCategory, getMediaUrls } = await import(new URL('./js/data.js', location.href).href);
      const { downloadCategoryMediaFromFiles } = await import(new URL('./js/offline.js', location.href).href);
      const bank = await fetchCategory('PT');
      const cache = await caches.open('prawko-offline-media-v1');
      const seen = new Set();
      for (const q of bank.questions || []) {
        if (!q.media || seen.has(q.media) || q.media === media) continue;
        seen.add(q.media);
        for (const item of getMediaUrls(q.media, q.mediaType)) {
          const abs = new URL(item, location.href).href;
          await cache.put(
            new Request(abs),
            new Response(new Uint8Array([9]), {
              status: 200,
              headers: { 'Content-Type': 'application/octet-stream' },
            }),
          );
        }
      }
      const downloaded = await downloadCategoryMediaFromFiles('PT');
      const hit = await cache.match(url);
      const bytes = hit ? new Uint8Array(await hit.arrayBuffer()) : new Uint8Array();
      return {
        success: downloaded.success,
        status: hit?.status || 0,
        size: bytes.length,
        first: bytes[0] || 0,
        last: bytes.length ? bytes[bytes.length - 1] : 0,
      };
    }, target);
    expect(result.success).toBe(true);
    expect(result.status).toBe(200);
    expect(result.size).toBe(payload.length);
    expect(result.first).toBe(0x61);
    expect(result.last).toBe(0x61);
    expect(ranges[0] || '').toBe('');
    expect(ranges.some((header) => header === `bytes=${first - rewind}-`)).toBe(true);
  });

  test('IndexedDB stores media when Cache Storage is missing', async ({ page }) => {
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

  test('insecure origin media-feed paints from IDB without a network GET', async ({ page }) => {
    await page.goto('/');
    await page.waitForSelector('#home.active');
    const result = await page.evaluate(async () => {
      Object.defineProperty(window, 'isSecureContext', { configurable: true, get: () => false });
      const { storeMediaBlob, canUseOfflineMediaCache } = await import(new URL('./js/offline.js', location.href).href);
      const { startMediaFeed, abortMediaFeed } = await import(new URL('./js/media-feed.js', location.href).href);
      const payload = new Uint8Array(64).fill(42);
      const name = 'idb-feed-direct.webp';
      await storeMediaBlob(`media/img/${name}`, new Blob([payload], { type: 'image/webp' }));
      let networkHits = 0;
      const origFetch = window.fetch.bind(window);
      window.fetch = async (input, init) => {
        const href = String(typeof input === 'string' ? input : input?.url || '');
        if (href.includes(name)) networkHits += 1;
        return origFetch(input, init);
      };
      try {
        const img = document.createElement('img');
        document.body.appendChild(img);
        startMediaFeed(img, new URL(`media/img/${name}`, location.href).href, storeMediaBlob);
        const deadline = performance.now() + 3000;
        while (performance.now() < deadline) {
          if (String(img.src || '').startsWith('blob:') || img.dataset.byteSource === 'stored') break;
          await new Promise((r) => setTimeout(r, 20));
        }
        const objectUrl = img.src;
        abortMediaFeed();
        img.remove();
        return {
          canCache: canUseOfflineMediaCache(),
          networkHits,
          blobUrl: objectUrl.startsWith('blob:'),
          byteSource: img.dataset.byteSource || '',
        };
      } finally {
        window.fetch = origFetch;
      }
    });
    expect(result.canCache).toBe(false);
    expect(result.networkHits).toBe(0);
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

  test('next lookup sees a video the service worker stored after a previous miss', async ({ page }) => {
    await page.goto('/');
    await page.waitForSelector('#home.active');
    const result = await page.evaluate(async () => {
      const { getStoredMediaBlob, resolvePlayableMediaUrl } = await import(new URL('./js/offline.js', location.href).href);
      const name = 'after-miss-cache.mp4';
      const miss = await getStoredMediaBlob(name, 'video');
      const cache = await caches.open('prawko-offline-media-v1');
      const payload = new Uint8Array(256).fill(22);
      const cdn = 'https://f003.backblazeb2.com/file/prawko-maz/vid/after-miss-cache.mp4';
      await cache.put(
        new Request(cdn, { mode: 'cors' }),
        new Response(new Blob([payload], { type: 'video/mp4' }), {
          status: 200,
          headers: { 'Content-Type': 'video/mp4' },
        }),
      );
      const blob = await getStoredMediaBlob(name, 'video');
      const play = await resolvePlayableMediaUrl(name, 'video');
      const bytes = blob ? new Uint8Array(await blob.arrayBuffer()) : [];
      if (play) URL.revokeObjectURL(play);
      return {
        missed: miss ? miss.size : 0,
        size: blob?.size || 0,
        first: bytes[0],
        blobUrl: Boolean(play && String(play).startsWith('blob:')),
      };
    });
    expect(result.missed).toBe(0);
    expect(result.size).toBe(256);
    expect(result.first).toBe(22);
    expect(result.blobUrl).toBe(true);
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

  test('offline quiz plays Cache Storage media and never requests /media/', async ({ page }) => {
    const mediaHits = [];
    await page.route('**/local.json', async (route) => {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({ mediaBase: 'cdn' }),
      });
    });
    await page.route('**/data/B.json*', async (route) => {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({ category: 'B', questionIds: [801] }),
      });
    });
    await page.route('**/data/questions.json', async (route) => {
      const facts = await (await route.fetch()).json();
      facts['801'] = {
        type: 'basic',
        correct: 'T',
        points: 3,
        media: 'offline-cache.png',
        mediaType: 'image',
      };
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify(facts),
      });
    });
    await page.route('**/data/translations_pl.json', async (route) => {
      const polish = await (await route.fetch()).json();
      polish['801'] = { q: 'Offline cache playback', src: 'excel' };
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify(polish),
      });
    });
    await page.route('**/media/**', async (route) => {
      mediaHits.push(route.request().url());
      await route.abort();
    });
    await page.route('https://f003.backblazeb2.com/file/prawko-maz/**', async (route) => {
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
      const url = 'https://f003.backblazeb2.com/file/prawko-maz/img/offline-cache.png';
      await storeMediaBlob(url, new Blob([png], { type: 'image/png' }));
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

const TINY_PNG = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==',
  'base64',
);
const TINY_MP4 = Buffer.from(
  'AAAAIGZ0eXBpc29tAAACAGlzb21pc28yYXZjMW1wNDEAAAMUbW9vdgAAAGxtdmhkAAAAAAAAAAAAAAAAAAAD6AAAACgAAQAAAQAAAAAAAAAAAAAAAAEAAAAAAAAAAAAAAAAAAAABAAAAAAAAAAAAAAAAAABAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAgAAAj90cmFrAAAAXHRraGQAAAADAAAAAAAAAAAAAAABAAAAAAAAACgAAAAAAAAAAAAAAAAAAAAAAAEAAAAAAAAAAAAAAAAAAAABAAAAAAAAAAAAAAAAAABAAAAAABAAAAAQAAAAAAAkZWR0cwAAABxlbHN0AAAAAAAAAAEAAAAoAAAAAAABAAAAAAG3bWRpYQAAACBtZGhkAAAAAAAAAAAAAAAAAAAyAAAAAgBVxAAAAAAALWhkbHIAAAAAAAAAAHZpZGUAAAAAAAAAAAAAAABWaWRlb0hhbmRsZXIAAAABYm1pbmYAAAAUdm1oZAAAAAEAAAAAAAAAAAAAACRkaW5mAAAAHGRyZWYAAAAAAAAAAQAAAAx1cmwgAAAAAQAAASJzdGJsAAAAvnN0c2QAAAAAAAAAAQAAAK5hdmMxAAAAAAAAAAEAAAAAAAAAAAAAAAAAAAAAABAAEABIAAAASAAAAAAAAAABFExhdmM2My4xLjEwMSBsaWJ4MjY0AAAAAAAAAAAAAAAAGP//AAAANGF2Y0MBZAAK/+EAF2dkAAqs2V7ARAAAAwAEAAADAMg8SJZYAQAGaOvjyyLA/fj4AAAAABBwYXNwAAAAAQAAAAEAAAAUYnRydAAAAAAAAinoAAAAAAAAABhzdHRzAAAAAAAAAAEAAAABAAACAAAAABxzdHNjAAAAAAAAAAEAAAABAAAAAQAAAAEAAAAUc3RzegAAAAAAAALFAAAAAQAAABRzdGNvAAAAAAAAAAEAAANEAAAAYXVkdGEAAABZbWV0YQAAAAAAAAAhaGRscgAAAAAAAAAAbWRpcmFwcGwAAAAAAAAAAAAAAAAsaWxzdAAAACSpdG9vAAAAHGRhdGEAAAABAAAAAExhdmY2My4xLjEwMQAAAAhmcmVlAAACzW1kYXQAAAKuBgX//6rcRem95tlIt5Ys2CDZI+7veDI2NCAtIGNvcmUgMTY1IHIzMjIzIDA0ODBjYjAgLSBILjI2NC9NUEVHLTQgQVZDIGNvZGVjIC0gQ29weWxlZnQgMjAwMy0yMDI1IC0gaHR0cDovL3d3dy52aWRlb2xhbi5vcmcveDI2NC5odG1sIC0gb3B0aW9uczogY2FiYWM9MSByZWY9MyBkZWJsb2NrPTE6MDowIGFuYWx5c2U9MHgzOjB4MTEzIG1lPWhleCBzdWJtZT03IHBzeT0xIHBzeV9yZD0xLjAwOjAuMDAgbWl4ZWRfcmVmPTEgbWVfcmFuZ2U9MTYgY2hyb21hX21lPTEgdHJlbGxpcz0xIDh4OGRjdD0xIGNxbT0wIGRlYWR6b25lPTIxLDExIGZhc3RfcHNraXA9MSBjaHJvbWFfcXBfb2Zmc2V0PS0yIHRocmVhZHM9MSBsb29rYWhlYWRfdGhyZWFkcz0xIHNsaWNlZF90aHJlYWRzPTAgbnI9MCBkZWNpbWF0ZT0xIGludGVybGFjZWQ9MCBibHVyYXlfY29tcGF0PTAgY29uc3RyYWluZWRfaW50cmE9MCBiZnJhbWVzPTMgYl9weXJhbWlkPTIgYl9hZGFwdD0xIGJfYmlhcz0wIGRpcmVjdD0xIHdlaWdodGI9MSBvcGVuX2dvcD0wIHdlaWdodHA9MiBrZXlpbnQ9MjUwIGtleWludF9taW49MjUgc2NlbmVjdXQ9NDAgaW50cmFfcmVmcmVzaD0wIHJjX2xvb2thaGVhZD00MCByYz1jcmYgbWJ0cmVlPTEgY3JmPTIzLjAgcWNvbXA9MC42MCBxcG1pbj0wIHFwbWF4PTY5IHFwc3RlcD00IGlwX3JhdGlvPTEuNDAgYXE9MToxLjAwAIAAAAAPZYiEACv//vZzfAprbbGB',
  'base64',
);

test.describe('Opportunistic viewed media cache', () => {
  // Page-owned fetch → storeMediaBlob (same on HTTP/HTTPS; suite blocks SW).
  test('a CDN image is painted from one page fetch and then stored', async ({ page }) => {
    const imageHits = [];
    await page.route('**/local.json', async (route) => {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({ mediaBase: 'cdn' }),
      });
    });
    await page.route('https://f003.backblazeb2.com/file/prawko-maz/img/one-get.webp', async (route) => {
      if (route.request().method() === 'OPTIONS') {
        await route.fulfill({
          status: 204,
          headers: {
            'Access-Control-Allow-Origin': '*',
            'Access-Control-Allow-Methods': 'GET',
          },
        });
        return;
      }
      imageHits.push(route.request().headers()['range'] || '');
      await route.fulfill({
        status: 200,
        contentType: 'image/png',
        headers: { 'Access-Control-Allow-Origin': '*' },
        body: TINY_PNG,
      });
    });
    await page.goto('/');
    await page.waitForSelector('#home.active');
    await page.evaluate(async () => {
      const { renderQuestion } = await import(new URL('./js/ui.js', location.href).href);
      renderQuestion({
        id: 9000,
        q: 'One GET?',
        media: 'one-get.webp',
        mediaType: 'image',
        type: 'basic',
        correct: 'T',
      }, document.querySelector('.question-card'));
    });
    const img = page.locator('#quiz .media-area img');
    await expect(img).toHaveAttribute('src', /^blob:/);
    await expect.poll(() => imageHits.length).toBe(1);
    expect(imageHits[0]).toBe('');
    await expect(page.locator('#quiz .media-area')).not.toHaveClass(/loading/);
    await expect.poll(async () => page.evaluate(async () => {
      const { getStoredMediaBlob } = await import(new URL('./js/offline.js', location.href).href);
      const blob = await getStoredMediaBlob('one-get.webp', 'image');
      return blob ? blob.size : 0;
    }), { timeout: 5000 }).toBe(TINY_PNG.length);
  });

  test('a stored CDN image replays from the local copy', async ({ page }) => {
    const imageHits = [];
    await page.route('**/local.json', async (route) => {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({ mediaBase: 'cdn' }),
      });
    });
    await page.route('https://f003.backblazeb2.com/file/prawko-maz/img/viewed-once.webp', async (route) => {
      if (route.request().method() === 'OPTIONS') {
        await route.fulfill({
          status: 204,
          headers: {
            'Access-Control-Allow-Origin': '*',
            'Access-Control-Allow-Methods': 'GET',
          },
        });
        return;
      }
      imageHits.push(route.request().headers()['range'] || '');
      await route.fulfill({
        status: 200,
        contentType: 'image/png',
        headers: { 'Access-Control-Allow-Origin': '*' },
        body: TINY_PNG,
      });
    });
    await page.goto('/');
    await page.waitForSelector('#home.active');
    const q = {
      id: 9001,
      q: 'Cache this image?',
      media: 'viewed-once.webp',
      mediaType: 'image',
      type: 'basic',
      correct: 'T',
    };
    await page.evaluate(async (question) => {
      const { renderQuestion } = await import(new URL('./js/ui.js', location.href).href);
      renderQuestion(question, document.querySelector('.question-card'));
    }, q);
    await expect(page.locator('#quiz .media-area img')).toHaveAttribute('src', /^blob:/);
    await expect.poll(async () => page.evaluate(async () => {
      const { getStoredMediaBlob } = await import(new URL('./js/offline.js', location.href).href);
      const blob = await getStoredMediaBlob('viewed-once.webp', 'image');
      return blob ? blob.size : 0;
    }), { timeout: 5000 }).toBe(TINY_PNG.length);
    const hitsAfterStore = imageHits.length;
    expect(hitsAfterStore).toBe(1);
    await page.evaluate(async (question) => {
      const { renderQuestion } = await import(new URL('./js/ui.js', location.href).href);
      const card = document.querySelector('.question-card');
      renderQuestion(question, card);
      renderQuestion(question, card);
    }, q);
    await expect(page.locator('#quiz .media-area img')).toHaveAttribute('src', /^blob:/);
    expect(imageHits.length).toBe(hitsAfterStore);
  });

  test('switching questions still paints the current image if the previous download is slow', async ({ page }) => {
    await page.route('**/local.json', async (route) => {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({ mediaBase: 'cdn' }),
      });
    });
    await page.route('https://f003.backblazeb2.com/file/prawko-maz/img/slow-first.webp', async (route) => {
      if (route.request().method() === 'OPTIONS') {
        await route.fulfill({ status: 204, headers: { 'Access-Control-Allow-Origin': '*' } });
        return;
      }
      await new Promise((r) => setTimeout(r, 2500));
      await route.fulfill({
        status: 200,
        contentType: 'image/png',
        headers: { 'Access-Control-Allow-Origin': '*' },
        body: TINY_PNG,
      });
    });
    await page.route('https://f003.backblazeb2.com/file/prawko-maz/img/fast-second.webp', async (route) => {
      if (route.request().method() === 'OPTIONS') {
        await route.fulfill({ status: 204, headers: { 'Access-Control-Allow-Origin': '*' } });
        return;
      }
      await route.fulfill({
        status: 200,
        contentType: 'image/png',
        headers: { 'Access-Control-Allow-Origin': '*' },
        body: TINY_PNG,
      });
    });
    await page.goto('/');
    await page.waitForSelector('#home.active');
    await page.evaluate(async () => {
      const { renderQuestion } = await import(new URL('./js/ui.js', location.href).href);
      const card = document.querySelector('.question-card');
      const base = { type: 'basic', correct: 'T', mediaType: 'image' };
      renderQuestion({ ...base, id: 1, q: 'First', media: 'slow-first.webp' }, card);
      renderQuestion({ ...base, id: 2, q: 'Second', media: 'fast-second.webp' }, card);
    });
    const img = page.locator('#quiz .media-area img');
    await expect(img).toHaveAttribute('src', /^blob:/, { timeout: 3000 });
    await expect(page.locator('#quiz .question-text')).toHaveText('Second');
  });

  test('a 206 image response is not stored', async ({ page }) => {
    await page.route('**/local.json', async (route) => {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({ mediaBase: 'cdn' }),
      });
    });
    await page.route('https://f003.backblazeb2.com/file/prawko-maz/img/partial.webp', async (route) => {
      if (route.request().method() === 'OPTIONS') {
        await route.fulfill({
          status: 204,
          headers: { 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Methods': 'GET' },
        });
        return;
      }
      await route.fulfill({
        status: 206,
        contentType: 'image/webp',
        headers: {
          'Access-Control-Allow-Origin': '*',
          'Content-Range': `bytes 0-3/${TINY_PNG.length}`,
        },
        body: TINY_PNG.subarray(0, 4),
      });
    });
    await page.goto('/');
    await page.waitForSelector('#home.active');
    await page.evaluate(async () => {
      const { renderQuestion } = await import(new URL('./js/ui.js', location.href).href);
      renderQuestion({
        id: 9010,
        q: 'Partial?',
        media: 'partial.webp',
        mediaType: 'image',
        type: 'basic',
        correct: 'T',
      }, document.querySelector('.question-card'));
    });
    await page.waitForTimeout(800);
    const stored = await page.evaluate(async () => {
      const { getStoredMediaBlob } = await import(new URL('./js/offline.js', location.href).href);
      const blob = await getStoredMediaBlob('partial.webp', 'image');
      return blob ? blob.size : 0;
    });
    expect(stored).toBe(0);
  });

  test('film play waits until remaining download fits in 75% of the film', async ({ page }) => {
    await page.goto('/');
    await page.waitForSelector('#home.active');
    const result = await page.evaluate(async () => {
      const { filmPaceOk, FILM_PACE_FRACTION, FILM_PACE_MIN_SAMPLE } = await import(
        new URL('./js/media-feed.js', location.href).href
      );
      const total = 10000;
      // Under 30% — ignore an early burst even if the math looks fine.
      const underSample = filmPaceOk(199, total, 60, 20);
      const burstOnly = filmPaceOk(Math.floor(total * 0.1), total, 0.01, 20);
      const justUnderFloor = filmPaceOk(2999, total, 60, 20);
      // Fast link after the sample floor: half the file in 50ms → start.
      const fast = filmPaceOk(5000, total, 0.05, 20);
      // 30% in 60s for a 20s film → still far too early.
      const early = filmPaceOk(3000, total, 60, 20);
      // Remaining download must be ≤ 15s (20s − 25%). Same slow rate as early.
      const rate = 60 / 3000;
      const readyAt = Math.ceil(total - 15 / rate);
      const ready = filmPaceOk(readyAt, total, rate * readyAt, 20);
      const stillShort = filmPaceOk(readyAt - 1, total, rate * (readyAt - 1), 20);
      const complete = filmPaceOk(total, total, 1, 20);
      const noLength = filmPaceOk(500, 0, 10, 20);
      return {
        underSample,
        burstOnly,
        justUnderFloor,
        fast,
        early,
        ready,
        stillShort,
        complete,
        noLength,
        readyAt,
        fraction: FILM_PACE_FRACTION,
        minSample: FILM_PACE_MIN_SAMPLE,
      };
    });
    expect(result.fraction).toBe(0.75);
    expect(result.minSample).toBe(0.3);
    expect(result.justUnderFloor).toBe(false);
    expect(result.underSample).toBe(false);
    expect(result.burstOnly).toBe(false);
    expect(result.fast).toBe(true);
    expect(result.early).toBe(false);
    expect(result.stillShort).toBe(false);
    expect(result.ready).toBe(true);
    expect(result.complete).toBe(true);
    expect(result.noLength).toBe(false);
  });

  test('one same-origin download plays the film and stores that file', async ({ page }) => {
    await page.route('**/local.json', async (route) => {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({ mediaBase: 'media' }),
      });
    });
    const hits = [];
    await page.route('**/media/vid/watched-lan.mp4', async (route) => {
      hits.push(route.request().headers()['range'] || '');
      await route.fulfill({
        status: 200,
        contentType: 'video/mp4',
        body: TINY_MP4,
      });
    });
    await page.goto('/');
    await page.waitForSelector('#home.active');
    await page.evaluate(async () => {
      const { startMediaFeed } = await import(new URL('./js/media-feed.js', location.href).href);
      const { storeMediaBlob } = await import(new URL('./js/offline.js', location.href).href);
      const video = document.createElement('video');
      video.autoplay = true;
      document.body.appendChild(video);
      startMediaFeed(video, new URL('media/vid/watched-lan.mp4', location.href).href, storeMediaBlob);
    });
    await expect.poll(() => hits.length).toBe(1);
    expect(hits[0]).toBe('');
    await expect.poll(async () => page.evaluate(async () => {
      const { getStoredMediaBlob } = await import(new URL('./js/offline.js', location.href).href);
      const blob = await getStoredMediaBlob('watched-lan.mp4', 'video');
      return blob ? blob.size : 0;
    })).toBe(TINY_MP4.length);
    const after = hits.length;
    await page.evaluate(async () => {
      const { renderQuestion } = await import(new URL('./js/ui.js', location.href).href);
      renderQuestion({
        id: 9004,
        q: 'Watch and keep',
        media: 'watched-lan.mp4',
        mediaType: 'video',
        type: 'basic',
        correct: 'T',
      }, document.querySelector('#quiz .question-card') || document.querySelector('.question-card'));
    });
    // Loopback + mediaBase media: play from disk URL, not a stored blob:.
    await expect(page.locator('#quiz .media-area video')).toHaveAttribute('src', /media\/vid\/watched-lan\.mp4/);
    await expect(page.locator('#quiz .media-area video')).not.toHaveAttribute('src', /^blob:/);
    await expect.poll(() => hits.length).toBe(after + 1);
  });

  test('leaving before the film arrives does not store it', async ({ page }) => {
    let release;
    const gate = new Promise((resolve) => { release = resolve; });
    const hits = [];
    await page.route('**/media/vid/leave-early.mp4', async (route) => {
      hits.push('start');
      await gate;
      hits.push('body');
      await route.fulfill({
        status: 200,
        contentType: 'video/mp4',
        body: TINY_MP4,
      });
    });
    await page.goto('/');
    await page.waitForSelector('#home.active');
    await page.evaluate(async () => {
      const { startMediaFeed } = await import(new URL('./js/media-feed.js', location.href).href);
      const { storeMediaBlob } = await import(new URL('./js/offline.js', location.href).href);
      const video = document.createElement('video');
      document.body.appendChild(video);
      startMediaFeed(video, new URL('media/vid/leave-early.mp4', location.href).href, storeMediaBlob);
    });
    await expect.poll(() => hits.length).toBe(1);
    await page.evaluate(async () => {
      const { abortMediaFeed } = await import(new URL('./js/media-feed.js', location.href).href);
      abortMediaFeed();
    });
    release();
    await page.waitForTimeout(400);
    const stored = await page.evaluate(async () => {
      const { getStoredMediaBlob } = await import(new URL('./js/offline.js', location.href).href);
      const blob = await getStoredMediaBlob('leave-early.mp4', 'video');
      return blob ? blob.size : 0;
    });
    expect(stored).toBe(0);
    expect(hits.filter((hit) => hit === 'start')).toEqual(['start']);
  });

  test('a CDN video is painted from one page fetch and then stored', async ({ page }) => {
    const videoHits = [];
    await page.route('**/local.json', async (route) => {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({ mediaBase: 'cdn' }),
      });
    });
    await page.route('https://f003.backblazeb2.com/file/prawko-maz/vid/viewed-once.mp4', async (route) => {
      if (route.request().method() === 'OPTIONS') {
        await route.fulfill({
          status: 204,
          headers: {
            'Access-Control-Allow-Origin': '*',
            'Access-Control-Allow-Methods': 'GET',
          },
        });
        return;
      }
      videoHits.push(route.request().headers()['range'] || '');
      await route.fulfill({
        status: 200,
        contentType: 'video/mp4',
        headers: { 'Access-Control-Allow-Origin': '*' },
        body: TINY_MP4,
      });
    });
    await page.goto('/');
    await page.waitForSelector('#home.active');
    await page.evaluate(async () => {
      const { renderQuestion } = await import(new URL('./js/ui.js', location.href).href);
      renderQuestion({
        id: 9002,
        q: 'Cache this film?',
        media: 'viewed-once.mp4',
        mediaType: 'video',
        type: 'basic',
        correct: 'T',
      }, document.querySelector('#quiz .question-card') || document.querySelector('.question-card'));
    });
    await expect(page.locator('#quiz .media-area video')).toHaveAttribute('src', /^blob:/);
    await expect.poll(() => videoHits.length).toBe(1);
    expect(videoHits[0]).toBe('');
    await expect.poll(async () => page.evaluate(async () => {
      const { getStoredMediaBlob } = await import(new URL('./js/offline.js', location.href).href);
      const blob = await getStoredMediaBlob('viewed-once.mp4', 'video');
      return blob ? blob.size : 0;
    }), { timeout: 5000 }).toBe(TINY_MP4.length);
  });

  test('same-origin local media paints with one element GET and is not copied', async ({ page }) => {
    const imageHits = [];
    await page.route('**/local.json', async (route) => {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({ mediaBase: 'media' }),
      });
    });
    await page.route('**/media/img/keep-local.webp', async (route) => {
      imageHits.push(route.request().resourceType());
      await route.fulfill({
        status: 200,
        contentType: 'image/webp',
        headers: { 'Access-Control-Allow-Origin': '*' },
        body: TINY_PNG,
      });
    });
    await page.goto('/');
    await page.waitForSelector('#home.active');
    await page.evaluate(async () => {
      const { renderQuestion } = await import(new URL('./js/ui.js', location.href).href);
      renderQuestion({
        id: 9011,
        q: 'Keep on disk',
        media: 'keep-local.webp',
        mediaType: 'image',
        type: 'basic',
        correct: 'T',
      }, document.querySelector('.question-card'));
    });
    const img = page.locator('#quiz .media-area img');
    await expect(img).toHaveAttribute('src', /media\/img\/keep-local\.webp/);
    await expect(img).not.toHaveAttribute('src', /^blob:/);
    await expect.poll(() => imageHits.length).toBe(1);
    expect(imageHits[0]).toBe('image');
    await page.waitForTimeout(400);
    const stored = await page.evaluate(async () => {
      const { getStoredMediaBlob } = await import(new URL('./js/offline.js', location.href).href);
      const blob = await getStoredMediaBlob('keep-local.webp', 'image');
      return blob ? blob.size : 0;
    });
    expect(stored).toBe(0);
  });

  test('playback stores viewed media on every host except this origin disk', () => {
    const fs = require('fs');
    const path = require('path');
    const ui = fs.readFileSync(path.join(__dirname, '../src/js/ui.js'), 'utf8');
    const offline = fs.readFileSync(path.join(__dirname, '../src/js/offline.js'), 'utf8');
    const feed = fs.readFileSync(path.join(__dirname, '../src/js/media-feed.js'), 'utf8');
    const start = ui.indexOf('const nextPlayableUrl');
    const end = ui.indexOf('const showMediaFallback');
    const fn = ui.slice(start, end);
    expect(fn).not.toMatch(/captureViewedMedia/);
    expect(offline).not.toMatch(/captureViewedMedia/);
    expect(fn).not.toMatch(/resolvePlayableMediaUrl/);
    expect(fn).toMatch(/getNextMediaUrl/);
    expect(ui).not.toMatch(/resolvePlayableMediaUrl/);
    expect(ui).toMatch(/function bindMediaElement/);
    expect(ui).toMatch(/startMediaFeed\(el, url, storeMediaBlob\)/);
    expect(ui).toMatch(/!remote && usesLocalMedia\(\) && isLoopbackHost\(\)/);
    expect(ui).not.toMatch(/serviceWorker\?\.controller/);
    expect(ui).not.toMatch(/workerStoresViewedMedia/);
    expect(ui).not.toMatch(/enqueueViewedMediaCopy/);
    expect(feed).toMatch(/elementNetworkFallback/);
    expect(feed).toMatch(/openMediaResponse/);
    expect(feed).toMatch(/paintFromCacheHit/);
    expect(feed).not.toMatch(/paintFromCachedUrl/);
    expect(feed).not.toMatch(/mediaFeedHasServiceWorker/);
    expect(feed).toMatch(/matchCachedMediaResponse\(url\)/);
    expect(feed).toMatch(/canUseOfflineMediaCache/);
    expect(feed).toMatch(/getStoredMediaBlob/);
    expect(feed).toMatch(/waitForAppOnline/);
    expect(feed).toMatch(/matchStoredMediaBlob/);
    expect(feed).toMatch(/Range:\s*`bytes=\$\{received\}-/);
    expect(feed).toMatch(/openOfflineMediaCache/);
    expect(feed).toMatch(/offlineMediaCachePromise/);
    const matchCache = feed.slice(
      feed.indexOf('async function matchCachedMediaResponse'),
      feed.indexOf('function mediaRefFromUrl'),
    );
    expect(matchCache).not.toMatch(/ignoreSearch\s*:/);
    expect(matchCache).not.toMatch(/ignoreVary\s*:/);
    expect(matchCache).toMatch(/cache\.match\(abs\)/);
    const openMedia = feed.slice(
      feed.indexOf('async function openMediaResponse'),
      feed.indexOf('function playIfWanted'),
    );
    expect(openMedia).toMatch(/canUseOfflineMediaCache/);
    expect(openMedia.indexOf('matchStoredMediaBlob')).toBeLessThan(openMedia.indexOf('fetch(url'));
    expect(feed).not.toMatch(/mediaPerfMark|prawko-media-/);
    expect(feed).toMatch(/FILM_PACE_MIN_SAMPLE = 0\.3/);
    const offlineSrc = fs.readFileSync(path.join(__dirname, '../src/js/offline.js'), 'utf8');
    expect(offlineSrc).not.toMatch(/ignoreSearch\s*:/);
    expect(offlineSrc).not.toMatch(/ignoreVary\s*:/);
    expect(offlineSrc).toMatch(/canUseOfflineMediaCache/);
    expect(offlineSrc).toMatch(/waitForAppOnline/);
    expect(ui).not.toMatch(/prawko-media-config/);
    const loadImage = feed.slice(feed.indexOf('async function loadImage'), feed.indexOf('async function loadFilm'));
    expect(loadImage).toMatch(/elementNetworkFallback/);
    expect(loadImage).toMatch(/paintFromCacheHit/);
    expect(loadImage).toMatch(/paintFromBlob/);
    expect(feed).toMatch(/async function paintFromCacheHit[\s\S]*paintFromBlob\(el, blob, null/);
    expect(feed).toMatch(/async function paintFromBlob[\s\S]*store\(url, blob\)/);
    expect(feed).toMatch(/async function paintFromBlob[\s\S]*createObjectURL/);
    expect(feed).toMatch(/X-Prawko-From-Cache/);
    const sw = fs.readFileSync(path.join(__dirname, '../src/sw.js'), 'utf8');
    expect(sw).toMatch(/function viewedMediaStaysOnDisk/);
    expect(sw).toMatch(/function isLoopbackHostName/);
    expect(sw).toMatch(/isLoopbackHostName\(self\.location\.hostname\)/);
    expect(sw).toMatch(/url\.origin === self\.location\.origin/);
    expect(sw).toMatch(/fetchAndRememberMedia/);
    expect(sw).toMatch(/rememberPlayedMedia/);
    expect(sw).toMatch(/X-Prawko-From-Cache/);
    expect(sw).toMatch(/cached\.clone\(\)/);
  });

  test('loopback local videos are not copied into the offline cache', async ({ page }) => {
    await page.route('**/local.json', async (route) => {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({ mediaBase: 'media' }),
      });
    });
    await page.route('**/media/vid/keep-local.mp4', async (route) => {
      await route.fulfill({
        status: 200,
        contentType: 'video/mp4',
        headers: { 'Access-Control-Allow-Origin': '*' },
        body: TINY_MP4,
      });
    });
    await page.goto('/');
    await page.waitForSelector('#home.active');
    await page.evaluate(async () => {
      const { renderQuestion } = await import(new URL('./js/ui.js', location.href).href);
      renderQuestion({
        id: 9012,
        q: 'Keep film on disk',
        media: 'keep-local.mp4',
        mediaType: 'video',
        type: 'basic',
        correct: 'T',
      }, document.querySelector('#quiz .question-card') || document.querySelector('.question-card'));
    });
    await expect(page.locator('#quiz .media-area video')).toHaveAttribute('src', /media\/vid\/keep-local\.mp4/);
    await page.waitForTimeout(400);
    const stored = await page.evaluate(async () => {
      const { getStoredMediaBlob } = await import(new URL('./js/offline.js', location.href).href);
      const blob = await getStoredMediaBlob('keep-local.mp4', 'video');
      return blob ? blob.size : 0;
    });
    expect(stored).toBe(0);
  });

  test('a slow image shows a spinner until the file arrives', async ({ page }) => {
    let release;
    const gate = new Promise((resolve) => { release = resolve; });
    await page.route('**/local.json', async (route) => {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({ mediaBase: 'cdn' }),
      });
    });
    await page.route('https://f003.backblazeb2.com/file/prawko-maz/img/slow-spin.webp', async (route) => {
      if (route.request().method() === 'OPTIONS') {
        await route.fulfill({
          status: 204,
          headers: { 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Methods': 'GET' },
        });
        return;
      }
      await gate;
      await route.fulfill({
        status: 200,
        contentType: 'image/png',
        headers: { 'Access-Control-Allow-Origin': '*' },
        body: TINY_PNG,
      });
    });
    await page.goto('/');
    await page.waitForSelector('#home.active');
    await page.evaluate(async () => {
      const { renderQuestion } = await import(new URL('./js/ui.js', location.href).href);
      renderQuestion({
        id: 9010,
        q: 'Slow photo',
        media: 'slow-spin.webp',
        mediaType: 'image',
        type: 'basic',
        correct: 'T',
      }, document.querySelector('.question-card'));
    });
    const area = page.locator('#quiz .media-area');
    await expect(area).toHaveClass(/loading/);
    await expect.poll(() => area.evaluate((el) => getComputedStyle(el, '::after').animationName)).toBe('spin');
    release();
    await expect(area).not.toHaveClass(/loading/, { timeout: 5000 });
  });

  test('a stalled film shows the spinner again and a pause does not', async ({ page }) => {
    await page.route('**/local.json', async (route) => {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({ mediaBase: 'cdn' }),
      });
    });
    await page.route('https://f003.backblazeb2.com/file/prawko-maz/vid/stall-spin.mp4', async (route) => {
      if (route.request().method() === 'OPTIONS') {
        await route.fulfill({
          status: 204,
          headers: { 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Methods': 'GET' },
        });
        return;
      }
      await route.fulfill({
        status: 200,
        contentType: 'video/mp4',
        headers: { 'Access-Control-Allow-Origin': '*' },
        body: TINY_MP4,
      });
    });
    await page.goto('/');
    await page.waitForSelector('#home.active');
    await page.evaluate(async () => {
      const { renderQuestion } = await import(new URL('./js/ui.js', location.href).href);
      renderQuestion({
        id: 9011,
        q: 'Stall',
        media: 'stall-spin.mp4',
        mediaType: 'video',
        type: 'basic',
        correct: 'T',
      }, document.querySelector('.question-card'));
    });
    await expect(page.locator('#quiz .media-area video')).toHaveCount(1);
    const result = await page.evaluate(() => {
      const area = document.querySelector('#quiz .media-area');
      const video = area.querySelector('video');
      const button = area.querySelector('.media-replay-btn');
      button.hidden = false;
      const swatch = document.createElement('button');
      swatch.className = 'media-replay-btn';
      swatch.style.display = 'inline-flex';
      document.body.appendChild(swatch);
      const bg = getComputedStyle(swatch).backgroundColor;
      swatch.remove();
      const setReady = (n) => {
        Object.defineProperty(video, 'readyState', { configurable: true, get: () => n });
      };
      Object.defineProperty(video, 'ended', { configurable: true, get: () => false });
      video.play = () => new Promise(() => {});
      setReady(1);
      area.classList.remove('loading');
      button.dataset.mode = 'resume';
      button.click();
      video.dispatchEvent(new Event('waiting'));
      const whileStalled = area.classList.contains('loading');
      video.dispatchEvent(new Event('playing'));
      const afterPlay = area.classList.contains('loading');
      area.classList.add('loading');
      setReady(2);
      video.dispatchEvent(new Event('canplay'));
      const frameHeld = area.classList.contains('loading');
      button.dataset.mode = 'pause';
      button.click();
      video.dispatchEvent(new Event('waiting'));
      const whilePaused = area.classList.contains('loading');
      setReady(1);
      area.classList.remove('loading');
      const srcBefore = video.src;
      button.dataset.mode = 'resume';
      button.click();
      const resumeStarved = area.classList.contains('loading');
      const srcAfter = video.src;
      video.dispatchEvent(new Event('playing'));
      setReady(4);
      area.classList.remove('loading');
      button.dataset.mode = 'resume';
      button.click();
      const resumeReady = area.classList.contains('loading');
      return {
        whileStalled,
        afterPlay,
        frameHeld,
        whilePaused,
        resumeStarved,
        resumeReady,
        srcSame: srcBefore === srcAfter,
        bg,
      };
    });
    expect(result.whileStalled).toBe(true);
    expect(result.afterPlay).toBe(false);
    expect(result.frameHeld).toBe(true);
    expect(result.whilePaused).toBe(false);
    expect(result.resumeStarved).toBe(true);
    expect(result.resumeReady).toBe(false);
    expect(result.srcSame).toBe(true);
    const alpha = Number((String(result.bg).match(/\/\s*([0-9.]+)\s*\)/) || [])[1]);
    expect(alpha).toBeGreaterThan(0.2);
    expect(alpha).toBeLessThan(0.5);
  });

  test('pausing a film does not start a second download', async ({ page }) => {
    let release;
    const gate = new Promise((resolve) => { release = resolve; });
    const hits = [];
    await page.route('**/local.json', async (route) => {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({ mediaBase: 'cdn' }),
      });
    });
    await page.route('https://f003.backblazeb2.com/file/prawko-maz/vid/pause-dl.mp4', async (route) => {
      if (route.request().method() === 'OPTIONS') {
        await route.fulfill({
          status: 204,
          headers: { 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Methods': 'GET' },
        });
        return;
      }
      hits.push(route.request().method());
      await gate;
      await route.fulfill({
        status: 200,
        contentType: 'video/mp4',
        headers: { 'Access-Control-Allow-Origin': '*' },
        body: TINY_MP4,
      });
    });
    await page.goto('/');
    await page.waitForSelector('#home.active');
    await page.evaluate(async () => {
      const { renderQuestion } = await import(new URL('./js/ui.js', location.href).href);
      renderQuestion({
        id: 9012,
        q: 'Pause does not fetch again',
        media: 'pause-dl.mp4',
        mediaType: 'video',
        type: 'basic',
        correct: 'T',
      }, document.querySelector('.question-card'));
    });
    await expect.poll(() => hits.length).toBeGreaterThan(0);
    const duringPlay = hits.length;
    await page.evaluate(() => {
      const area = document.querySelector('#quiz .media-area');
      const button = area.querySelector('.media-replay-btn');
      button.hidden = false;
      button.dataset.mode = 'pause';
      button.click();
    });
    await page.waitForTimeout(700);
    expect(hits.length).toBe(duringPlay);
    release();
  });

  test('the empty media slot is a gray plate on light and a lifted black on dark', async ({ page }) => {
    await page.goto('/');
    await page.waitForSelector('#home.active');
    const result = await page.evaluate(() => {
      const lum = (css) => {
        const text = String(css);
        const nums = (text.match(/[\d.]+/g) || []).map(Number);
        let [r, g, b] = nums;
        if (/^color\(/i.test(text) && r <= 1 && g <= 1 && b <= 1) {
          r *= 255;
          g *= 255;
          b *= 255;
        }
        return 0.2126 * r + 0.7152 * g + 0.0722 * b;
      };
      const read = (theme) => {
        if (theme === 'dark') document.documentElement.dataset.theme = 'dark';
        else delete document.documentElement.dataset.theme;
        const pageBg = document.createElement('div');
        pageBg.style.background = 'var(--bg)';
        const slot = document.createElement('div');
        slot.className = 'media-area has-media loading awaiting-frame';
        slot.style.cssText = 'position:fixed;left:8px;top:8px;width:240px;z-index:99999';
        const video = document.createElement('video');
        slot.appendChild(video);
        document.body.append(pageBg, slot);
        const bg = lum(getComputedStyle(pageBg).backgroundColor);
        const plate = lum(getComputedStyle(slot, '::before').backgroundColor);
        const videoHidden = getComputedStyle(video).visibility;
        pageBg.remove();
        slot.remove();
        return { bg, plate, videoHidden };
      };
      const light = read('light');
      const dark = read('dark');
      delete document.documentElement.dataset.theme;
      return { light, dark };
    });
    expect(result.light.plate).toBeLessThan(result.light.bg - 8);
    expect(result.dark.plate).toBeGreaterThan(result.dark.bg + 6);
    expect(result.dark.plate).toBeLessThan(40);
    expect(result.light.videoHidden).toBe('hidden');
    expect(result.dark.videoHidden).toBe('hidden');
  });

  test('the media spinner keeps turning when motion is reduced', async ({ page }) => {
    await page.emulateMedia({ reducedMotion: 'reduce' });
    await page.goto('/');
    await page.waitForSelector('#home.active');
    const result = await page.evaluate(() => {
      const area = document.createElement('div');
      area.className = 'media-area loading';
      area.style.cssText = 'position:fixed;left:8px;top:8px;width:200px;z-index:99999';
      document.body.appendChild(area);
      const ring = getComputedStyle(area, '::after');
      const veil = getComputedStyle(area, '::before');
      const alpha = Number((veil.backgroundColor.match(/[\d.]+(?=\s*\))/) || [])[0]);
      const out = {
        name: ring.animationName,
        duration: parseFloat(ring.animationDuration),
        count: ring.animationIterationCount,
        width: parseFloat(ring.width),
        mask: ring.maskImage || ring.webkitMaskImage || '',
        arc: ring.backgroundImage,
        alpha,
      };
      area.remove();
      return out;
    });
    expect(result.name).toBe('spin');
    expect(result.duration).toBeGreaterThan(0.5);
    expect(result.count).toBe('infinite');
    expect(result.width).toBeGreaterThanOrEqual(70);
    expect(result.mask).toContain('radial-gradient');
    expect(result.arc).toContain('conic-gradient');
    expect(result.alpha).toBeGreaterThan(0.3);
    expect(result.alpha).toBeLessThan(0.55);
  });

  test('reconcile drops downloaded when current JSON media is incomplete in cache', async ({ page }) => {
    await stubRemoteMedia(page);
    await page.goto('/');
    await page.waitForSelector('#home.active');
    const result = await page.evaluate(async () => {
      const { getMediaUrls, fetchCategoryMediaList } = await import(new URL('./js/data.js', location.href).href);
      const {
        reconcileDownloadedCategories,
        getDownloadedCategories,
        getCategoriesOfflineCoverage,
      } = await import(new URL('./js/offline.js', location.href).href);
      const list = await fetchCategoryMediaList('B');
      const media = (list.questions || []).map((q) => q.media).filter(Boolean);
      if (media.length < 2) return { ok: false, reason: 'need-media' };
      const keep = media[0];
      const cache = await caches.open('prawko-offline-media-v1');
      for (const url of getMediaUrls(keep, 'image')) {
        await cache.put(
          new Request(url, { mode: 'cors' }),
          new Response(new Uint8Array([1]), { headers: { 'Content-Type': 'image/webp' } }),
        );
      }
      const allUrls = [];
      for (const name of media) {
        allUrls.push(...getMediaUrls(name, 'image'));
      }
      localStorage.setItem('prawko_offline', JSON.stringify(['B']));
      localStorage.setItem('prawko_offline_manifest', JSON.stringify({ B: allUrls }));
      const before = getDownloadedCategories().has('B');
      const verified = await reconcileDownloadedCategories();
      const cov = await getCategoriesOfflineCoverage(['B']);
      return {
        ok: true,
        before,
        after: verified.has('B'),
        pct: cov.B?.pct,
        manifest: localStorage.getItem('prawko_offline_manifest'),
      };
    });
    expect(result.ok).toBe(true);
    expect(result.before).toBe(true);
    expect(result.after).toBe(false);
    expect(result.pct).toBeLessThan(100);
    expect(result.manifest).not.toMatch(/"B"/);
  });

  test('file download delta skips cached URLs and GCs orphan names from old manifest', async ({ page }) => {
    await stubRemoteMedia(page);
    await page.goto('/');
    await page.waitForSelector('#home.active');
    const result = await page.evaluate(async () => {
      const { getMediaUrls, fetchCategoryMediaList } = await import(new URL('./js/data.js', location.href).href);
      const {
        downloadCategoryMediaFromFiles,
        getCachedUrlSet,
        getCategoriesOfflineCoverage,
      } = await import(new URL('./js/offline.js', location.href).href);
      const list = await fetchCategoryMediaList('PT');
      const names = [...new Set((list.questions || []).map((q) => q.media).filter(Boolean))];
      if (names.length < 2) return { ok: false, reason: 'need-media' };
      const cache = await caches.open('prawko-offline-media-v1');
      const neededUrls = [];
      for (const name of names) {
        const kind = /\.mp4$/i.test(name) ? 'video' : 'image';
        for (const url of getMediaUrls(name, kind)) neededUrls.push(url);
      }
      // Leave the first media out so coverage shows a one-file delta.
      for (const name of names.slice(1)) {
        const kind = /\.mp4$/i.test(name) ? 'video' : 'image';
        for (const url of getMediaUrls(name, kind)) {
          await cache.put(
            new Request(url, { mode: 'cors' }),
            new Response(new Uint8Array([9]), { headers: { 'Content-Type': 'application/octet-stream' } }),
          );
        }
      }
      const partial = await getCategoriesOfflineCoverage(['PT']);
      // Seed the missing file so download is a no-op fetch, then GC the orphan.
      const first = names[0];
      const firstKind = /\.mp4$/i.test(first) ? 'video' : 'image';
      for (const url of getMediaUrls(first, firstKind)) {
        await cache.put(
          new Request(url, { mode: 'cors' }),
          new Response(new Uint8Array([8]), { headers: { 'Content-Type': 'application/octet-stream' } }),
        );
      }
      const orphanUrls = getMediaUrls('orphan-sync-gc.webp', 'image');
      for (const url of orphanUrls) {
        await cache.put(
          new Request(url, { mode: 'cors' }),
          new Response(new Uint8Array([7]), { headers: { 'Content-Type': 'image/webp' } }),
        );
      }
      localStorage.setItem('prawko_offline_manifest', JSON.stringify({
        PT: [...neededUrls, ...orphanUrls],
      }));
      let fetches = 0;
      const origFetch = window.fetch.bind(window);
      window.fetch = (input, init) => {
        const href = String(input?.url || input);
        if (/\.(webp|mp4|webm|jpg|jpeg|png|gif)(\?|$)/i.test(href)) fetches += 1;
        return origFetch(input, init);
      };
      let downloaded;
      try {
        downloaded = await downloadCategoryMediaFromFiles('PT');
      } finally {
        window.fetch = origFetch;
      }
      const cached = await getCachedUrlSet();
      const orphanGone = ![...cached].some((k) => String(k).includes('orphan-sync-gc'));
      return {
        ok: true,
        fetches,
        success: downloaded.success,
        partialHave: partial.PT?.have,
        partialTotal: partial.PT?.total,
        orphanGone,
      };
    });
    expect(result.ok).toBe(true);
    expect(result.partialTotal).toBeGreaterThan(1);
    expect(result.partialHave).toBe(result.partialTotal - 1);
    expect(result.success).toBe(true);
    expect(result.fetches).toBe(0);
    expect(result.orphanGone).toBe(true);
  });

  test('reconcile does not delete another category file listed only on a shared pack', async ({ page }) => {
    await stubRemoteMedia(page);
    await page.goto('/');
    await page.waitForSelector('#home.active');
    const result = await page.evaluate(async () => {
      const { getMediaUrls } = await import(new URL('./js/data.js', location.href).href);
      const {
        reconcileDownloadedCategories,
        getCachedUrlSet,
      } = await import(new URL('./js/offline.js', location.href).href);
      const sharedForB = 'shared-keep-for-b.webp';
      const sharedUrls = getMediaUrls(sharedForB, 'image');
      const cache = await caches.open('prawko-offline-media-v1');
      for (const url of sharedUrls) {
        await cache.put(
          new Request(url, { mode: 'cors' }),
          new Response(new Uint8Array([3, 3, 3]), { headers: { 'Content-Type': 'image/webp' } }),
        );
      }
      // C was "downloaded" with an old manifest; packsDone claims a shared zip
      // that also listed B's file. Reconcile must not treat that as C's orphan.
      localStorage.setItem('prawko_offline', JSON.stringify(['C']));
      localStorage.setItem('prawko_offline_manifest', JSON.stringify({
        C: getMediaUrls('only-c.webp', 'image'),
      }));
      localStorage.setItem('prawko_offline_packs', JSON.stringify({
        'set-A-B-C-shared': {
          sha256: 'abc',
          names: [sharedForB, 'only-c.webp'],
        },
      }));
      await reconcileDownloadedCategories();
      const cached = await getCachedUrlSet();
      const kept = [...cached].some((k) => String(k).includes(sharedForB));
      return { kept, cachedSize: cached.size };
    });
    expect(result.kept).toBe(true);
  });
});
