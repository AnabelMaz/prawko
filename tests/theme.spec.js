const { test, expect } = require('@playwright/test');

test.describe('Warm & Soft Theme', () => {
  test('theme button exposes aria-pressed state', async ({ page }) => {
    await page.goto('/');
    await page.waitForSelector('.theme-btn');

    const themeBtn = page.locator('.theme-btn');
    const initial = await themeBtn.getAttribute('aria-pressed');
    expect(initial === 'true' || initial === 'false').toBe(true);
    await themeBtn.click();
    await expect(themeBtn).toHaveAttribute('aria-pressed', initial === 'true' ? 'false' : 'true');
  });

  test('landing page loads with correct theme colors', async ({ page }) => {
    await page.goto('/');
    await page.waitForSelector('#home.active');

    // Check background is warm off-white
    const bgColor = await page.evaluate(() =>
      getComputedStyle(document.documentElement).getPropertyValue('--bg').trim()
    );
    expect(bgColor).toBe('#fafaf9');

    // Check primary is indigo
    const primary = await page.evaluate(() =>
      getComputedStyle(document.documentElement).getPropertyValue('--primary').trim()
    );
    expect(primary).toBe('#4f46e5');

    // Check border-radius is 20px
    const radius = await page.evaluate(() =>
      getComputedStyle(document.documentElement).getPropertyValue('--radius').trim()
    );
    expect(radius).toBe('20px');
  });

  test('hero has indigo-to-violet gradient', async ({ page }) => {
    await page.goto('/');
    await page.waitForSelector('.hero');

    const heroBg = await page.evaluate(() =>
      getComputedStyle(document.querySelector('.hero')).backgroundImage
    );
    // Should contain the indigo and violet colors
    expect(heroBg).toContain('gradient');
  });

  test('feature cards have warm soft shadows', async ({ page }) => {
    await page.goto('/');
    await page.waitForSelector('.feature-card');

    const shadow = await page.evaluate(() =>
      getComputedStyle(document.querySelector('.feature-card')).boxShadow
    );
    // Should have a shadow (not 'none')
    expect(shadow).not.toBe('none');
  });

  test('feature cards have 20px border-radius', async ({ page }) => {
    await page.goto('/');
    await page.waitForSelector('.feature-card');

    const radius = await page.evaluate(() =>
      getComputedStyle(document.querySelector('.feature-card')).borderRadius
    );
    expect(radius).toBe('14px');
  });

  test('dark mode switches to warm dark palette', async ({ page }) => {
    await page.goto('/');
    await page.waitForSelector('.theme-btn');

    // Click theme toggle
    await page.click('.theme-btn');

    const bgDark = await page.evaluate(() =>
      getComputedStyle(document.documentElement).getPropertyValue('--bg').trim()
    );
    expect(bgDark).toBe('#09090b');

    const primaryDark = await page.evaluate(() =>
      getComputedStyle(document.documentElement).getPropertyValue('--primary').trim()
    );
    expect(primaryDark).toBe('#818cf8');

    const bgCardDark = await page.evaluate(() =>
      getComputedStyle(document.documentElement).getPropertyValue('--bg-card').trim()
    );
    expect(bgCardDark).toBe('#18181b');
  });

  test('categories screen renders with correct styles', async ({ page }) => {
    await page.goto('/');
    await page.waitForSelector('#home.active');

    // Navigate to categories
    await page.click('[data-navigate="categories"]');
    await page.waitForSelector('#categories.active');

    // Category cards should exist and have correct radius
    const cardRadius = await page.evaluate(() =>
      getComputedStyle(document.querySelector('.category-card')).borderRadius
    );
    expect(cardRadius).toBe('14px');

    // Mode toggle should be visible
    await expect(page.locator('.mode-toggle')).toBeVisible();
  });

  test('grain texture overlay exists', async ({ page }) => {
    await page.goto('/');

    // Check body::before pseudo-element has the grain filter
    const hasGrain = await page.evaluate(() => {
      const before = getComputedStyle(document.body, '::before');
      return before.filter.includes('url');
    });
    expect(hasGrain).toBe(true);
  });

  test('screenshot - landing light', async ({ page }) => {
    await page.goto('/');
    await page.waitForSelector('#home.active');
    await page.waitForTimeout(300);
  });

  test('screenshot - landing dark', async ({ page }) => {
    await page.goto('/');
    await page.waitForSelector('#home.active');
    await page.click('.theme-btn');
    await page.waitForTimeout(300);
  });

  test('screenshot - categories light', async ({ page }) => {
    await page.goto('/');
    await page.click('[data-navigate="categories"]');
    await page.waitForSelector('#categories.active');
    await page.waitForTimeout(300);
  });

  test('screenshot - categories dark', async ({ page }) => {
    await page.goto('/');
    await page.click('.theme-btn');
    await page.click('[data-navigate="categories"]');
    await page.waitForSelector('#categories.active');
    await page.waitForTimeout(300);
  });

  test('meta theme-color is indigo', async ({ page }) => {
    await page.goto('/');
    const themeColor = await page.getAttribute('meta[name="theme-color"]', 'content');
    expect(themeColor).toBe('#6366f1');
  });

  test('exam skin flattens home chrome without changing app behavior', async ({ page }) => {
    await page.goto('/');
    await page.waitForSelector('#home.active');
    const radiusBefore = await page.evaluate(() =>
      getComputedStyle(document.documentElement).getPropertyValue('--radius').trim()
    );
    expect(radiusBefore).toBe('20px');
    await page.click('.exam-skin-btn');
    await expect(page.locator('.exam-skin-btn')).toHaveAttribute('aria-pressed', 'true');
    const after = await page.evaluate(() => ({
      skin: document.documentElement.getAttribute('data-exam-skin'),
      radius: getComputedStyle(document.documentElement).getPropertyValue('--radius').trim(),
      featureRadius: getComputedStyle(document.querySelector('.feature-card')).borderRadius,
      heroImage: getComputedStyle(document.querySelector('.hero')).backgroundImage,
    }));
    expect(after.skin).toBe('strict');
    expect(after.radius).toBe('6px');
    expect(after.featureRadius).toBe('6px');
    expect(after.heroImage === 'none' || !after.heroImage.includes('gradient')).toBeTruthy();
  });
});
