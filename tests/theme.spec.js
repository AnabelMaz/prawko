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

    const radius = await page.evaluate(() =>
      getComputedStyle(document.documentElement).getPropertyValue('--radius').trim()
    );
    expect(radius).toBe('20px');
  });

  test('Station skin uses flattened examiner chrome on home', async ({ page }) => {
    await page.goto('/');
    await page.waitForSelector('.skin-btn');
    await page.click('.skin-btn');
    await expect(page.locator('.skin-btn')).toHaveText('Stacja');
    await page.waitForSelector('.hero');

    const hero = await page.evaluate(() => {
      const el = document.querySelector('.hero');
      const cs = getComputedStyle(el);
      return { bg: cs.backgroundImage, color: cs.backgroundColor };
    });
    expect(hero.bg === 'none' || !hero.bg.includes('gradient')).toBeTruthy();
  });

  test('feature cards have no drop shadow in Station examiner chrome', async ({ page }) => {
    await page.goto('/');
    await page.waitForSelector('.skin-btn');
    await page.click('.skin-btn');
    await expect(page.locator('.skin-btn')).toHaveText('Stacja');
    await expect(page.locator('html')).toHaveAttribute('data-exam-skin', 'station');
    await page.waitForSelector('.feature-card');
    await page.waitForFunction(() =>
      getComputedStyle(document.querySelector('.feature-card')).boxShadow === 'none'
    );

    const shadow = await page.evaluate(() =>
      getComputedStyle(document.querySelector('.feature-card')).boxShadow
    );
    expect(shadow).toBe('none');
  });

  test('feature cards have 6px border-radius in Station examiner chrome', async ({ page }) => {
    await page.goto('/');
    await page.waitForSelector('.skin-btn');
    await page.click('.skin-btn');
    await expect(page.locator('.skin-btn')).toHaveText('Stacja');
    await page.waitForSelector('.feature-card');

    const radius = await page.evaluate(() =>
      getComputedStyle(document.querySelector('.feature-card')).borderRadius
    );
    expect(radius).toBe('6px');
  });

  test('light theme uses a black Windows pointer, dark theme a white one', async ({ page }) => {
    await page.goto('/');
    await page.waitForSelector('.theme-btn');

    const light = await page.evaluate(() => ({
      body: getComputedStyle(document.body).cursor,
      btn: getComputedStyle(document.querySelector('.theme-btn')).cursor,
      rest: getComputedStyle(document.documentElement).getPropertyValue('--cursor-rest'),
      click: getComputedStyle(document.documentElement).getPropertyValue('--cursor-click'),
    }));
    expect(light.rest).toMatch(/cursor-black\.png/);
    expect(light.click).toMatch(/cursor-pointer-black\.png/);
    expect(light.body).toMatch(/cursor-black\.png/);
    expect(light.btn).toMatch(/cursor-pointer-black\.png/);

    await page.click('.theme-btn');
    await expect(page.locator('html')).toHaveAttribute('data-theme', 'dark');

    const dark = await page.evaluate(() => ({
      body: getComputedStyle(document.body).cursor,
      btn: getComputedStyle(document.querySelector('.theme-btn')).cursor,
      rest: getComputedStyle(document.documentElement).getPropertyValue('--cursor-rest'),
      click: getComputedStyle(document.documentElement).getPropertyValue('--cursor-click'),
    }));
    expect(dark.rest).toMatch(/cursor-white\.png/);
    expect(dark.click).toMatch(/cursor-pointer-white\.png/);
    expect(dark.body).toMatch(/cursor-white\.png/);
    expect(dark.btn).toMatch(/cursor-pointer-white\.png/);
  });

  test('category cards use the themed Windows pointing-hand cursor', async ({ page }) => {
    await page.goto('/');
    await page.click('[data-navigate="categories"]');
    await page.waitForSelector('.category-card');
    const cursor = await page.evaluate(() =>
      getComputedStyle(document.querySelector('.category-card')).cursor
    );
    expect(cursor).toMatch(/cursor-pointer-black\.png/);
  });

  test('cursor PNGs are Windows aero_arrow / aero_link with inverted Black style', () => {
    const fs = require('fs');
    const path = require('path');
    const zlib = require('zlib');
    const icons = path.resolve(__dirname, '..', 'src', 'icons');

    function pngInfo(name) {
      const data = fs.readFileSync(path.join(icons, name));
      expect(data.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]))).toBe(true);
      let i = 8;
      const chunks = {};
      while (i < data.length) {
        const n = data.readUInt32BE(i);
        const tag = data.subarray(i + 4, i + 8).toString('ascii');
        chunks[tag] = Buffer.concat([chunks[tag] || Buffer.alloc(0), data.subarray(i + 8, i + 8 + n)]);
        i += 12 + n;
        if (tag === 'IEND') break;
      }
      const w = chunks.IHDR.readUInt32BE(0);
      const h = chunks.IHDR.readUInt32BE(4);
      const raw = zlib.inflateSync(chunks.IDAT);
      const stride = w * 4;
      let opaque = 0;
      let lumSum = 0;
      for (let y = 0; y < h; y++) {
        const row = 1 + y * (1 + stride);
        for (let x = 0; x < w; x++) {
          const o = row + x * 4;
          const a = raw[o + 3];
          if (a > 200) {
            opaque += 1;
            lumSum += (raw[o] + raw[o + 1] + raw[o + 2]) / 3;
          }
        }
      }
      return { w, h, opaque, meanLum: lumSum / opaque };
    }

    const whiteArrow = pngInfo('cursor-white.png');
    const blackArrow = pngInfo('cursor-black.png');
    const whiteHand = pngInfo('cursor-pointer-white.png');
    const blackHand = pngInfo('cursor-pointer-black.png');
    for (const info of [whiteArrow, blackArrow, whiteHand, blackHand]) {
      expect(info.w).toBe(32);
      expect(info.h).toBe(32);
      expect(info.opaque).toBeGreaterThan(80);
    }
    expect(whiteArrow.meanLum).toBeGreaterThan(150);
    expect(blackArrow.meanLum).toBeLessThan(90);
    expect(whiteHand.meanLum).toBeGreaterThan(150);
    expect(blackHand.meanLum).toBeLessThan(90);
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

  test('grain texture overlay exists in Panel chrome', async ({ page }) => {
    await page.goto('/');
    await expect(page.locator('.skin-btn')).toHaveText('Panel');

    const hasGrain = await page.evaluate(() => {
      const before = getComputedStyle(document.body, '::before');
      return before.filter.includes('url') && before.display !== 'none';
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

  test('Panel skin is on by default and keeps the branded home', async ({ page }) => {
    await page.goto('/');
    await page.waitForSelector('#home.active');
    const panel = await page.evaluate(() => ({
      skin: document.documentElement.getAttribute('data-exam-skin'),
      radius: getComputedStyle(document.documentElement).getPropertyValue('--radius').trim(),
      featureRadius: getComputedStyle(document.querySelector('.feature-card')).borderRadius,
      heroImage: getComputedStyle(document.querySelector('.hero')).backgroundImage,
    }));
    expect(panel.skin).toBe('panel');
    expect(panel.radius).toBe('20px');
    expect(panel.featureRadius).toBe('14px');
    expect(panel.heroImage).toContain('gradient');
    await expect(page.locator('.skin-btn')).toHaveText('Panel');
    await expect(page.locator('.skin-btn')).toHaveAttribute('aria-pressed', 'true');
  });

  test('Station skin flattens home to examiner chrome', async ({ page }) => {
    await page.goto('/');
    await page.waitForSelector('#home.active');
    await page.click('.skin-btn');
    await expect(page.locator('.skin-btn')).toHaveText('Stacja');
    await expect(page.locator('.skin-btn')).toHaveAttribute('aria-pressed', 'false');
    const after = await page.evaluate(() => ({
      skin: document.documentElement.getAttribute('data-exam-skin'),
      radius: getComputedStyle(document.documentElement).getPropertyValue('--radius').trim(),
      featureRadius: getComputedStyle(document.querySelector('.feature-card')).borderRadius,
      heroImage: getComputedStyle(document.querySelector('.hero')).backgroundImage,
    }));
    expect(after.skin).toBe('station');
    expect(after.radius).toBe('6px');
    expect(after.featureRadius).toBe('6px');
    expect(after.heroImage === 'none' || !after.heroImage.includes('gradient')).toBeTruthy();
  });
});

const quizThemeViews = [
  { skin: 'panel', orient: 'portrait', viewport: { width: 420, height: 900 } },
  { skin: 'panel', orient: 'landscape', viewport: { width: 1280, height: 800 } },
  { skin: 'station', orient: 'portrait', viewport: { width: 420, height: 900 } },
  { skin: 'station', orient: 'landscape', viewport: { width: 1280, height: 800 } },
];

function rgbChannels(color) {
  const m = String(color).match(/rgba?\((\d+),\s*(\d+),\s*(\d+)/);
  if (!m) return null;
  return [Number(m[1]), Number(m[2]), Number(m[3])];
}

function relativeLuminance(color) {
  const rgb = rgbChannels(color);
  if (!rgb) return 1;
  const lin = rgb.map((n) => {
    const v = n / 255;
    return v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4;
  });
  return 0.2126 * lin[0] + 0.7152 * lin[1] + 0.0722 * lin[2];
}

function contrastRatio(a, b) {
  const l1 = relativeLuminance(a);
  const l2 = relativeLuminance(b);
  const [hi, lo] = l1 > l2 ? [l1, l2] : [l2, l1];
  return (hi + 0.05) / (lo + 0.05);
}

function quizThemeColors() {
  const textEl = document.querySelector('.question-text');
  let bgEl = document.querySelector('.quiz-dock') || document.getElementById('quiz');
  let bg = getComputedStyle(bgEl).backgroundColor;
  while (bgEl && (bg === 'rgba(0, 0, 0, 0)' || bg === 'transparent')) {
    bgEl = bgEl.parentElement;
    bg = bgEl ? getComputedStyle(bgEl).backgroundColor : 'rgb(255, 255, 255)';
  }
  return {
    text: getComputedStyle(textEl).color,
    bg,
    theme: document.documentElement.getAttribute('data-theme') || 'light',
    skin: document.documentElement.getAttribute('data-exam-skin'),
  };
}

async function openQuizThemed(page, { skin, viewport, theme, mode }) {
  await page.setViewportSize(viewport);
  await page.addInitScript(({ nextSkin, nextTheme }) => {
    try {
      localStorage.setItem('prawko_exam_skin', nextSkin);
      localStorage.setItem('prawko_theme', nextTheme);
    } catch {}
  }, { nextSkin: skin, nextTheme: theme });
  await page.route('**/local.json', (route) => route.fulfill({ status: 404, body: '' }));
  await page.goto('/');
  await page.waitForSelector('#home.active');
  await page.click('[data-navigate="categories"]');
  await page.waitForSelector('#categories.active');
  await page.click(`.mode-btn[data-mode="${mode}"]`);
  const category = mode === 'exam' ? 'PT' : 'B';
  await page.click(`.category-grid .category-card[data-category="${category}"]`);
  if (mode === 'exam') {
    await page.waitForSelector('.modal-overlay.active');
    await page.click('.btn-confirm-end');
  }
  await page.waitForSelector('#quiz.active');
  await page.waitForSelector('.question-text:not(:empty)');
  await expect.poll(() => page.locator('html').getAttribute('data-exam-skin')).toBe(skin);
  await expect.poll(() => page.locator('html').getAttribute('data-ui-orient')).toBe(
    viewport.width < viewport.height ? 'portrait' : 'landscape',
  );
  if (theme === 'dark') {
    await expect(page.locator('html')).toHaveAttribute('data-theme', 'dark');
  } else {
    await expect(page.locator('html')).not.toHaveAttribute('data-theme', 'dark');
  }
  await page.waitForFunction(() => !document.querySelector('.quiz-dock')?.classList.contains('is-fitting'));
}

test.describe('Quiz light/dark theme', () => {
  for (const view of quizThemeViews) {
    for (const theme of ['light', 'dark']) {
      for (const mode of ['learn', 'exam']) {
        test(`${mode} ${view.skin} ${view.orient} ${theme}: question stays readable`, async ({ page }) => {
          await openQuizThemed(page, { ...view, theme, mode });
          const colors = await page.evaluate(quizThemeColors);
          expect(colors.skin).toBe(view.skin);
          expect(contrastRatio(colors.text, colors.bg)).toBeGreaterThan(4.5);
          if (theme === 'dark') {
            expect(relativeLuminance(colors.bg)).toBeLessThan(0.35);
            expect(relativeLuminance(colors.text)).toBeGreaterThan(0.6);
          } else {
            expect(relativeLuminance(colors.bg)).toBeGreaterThan(0.7);
            expect(relativeLuminance(colors.text)).toBeLessThan(0.35);
          }
        });
      }
    }
  }
});

