const { test, expect } = require('@playwright/test');

test('landscape home scales the 1280 layout instead of wrapping', async ({ page }) => {
  await page.setViewportSize({ width: 640, height: 450 });
  await page.goto('/');
  await page.waitForSelector('#home.active');

  const designW = parseFloat(await page.evaluate(() =>
    getComputedStyle(document.documentElement).getPropertyValue('--ui-design-width')
  ));
  const scale = Number(await page.evaluate(() =>
    getComputedStyle(document.documentElement).getPropertyValue('--ui-scale')
  ));
  expect(designW).toBeCloseTo(1280, 0);
  expect(scale).toBeCloseTo(640 / 1280, 2);
});

test('short 1024 laptop window with browser chrome still scales', async ({ page }) => {
  await page.setViewportSize({ width: 1024, height: 580 });
  await page.goto('/');
  await page.waitForSelector('#home.active');

  const designW = parseFloat(await page.evaluate(() =>
    getComputedStyle(document.documentElement).getPropertyValue('--ui-design-width')
  ));
  const scale = Number(await page.evaluate(() =>
    getComputedStyle(document.documentElement).getPropertyValue('--ui-scale')
  ));
  expect(designW).toBeCloseTo(1280, 0);
  expect(scale).toBeCloseTo(1024 / 1280, 2);
});

test('home keeps scaling the 1280 layout on a small laptop before wrapping', async ({ page }) => {
  await page.setViewportSize({ width: 1024, height: 768 });
  await page.goto('/');
  await page.waitForSelector('#home.active');

  const designW = parseFloat(await page.evaluate(() =>
    getComputedStyle(document.documentElement).getPropertyValue('--ui-design-width')
  ));
  const scale = Number(await page.evaluate(() =>
    getComputedStyle(document.documentElement).getPropertyValue('--ui-scale')
  ));
  expect(designW).toBeCloseTo(1280, 0);
  expect(scale).toBeCloseTo(1024 / 1280, 2);
});

test('learn quiz scales fonts with the window, not only the film', async ({ page }) => {
  await page.setViewportSize({ width: 640, height: 900 });
  await page.goto('/');
  await page.click('[data-navigate="categories"]');
  await page.waitForSelector('#categories.active');
  await page.click('.mode-btn[data-mode="learn"]');
  await page.click('.category-card[data-category="B"]');
  await page.waitForSelector('#quiz.active');
  await page.waitForSelector('.question-text:not(:empty)');
  await page.waitForFunction(() => document.documentElement.getAttribute('data-ui-mode') === 'fit');

  const at640 = await page.evaluate(() => ({
    scale: Number(getComputedStyle(document.documentElement).getPropertyValue('--ui-scale')),
    designW: parseFloat(getComputedStyle(document.documentElement).getPropertyValue('--ui-design-width')),
    textH: document.querySelector('.question-text').getBoundingClientRect().height,
  }));
  expect(at640.designW).toBeCloseTo(1280, 0);
  expect(at640.scale).toBeCloseTo(640 / 1280, 2);

  await page.setViewportSize({ width: 1280, height: 900 });
  await page.waitForFunction(() => {
    const s = Number(getComputedStyle(document.documentElement).getPropertyValue('--ui-scale'));
    return Math.abs(s - 1) < 0.02;
  });
  const at1280 = await page.evaluate(() => ({
    scale: Number(getComputedStyle(document.documentElement).getPropertyValue('--ui-scale')),
    textH: document.querySelector('.question-text').getBoundingClientRect().height,
  }));
  expect(at1280.scale).toBeCloseTo(1, 2);
  expect(at1280.textH).toBeGreaterThan(at640.textH * 1.5);
});

