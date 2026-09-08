const { test, expect } = require('@playwright/test');

async function openCategories(page) {
  await page.goto('/');
  await page.waitForSelector('#home.active');
  await page.click('[data-navigate="categories"]');
  await page.waitForSelector('#categories.active');
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
    expect(table[1]).toMatchObject({ available: true, offlineReady: true, canDownload: false });
    expect(table[2]).toMatchObject({ available: true, offlineReady: false, canDownload: true });
    expect(table[3]).toMatchObject({ available: false, offlineReady: false, canDownload: false });
  });

  test('local.json mediaBase cdn treats localhost like github.io', async ({ page }) => {
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
});
