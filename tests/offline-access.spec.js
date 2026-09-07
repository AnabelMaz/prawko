const { test, expect } = require('@playwright/test');

async function openCategories(page) {
  await page.goto('/');
  await page.waitForSelector('#home.active');
  await page.click('[data-navigate="categories"]');
  await page.waitForSelector('#categories.active');
  await page.waitForSelector('.category-grid .category-card[data-category="B"] .offline-btn');
}

async function stubRemoteMedia(page) {
  await page.route('**/js/data.js', async (route) => {
    const response = await route.fetch();
    const body = (await response.text()).replace(
      /export const MEDIA_BASE = [^;]+;/,
      "export const MEDIA_BASE = 'https://cdn.example.test/prawko';"
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
});