test('learn prev/next stay inside the window', async ({ page }) => {
  await page.setViewportSize({ width: 640, height: 450 });
  await page.goto('/');
  await page.click('[data-navigate="categories"]');
  await page.waitForSelector('#categories.active');
  await page.click('.mode-btn[data-mode="learn"]');
  await page.click('.category-card[data-category="B"]');
  await page.waitForSelector('#quiz.active');

  const nav = page.locator('.learn-nav');
  const answers = page.locator('.answers');
  await expect(nav).toBeVisible();
  await expect(answers).toBeVisible();
  const navBox = await nav.boundingBox();
  const answersBox = await answers.boundingBox();
  expect(navBox).toBeTruthy();
  expect(answersBox).toBeTruthy();
  expect(navBox.y + navBox.height).toBeLessThanOrEqual(450 + 2);
  expect(navBox.y).toBeGreaterThanOrEqual(450 - 90);
  expect(answersBox.y + answersBox.height).toBeLessThanOrEqual(navBox.y + 2);
  expect(answersBox.y).toBeGreaterThan(140);
});

test('wrapping an ABC answer does not resize the learn media slot', async ({ page }) => {
  await page.setViewportSize({ width: 640, height: 900 });
  await page.goto('/');
  await page.click('[data-navigate="categories"]');
  await page.waitForSelector('#categories.active');
  await page.click('.mode-btn[data-mode="learn"]');
  await page.click('.category-card[data-category="B"]');
  await page.waitForSelector('#quiz.active');

  const setAbc = async (longC) => {
    await page.evaluate((longText) => {
      const el = document.querySelector('.answers');
      el.className = 'answers abc-answers';
      const lines = [
        'Patrzeć prosto w światła pojazdu nadjeżdżającego z przeciwka.',
        'Zmienić światła mijania na drogowe.',
        longText
          ? 'Patrzeć w prawo od źródła światła pojazdu nadjeżdżającego z przeciwka i wypatrywać tam ewentualnej przeszkody.'
          : 'Patrzeć w prawo.',
      ];
      el.innerHTML = lines.map((text, i) => (
        `<button type="button" class="answer-btn"><span class="answer-label">${'ABC'[i]}.</span> ${text}</button>`
      )).join('');
    }, longC);
  };

  await setAbc(false);
  const shortBox = await page.locator('.media-area').boundingBox();
  await setAbc(true);
  const longBox = await page.locator('.media-area').boundingBox();
  expect(shortBox).toBeTruthy();
  expect(longBox).toBeTruthy();
  expect(Math.abs(shortBox.height - longBox.height)).toBeLessThan(2);
  expect(Math.abs(shortBox.width - longBox.width)).toBeLessThan(2);
});

test('learn quiz answers and nav match the question card width', async ({ page }) => {
  await page.setViewportSize({ width: 640, height: 900 });
  await page.goto('/');
  await page.click('[data-navigate="categories"]');
  await page.waitForSelector('#categories.active');
  await page.click('.mode-btn[data-mode="learn"]');
  await page.click('.category-card[data-category="B"]');
  await page.waitForSelector('#quiz.active');

  const card = await page.locator('.question-card').boundingBox();
  const answers = await page.locator('.answers').boundingBox();
  const nav = await page.locator('.learn-nav').boundingBox();
  const back = await page.locator('.quiz-back').boundingBox();
  const pill = await page.locator('.quiz-mode-pill').boundingBox();
  expect(card).toBeTruthy();
  expect(answers).toBeTruthy();
  expect(nav).toBeTruthy();
  expect(back).toBeTruthy();
  expect(pill).toBeTruthy();
  expect(Math.abs(card.width - answers.width)).toBeLessThan(4);
  expect(Math.abs(card.x - answers.x)).toBeLessThan(4);
  expect(Math.abs(nav.width - answers.width)).toBeLessThan(4);
  expect(Math.abs(nav.x - answers.x)).toBeLessThan(4);
  expect(Math.abs(back.y - pill.y)).toBeLessThan(14);
  expect(back.x).toBeLessThan(pill.x);
});

test('exam chrome and answers share the question card column', async ({ page }) => {
  await page.setViewportSize({ width: 900, height: 900 });
  await page.goto('/');
  await page.click('[data-navigate="categories"]');
  await page.waitForSelector('#categories.active');
  await page.click('.mode-btn[data-mode="exam"]');
  await page.click('.category-grid .category-card[data-category="PT"]');
  await page.waitForSelector('.modal-overlay.active');
  await page.click('.btn-confirm-end');
  await page.waitForSelector('#quiz.active.exam-active');
  await page.waitForSelector('.question-text:not(:empty)');

  const media = await page.locator('.media-area').boundingBox();
  expect(media).toBeTruthy();
  expect(media.height).toBeGreaterThan(80);
  expect(media.width).toBeGreaterThan(80);

  const card = await page.locator('.question-card').boundingBox();
  const answers = await page.locator('.answers').boundingBox();
  const header = await page.locator('#quiz.exam-active .quiz-header').boundingBox();
  const counters = await page.locator('.exam-counters').boundingBox();
  const toolbar = await page.locator('.exam-toolbar').boundingBox();
  const nextBtn = await page.locator('.btn-exam-next.visible').boundingBox();
  const start = await page.locator('.exam-film-start').boundingBox();
  expect(card).toBeTruthy();
  expect(answers).toBeTruthy();
  expect(header).toBeTruthy();
  expect(counters).toBeTruthy();
  expect(toolbar).toBeTruthy();
  expect(nextBtn).toBeTruthy();
  expect(toolbar.y).toBeGreaterThan(counters.y + counters.height + 20);
  expect(nextBtn.y).toBeGreaterThan(toolbar.y + toolbar.height + 24);
  expect(nextBtn.y + nextBtn.height).toBeLessThan(card.y + card.height + 12);
  expect(Math.abs(card.width - answers.width)).toBeLessThan(4);
  expect(Math.abs(card.x - answers.x)).toBeLessThan(4);
  expect(Math.abs(header.x - card.x)).toBeLessThan(4);
  expect(Math.abs(header.width - card.width)).toBeLessThan(4);
  expect(Math.abs(counters.x - card.x)).toBeLessThan(4);
  expect(Math.abs(counters.width - card.width)).toBeLessThan(4);
  expect(Math.abs(toolbar.x - card.x)).toBeLessThan(4);
  expect(Math.abs(toolbar.width - card.width)).toBeLessThan(4);
  if (start) {
    expect(start.x).toBeGreaterThanOrEqual(toolbar.x - 2);
    expect(start.x + start.width).toBeLessThanOrEqual(toolbar.x + toolbar.width + 2);
  }

  const category = await page.locator('.exam-top-fields .exam-category-value').boundingBox();
  const remaining = await page.locator('.exam-top-fields .total-timer').boundingBox();
  expect(category).toBeTruthy();
  expect(remaining).toBeTruthy();
  expect(Math.abs(category.y - remaining.y)).toBeLessThan(4);
  expect(remaining.x).toBeGreaterThan(category.x);

  const endExam = await page.locator('.btn-end-exam').boundingBox();
  const qnumBox = await page.locator('.exam-qnum').boundingBox();
  expect(endExam).toBeTruthy();
  expect(qnumBox).toBeTruthy();
  expect(endExam.y + endExam.height).toBeLessThanOrEqual(counters.y + 2);
  expect(qnumBox.height).toBeLessThan(22);

  const yn = page.locator('.yn-answers .answer-btn').first();
  if (await yn.count()) {
    await yn.click();
    await expect(yn).toHaveClass(/selected/);
    await expect(yn).toHaveCSS('background-color', 'rgb(232, 74, 168)');
    const selected = await yn.evaluate((el) => {
      const s = getComputedStyle(el);
      return {
        height: el.getBoundingClientRect().height,
        shadow: s.boxShadow,
      };
    });
    const spread = selected.shadow.match(/0px 0px 0px ([0-9.]+)px/);
    expect(spread).toBeTruthy();
    expect(Math.abs(parseFloat(spread[1]) - selected.height * 2 / 3)).toBeLessThan(3);

    const ynMedia = await page.locator('.media-area').boundingBox();
    await page.evaluate(() => {
      const el = document.querySelector('.answers');
      el.className = 'answers abc-answers';
      el.innerHTML = ['A', 'B', 'C'].map((letter) => (
        `<button type="button" class="answer-btn"><span class="answer-label">${letter}</span><span class="answer-text">Opcja ${letter}</span></button>`
      )).join('');
    });
    const abcMedia = await page.locator('.media-area').boundingBox();
    expect(ynMedia).toBeTruthy();
    expect(abcMedia).toBeTruthy();
    expect(Math.abs(ynMedia.height - abcMedia.height)).toBeLessThan(4);
    expect(Math.abs(ynMedia.width - abcMedia.width)).toBeLessThan(4);
    expect(Math.abs(ynMedia.y - abcMedia.y)).toBeLessThan(4);
    expect(Math.abs(ynMedia.x - abcMedia.x)).toBeLessThan(4);
  }

  const fit = await page.locator('#quiz').evaluate((el) => {
    const text = el.querySelector('.question-text');
    const textBox = text.getBoundingClientRect();
    const quizBox = el.getBoundingClientRect();
    const card = el.querySelector('.question-card');
    return {
      scrolled: card.scrollHeight > card.clientHeight + 1,
      overflowY: getComputedStyle(card).overflowY,
      textVisible: textBox.height > 8 && textBox.bottom <= quizBox.bottom + 2,
    };
  });
  expect(fit.scrolled).toBe(false);
  expect(fit.overflowY).toBe('hidden');
  expect(fit.textVisible).toBe(true);
});

test('hidden update banner does not reserve chrome space', async ({ page }) => {
  await page.setViewportSize({ width: 640, height: 450 });
  await page.goto('/');
  await page.waitForSelector('#home.active');
  const chromeTop = parseFloat(await page.evaluate(() =>
    getComputedStyle(document.documentElement).getPropertyValue('--ui-chrome-top')
  ));
  const bannerVisible = await page.locator('#update-banner').isVisible();
  expect(bannerVisible).toBe(false);
  expect(chromeTop).toBeLessThan(2);
});

test('offline banner is reserved above the scaled canvas', async ({ page }) => {
  await page.setViewportSize({ width: 640, height: 450 });
  await page.goto('/');
  await page.waitForSelector('#home.active');
  await page.evaluate(() => {
    const banner = document.getElementById('offline-banner');
    if (banner) banner.hidden = false;
    window.dispatchEvent(new Event('resize'));
  });
  await page.waitForFunction(() =>
    parseFloat(getComputedStyle(document.documentElement).getPropertyValue('--ui-chrome-top')) > 8
  );
  const chromeTop = parseFloat(await page.evaluate(() =>
    getComputedStyle(document.documentElement).getPropertyValue('--ui-chrome-top')
  ));
  const frameTop = await page.locator('.ui-frame').evaluate((el) => el.getBoundingClientRect().top);
  expect(chromeTop).toBeGreaterThan(8);
  expect(frameTop).toBeGreaterThanOrEqual(chromeTop - 1);
});

test('narrow portrait home wraps feature cards at full width', async ({ page }) => {
  await page.setViewportSize({ width: 420, height: 800 });
  await page.goto('/');
  await page.waitForSelector('#home.active');

  const scale = Number(await page.evaluate(() =>
    getComputedStyle(document.documentElement).getPropertyValue('--ui-scale')
  ));
  expect(scale).toBeCloseTo(1, 2);

  const stage = await page.locator('.ui-stage').evaluate((el) => ({
    width: el.getBoundingClientRect().width,
    columns: getComputedStyle(el.querySelector('.features')).gridTemplateColumns.split(' ').length,
  }));
  expect(stage.width).toBeGreaterThan(380);
  expect(stage.width).toBeLessThanOrEqual(420 + 2);
  expect(stage.columns).toBe(1);
});
