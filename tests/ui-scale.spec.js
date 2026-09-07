const { test, expect } = require('@playwright/test');
const { cycleSkin, waitForExamMediaAlign } = require('./helpers');

test('landscape home scales the 1280 layout instead of wrapping', async ({ page }) => {
  await page.setViewportSize({ width: 640, height: 450 });
  await page.goto('/');
  await page.waitForSelector('#home.active');

  const metrics = await page.evaluate(() => {
    const root = document.documentElement;
    const home = document.getElementById('home').getBoundingClientRect();
    const hero = document.querySelector('#home .hero').getBoundingClientRect();
    return {
      designW: parseFloat(getComputedStyle(root).getPropertyValue('--ui-design-width')),
      scale: Number(getComputedStyle(root).getPropertyValue('--ui-scale')),
      orient: root.getAttribute('data-ui-orient'),
      mode: root.getAttribute('data-ui-mode'),
      homeBottom: home.bottom,
      heroWidth: hero.width,
    };
  });
  expect(metrics.designW).toBeCloseTo(1280, 0);
  expect(metrics.orient).toBe('landscape');
  expect(metrics.mode).toBe('fit');
  expect(metrics.scale).toBeGreaterThan(0.05);
  expect(metrics.scale).toBeLessThanOrEqual(640 / 1280 + 0.02);
  expect(metrics.heroWidth).toBeGreaterThan(640 - 4);
  expect(metrics.homeBottom).toBeLessThanOrEqual(450 + 2);
});

test('short 1024 laptop window with browser chrome still scales', async ({ page }) => {
  await page.setViewportSize({ width: 1024, height: 580 });
  await page.goto('/');
  await page.waitForSelector('#home.active');

  const metrics = await page.evaluate(() => {
    const root = document.documentElement;
    const home = document.getElementById('home').getBoundingClientRect();
    const hero = document.querySelector('#home .hero').getBoundingClientRect();
    return {
      designW: parseFloat(getComputedStyle(root).getPropertyValue('--ui-design-width')),
      scale: Number(getComputedStyle(root).getPropertyValue('--ui-scale')),
      orient: root.getAttribute('data-ui-orient'),
      homeBottom: home.bottom,
      heroWidth: hero.width,
    };
  });
  expect(metrics.designW).toBeCloseTo(1280, 0);
  expect(metrics.orient).toBe('landscape');
  expect(metrics.scale).toBeGreaterThan(0.05);
  expect(metrics.scale).toBeLessThanOrEqual(1024 / 1280 + 0.02);
  expect(metrics.heroWidth).toBeGreaterThan(1024 - 4);
  expect(metrics.homeBottom).toBeLessThanOrEqual(580 + 2);
});

test('home keeps scaling the 1280 layout on a small laptop before wrapping', async ({ page }) => {
  await page.setViewportSize({ width: 1024, height: 768 });
  await page.goto('/');
  await page.waitForSelector('#home.active');

  const metrics = await page.evaluate(() => {
    const root = document.documentElement;
    const hero = document.querySelector('#home .hero').getBoundingClientRect();
    return {
      designW: parseFloat(getComputedStyle(root).getPropertyValue('--ui-design-width')),
      scale: Number(getComputedStyle(root).getPropertyValue('--ui-scale')),
      orient: root.getAttribute('data-ui-orient'),
      heroWidth: hero.width,
    };
  });
  expect(metrics.designW).toBeCloseTo(1280, 0);
  expect(metrics.orient).toBe('landscape');
  expect(metrics.scale).toBeGreaterThan(0.05);
  expect(metrics.scale).toBeLessThanOrEqual(1024 / 1280 + 0.02);
  expect(metrics.heroWidth).toBeGreaterThan(1024 - 4);
});

test('learn quiz scales fonts with the window, not only the film', async ({ page }) => {
  await page.setViewportSize({ width: 640, height: 450 });
  await page.goto('/');
  await page.click('[data-navigate="categories"]');
  await page.waitForSelector('#categories.active');
  await page.click('.mode-btn[data-mode="learn"]');
  await page.click('.category-card[data-category="B"]');
  await page.waitForSelector('#quiz.active');
  await page.waitForSelector('.question-text:not(:empty)');
  await page.waitForFunction(() => document.documentElement.getAttribute('data-ui-mode') === 'fit');

  const atSmall = await page.evaluate(() => ({
    scale: Number(getComputedStyle(document.documentElement).getPropertyValue('--ui-scale')),
    designW: parseFloat(getComputedStyle(document.documentElement).getPropertyValue('--ui-design-width')),
    orient: document.documentElement.getAttribute('data-ui-orient'),
    textH: document.querySelector('.question-text').getBoundingClientRect().height,
  }));
  expect(atSmall.orient).toBe('landscape');
  expect(atSmall.designW).toBeCloseTo(1280, 0);
  expect(atSmall.scale).toBeCloseTo(Math.min(640 / 1280, 450 / 800), 2);

  await page.setViewportSize({ width: 1280, height: 800 });
  await page.waitForFunction(() => {
    const s = Number(getComputedStyle(document.documentElement).getPropertyValue('--ui-scale'));
    return Math.abs(s - 1) < 0.02;
  });
  const atFull = await page.evaluate(() => ({
    scale: Number(getComputedStyle(document.documentElement).getPropertyValue('--ui-scale')),
    textH: document.querySelector('.question-text').getBoundingClientRect().height,
  }));
  expect(atFull.scale).toBeCloseTo(1, 2);
  expect(atFull.textH).toBeGreaterThan(atSmall.textH * 1.5);
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
  expect(answersBox.y + answersBox.height).toBeLessThanOrEqual(450 + 2);
  expect(answersBox.y).toBeGreaterThan(40);
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

test('learn quiz answers sit under the film; nav sits in the side column', async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 800 });
  await page.goto('/');
  await page.click('[data-navigate="categories"]');
  await page.waitForSelector('#categories.active');
  await page.click('.mode-btn[data-mode="learn"]');
  await page.click('.category-card[data-category="B"]');
  await page.waitForSelector('#quiz.active');
  await waitForExamMediaAlign(page);

  const media = await page.locator('.media-area').boundingBox();
  const answers = await page.locator('.answers').boundingBox();
  const nav = await page.locator('.learn-nav').boundingBox();
  const back = await page.locator('.quiz-back').boundingBox();
  expect(media).toBeTruthy();
  expect(answers).toBeTruthy();
  expect(nav).toBeTruthy();
  expect(back).toBeTruthy();
  expect(Math.abs(media.x - answers.x)).toBeLessThan(24);
  expect(answers.y).toBeGreaterThan(media.y + media.height - 8);
  expect(nav.x).toBeGreaterThan(media.x + media.width - 8);
  expect(back.x).toBeGreaterThan(media.x + media.width - 8);
  await expect(page.locator('.quiz-mode-pill')).toBeHidden();
});

test('exam chrome puts the film, keys, and side counters in the WORD grid', async ({ page }) => {
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
  await waitForExamMediaAlign(page);

  const media = await page.locator('.media-area').boundingBox();
  expect(media).toBeTruthy();
  expect(media.height).toBeGreaterThan(80);
  expect(media.width).toBeGreaterThan(80);

  const answers = await page.locator('.answers').boundingBox();
  const fields = await page.locator('.exam-top-fields').boundingBox();
  const counters = await page.locator('.exam-counters').boundingBox();
  const toolbar = await page.locator('.exam-toolbar').boundingBox();
  const nextBtn = await page.locator('.btn-exam-next.visible').boundingBox();
  expect(answers).toBeTruthy();
  expect(fields).toBeTruthy();
  expect(counters).toBeTruthy();
  expect(toolbar).toBeTruthy();
  expect(nextBtn).toBeTruthy();
  expect(fields.y + fields.height).toBeLessThanOrEqual(media.y + 8);
  expect(Math.abs(fields.x - media.x)).toBeLessThan(24);
  expect(answers.y).toBeGreaterThan(media.y + media.height - 8);
  expect(counters.x).toBeGreaterThan(media.x + media.width - 8);
  expect(toolbar.x).toBeGreaterThan(media.x + media.width - 8);
  expect(nextBtn.x).toBeGreaterThan(media.x + media.width - 8);
  expect(toolbar.y).toBeGreaterThan(counters.y + counters.height - 4);

  const category = await page.locator('.exam-top-fields .exam-category-value').boundingBox();
  const remaining = await page.locator('.exam-top-fields .total-timer').boundingBox();
  expect(category).toBeTruthy();
  expect(remaining).toBeTruthy();
  expect(Math.abs(category.y - remaining.y)).toBeLessThan(8);
  expect(remaining.x).toBeGreaterThan(category.x);

  const endExam = await page.locator('.btn-end-exam').boundingBox();
  const pointsBox = await page.locator('.exam-points-value').boundingBox();
  expect(endExam).toBeTruthy();
  expect(pointsBox).toBeTruthy();
  expect(endExam.x).toBeGreaterThan(media.x + media.width - 8);
  expect(pointsBox.height).toBeLessThan(48);

  const yn = page.locator('.yn-answers .answer-btn').first();
  if (await yn.count()) {
    await yn.click();
    await expect(yn).toHaveClass(/selected/);
    await expect(yn).toHaveCSS('background-color', 'rgb(232, 74, 168)');
    const selected = await yn.evaluate((el) => {
      const s = getComputedStyle(el);
      const ynH = parseFloat(s.getPropertyValue('--yn-h')) || el.getBoundingClientRect().height;
      return {
        height: el.getBoundingClientRect().height,
        ynH,
        shadow: s.boxShadow,
      };
    });
    const spread = selected.shadow.match(/0px 0px 0px ([0-9.]+)px/);
    expect(spread).toBeTruthy();
    expect(Math.abs(parseFloat(spread[1]) - selected.ynH * 2 / 3)).toBeLessThan(3);

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
      textVisible: textBox.height > 8 && textBox.bottom <= quizBox.bottom + 2,
    };
  });
  expect(fit.scrolled).toBe(false);
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

  const metrics = await page.evaluate(() => {
    const root = document.documentElement;
    const home = document.getElementById('home').getBoundingClientRect();
    const stage = document.querySelector('.ui-stage');
    return {
      scale: Number(getComputedStyle(root).getPropertyValue('--ui-scale')),
      designW: parseFloat(getComputedStyle(root).getPropertyValue('--ui-design-width')),
      orient: root.getAttribute('data-ui-orient'),
      stageWidth: stage.getBoundingClientRect().width,
      columns: getComputedStyle(stage.querySelector('.features')).gridTemplateColumns.split(' ').length,
      homeBottom: home.bottom,
    };
  });
  expect(metrics.orient).toBe('portrait');
  expect(metrics.designW).toBeCloseTo(720, 0);
  expect(metrics.scale).toBeGreaterThan(0.05);
  expect(metrics.scale).toBeLessThanOrEqual(420 / 720 + 0.02);
  expect(metrics.stageWidth).toBeLessThanOrEqual(420 + 2);
  expect(metrics.columns).toBe(1);
  expect(metrics.homeBottom).toBeLessThanOrEqual(800 + 4);
});

test('quiz layout uses aspect ratio, not pixel width', async ({ page }) => {
  await page.setViewportSize({ width: 400, height: 300 });
  await page.goto('/');
  await page.waitForSelector('#home.active');
  await expect.poll(() => page.evaluate(() => document.documentElement.getAttribute('data-ui-orient'))).toBe('landscape');

  await page.setViewportSize({ width: 400, height: 500 });
  await expect.poll(() => page.evaluate(() => document.documentElement.getAttribute('data-ui-orient'))).toBe('portrait');
});

test('short landscape learn quiz keeps the question text visible', async ({ page }) => {
  await page.setViewportSize({ width: 1100, height: 520 });
  await page.goto('/');
  await page.click('[data-navigate="categories"]');
  await page.waitForSelector('#categories.active');
  await page.click('.mode-btn[data-mode="learn"]');
  await page.click('.category-card[data-category="B"]');
  await page.waitForSelector('#quiz.active');
  await page.waitForSelector('.question-text:not(:empty)');

  const fit = await page.evaluate(() => {
    const root = document.documentElement;
    const text = document.querySelector('.question-text').getBoundingClientRect();
    const media = document.querySelector('.media-area').getBoundingClientRect();
    const answers = document.querySelector('.answers').getBoundingClientRect();
    return {
      orient: root.getAttribute('data-ui-orient'),
      scale: Number(getComputedStyle(root).getPropertyValue('--ui-scale')),
      textTop: text.top,
      textBottom: text.bottom,
      textHeight: text.height,
      mediaBottom: media.bottom,
      answersBottom: answers.bottom,
    };
  });
  expect(fit.orient).toBe('landscape');
  expect(fit.scale).toBeLessThan(1);
  expect(fit.textHeight).toBeGreaterThan(8);
  expect(fit.textTop).toBeGreaterThanOrEqual(fit.mediaBottom - 2);
  expect(fit.textBottom).toBeLessThanOrEqual(fit.answersBottom + 2);
  expect(fit.answersBottom).toBeLessThanOrEqual(520 + 8);
});

test('home hero is visible and the language bar scales with the station', async ({ page }) => {
  await page.setViewportSize({ width: 1100, height: 520 });
  await page.goto('/');
  await page.waitForSelector('#home.active');
  await page.waitForFunction(() => document.documentElement.getAttribute('data-ui-station') === 'page');

  const metrics = await page.evaluate(() => {
    const root = document.documentElement;
    const hero = document.querySelector('#home .hero-title').getBoundingClientRect();
    const heroBar = document.querySelector('#home .hero').getBoundingClientRect();
    const start = document.querySelector('#home [data-navigate="categories"]').getBoundingClientRect();
    const bar = document.querySelector('.top-controls').getBoundingClientRect();
    const home = document.getElementById('home').getBoundingClientRect();
    const slot = document.querySelector('.ui-slot').getBoundingClientRect();
    return {
      station: root.getAttribute('data-ui-station'),
      scale: Number(getComputedStyle(root).getPropertyValue('--ui-scale')),
      designW: parseFloat(getComputedStyle(root).getPropertyValue('--ui-design-width')),
      designH: parseFloat(getComputedStyle(root).getPropertyValue('--ui-design-height')),
      heroHeight: hero.height,
      heroTop: hero.top,
      heroWidth: heroBar.width,
      startVisible: start.height > 8 && start.bottom <= 520 + 2,
      barHeight: bar.height,
      barTop: bar.top,
      homeTop: home.top,
      homeBottom: home.bottom,
      slotTop: slot.top,
      slotWidth: slot.width,
    };
  });
  expect(metrics.station).toBe('page');
  expect(metrics.designW).toBeCloseTo(1280, 0);
  expect(metrics.scale).toBeGreaterThan(0.05);
  expect(metrics.scale).toBeLessThan(1);
  expect(metrics.designH).toBeGreaterThan(200);
  expect(metrics.designH).toBeLessThan(2500);
  expect(metrics.heroHeight).toBeGreaterThan(12);
  expect(metrics.heroTop).toBeGreaterThanOrEqual(-1);
  expect(metrics.homeTop).toBeLessThan(16);
  expect(metrics.slotTop).toBeLessThan(2);
  expect(metrics.barTop).toBeLessThan(16);
  expect(metrics.startVisible).toBe(true);
  expect(metrics.barHeight).toBeGreaterThan(8);
  expect(metrics.barHeight).toBeLessThan(64);
  expect(metrics.barTop).toBeGreaterThanOrEqual(0);
  expect(metrics.homeBottom).toBeLessThanOrEqual(520 + 2);
  expect(metrics.heroWidth).toBeGreaterThan(1100 - 4);
  expect(metrics.slotWidth).toBeLessThan(1100 - 8);
});

test('wide home hero spans the full window width', async ({ page }) => {
  await page.setViewportSize({ width: 1600, height: 900 });
  await page.goto('/');
  await page.waitForSelector('#home.active');

  const metrics = await page.evaluate(() => {
    const hero = document.querySelector('#home .hero').getBoundingClientRect();
    const slot = document.querySelector('.ui-slot').getBoundingClientRect();
    const bar = document.querySelector('.top-controls').getBoundingClientRect();
    const root = document.documentElement;
    return {
      heroWidth: hero.width,
      heroLeft: hero.left,
      heroHeight: hero.height,
      slotWidth: slot.width,
      barRight: bar.right,
      designW: parseFloat(getComputedStyle(root).getPropertyValue('--ui-design-width')),
      scale: Number(getComputedStyle(root).getPropertyValue('--ui-scale')),
    };
  });
  expect(metrics.designW).toBeCloseTo(1280, 0);
  expect(metrics.heroLeft).toBeLessThan(4);
  expect(metrics.heroWidth).toBeGreaterThan(1600 - 4);
  expect(metrics.slotWidth).toBeLessThan(1600 - 8);
  expect(metrics.heroHeight).toBeGreaterThan(40);
  expect(metrics.barRight).toBeGreaterThan(1600 - 24);
  expect(metrics.barRight).toBeLessThanOrEqual(1600 + 2);
  expect(metrics.scale).toBeGreaterThan(0.05);
  expect(metrics.scale).toBeLessThanOrEqual(1);
});

test('station-skin learn quiz keeps question text below the media on a short window', async ({ page }) => {
  await page.setViewportSize({ width: 1100, height: 520 });
  await page.goto('/');
  await page.click('.skin-btn');
  await page.waitForFunction(() => document.documentElement.getAttribute('data-exam-skin') === 'station');
  await page.click('[data-navigate="categories"]');
  await page.waitForSelector('#categories.active');
  await page.click('.mode-btn[data-mode="learn"]');
  await page.click('.category-card[data-category="B"]');
  await page.waitForSelector('#quiz.active');
  await page.waitForSelector('.question-text:not(:empty)');

  const fit = await page.evaluate(() => {
    const text = document.querySelector('.question-text').getBoundingClientRect();
    const media = document.querySelector('.media-area').getBoundingClientRect();
    const answers = document.querySelector('.answers').getBoundingClientRect();
    return {
      skin: document.documentElement.getAttribute('data-exam-skin'),
      scale: Number(getComputedStyle(document.documentElement).getPropertyValue('--ui-scale')),
      textHeight: text.height,
      textTop: text.top,
      mediaBottom: media.bottom,
      answersBottom: answers.bottom,
    };
  });
  expect(fit.skin).toBe('station');
  expect(fit.scale).toBeLessThan(1);
  expect(fit.textHeight).toBeGreaterThan(8);
  expect(fit.textTop).toBeGreaterThanOrEqual(fit.mediaBottom - 2);
  expect(fit.answersBottom).toBeLessThanOrEqual(520 + 8);
});

test('TAK/NIE centers sit on the media 1/3 and 2/3 marks in both skins', async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 800 });
  await page.goto('/');
  await page.waitForSelector('#home.active');
  if ((await page.locator('html').getAttribute('data-exam-skin')) !== 'panel') {
    await page.click('.skin-btn');
  }
  await page.click('[data-navigate="categories"]');
  await page.waitForSelector('#categories.active');
  await page.click('.mode-btn[data-mode="exam"]');
  await page.click('.category-grid .category-card[data-category="B"]');
  await page.waitForSelector('.modal-overlay.active');
  await page.click('.btn-confirm-end');
  await page.waitForSelector('#quiz.active.exam-active');
  await page.waitForSelector('.yn-answers .answer-btn');
  await waitForExamMediaAlign(page);

  async function measureYn() {
    return page.evaluate(() => {
      const media = document.querySelector('.media-area').getBoundingClientRect();
      const btns = [...document.querySelectorAll('.yn-answers .answer-btn')].map((el) => el.getBoundingClientRect());
      const q = document.querySelector('.question-text');
      const qBox = q.getBoundingClientRect();
      const qcs = getComputedStyle(q);
      const timer = document.querySelector('.timer-display-total').getBoundingClientRect();
      return {
        skin: document.documentElement.getAttribute('data-exam-skin'),
        mediaLeft: media.left,
        mediaWidth: media.width,
        mediaRight: media.right,
        timerRight: timer.right,
        takCenter: btns[0].left + btns[0].width / 2,
        nieCenter: btns[1].left + btns[1].width / 2,
        qFamily: qcs.fontFamily,
        qSize: parseFloat(qcs.fontSize),
        qWidth: qBox.width,
      };
    });
  }

  const panel = await measureYn();
  expect(panel.skin).toBe('panel');
  expect(Math.abs(panel.takCenter - (panel.mediaLeft + panel.mediaWidth / 3))).toBeLessThan(8);
  expect(Math.abs(panel.nieCenter - (panel.mediaLeft + (2 * panel.mediaWidth) / 3))).toBeLessThan(8);
  expect(panel.qFamily.toLowerCase()).toMatch(/arial/);
  expect(panel.qSize).toBeGreaterThanOrEqual(24);
  expect(Math.abs(panel.timerRight - panel.mediaRight)).toBeLessThan(8);
  expect(panel.qWidth).toBeGreaterThan(panel.mediaWidth - 8);

  await cycleSkin(page);
  await page.waitForFunction(() => document.documentElement.getAttribute('data-exam-skin') === 'station');
  await page.evaluate(() => window.dispatchEvent(new Event('resize')));
  await waitForExamMediaAlign(page);
  await page.waitForTimeout(150);
  const station = await measureYn();
  expect(station.skin).toBe('station');
  expect(Math.abs(station.takCenter - (station.mediaLeft + station.mediaWidth / 3))).toBeLessThan(16);
  expect(Math.abs(station.nieCenter - (station.mediaLeft + (2 * station.mediaWidth) / 3))).toBeLessThan(16);
  expect(station.qWidth).toBeGreaterThan(station.mediaWidth - 8);
});

test('Panel learn filters match header labels and open above the film', async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 800 });
  await page.goto('/');
  await page.waitForSelector('#home.active');
  if ((await page.locator('html').getAttribute('data-exam-skin')) !== 'panel') {
    await page.click('.skin-btn');
  }
  await page.click('[data-navigate="categories"]');
  await page.waitForSelector('#categories.active');
  await page.click('.mode-btn[data-mode="learn"]');
  await page.click('.category-card[data-category="B"]');
  await page.waitForSelector('#quiz.active');
  await page.waitForSelector('.question-text:not(:empty)');
  await page.click('.learn-filter-select .learn-queue-select');
  await expect(page.locator('.learn-filter-select .learn-queue-menu')).toBeVisible();

  const overlay = await page.evaluate(() => {
    const menu = document.querySelector('.learn-filter-select .learn-queue-menu');
    const media = document.querySelector('.media-area');
    const label = document.querySelector('.learn-top-fields .word-meta-label');
    const filterBtn = document.querySelector('.learn-filter-select .learn-queue-select');
    const q = document.querySelector('.question-text').getBoundingClientRect();
    const mediaBox = media.getBoundingClientRect();
    const menuBox = menu.getBoundingClientRect();
    const hit = document.elementFromPoint(
      menuBox.left + Math.min(20, menuBox.width / 2),
      menuBox.top + 10
    );
    const summary = document.querySelector('.learn-stats-summary').getBoundingClientRect();
    return {
      qWidth: q.width,
      mediaWidth: mediaBox.width,
      mediaRight: mediaBox.right,
      summaryRight: summary.right,
      menuTop: menuBox.top,
      mediaTop: mediaBox.top,
      hitInMenu: Boolean(hit?.closest('.learn-queue-menu')),
      labelSize: parseFloat(getComputedStyle(label).fontSize),
      filterSize: parseFloat(getComputedStyle(filterBtn).fontSize),
      filterPadRight: parseFloat(getComputedStyle(filterBtn).paddingRight) || 0,
      filterBorder: parseFloat(getComputedStyle(filterBtn).borderTopWidth) || 0,
      filterCaret: getComputedStyle(filterBtn, '::after').content,
    };
  });
  expect(overlay.qWidth).toBeGreaterThan(overlay.mediaWidth + 24);
  expect(overlay.hitInMenu).toBe(true);
  expect(overlay.menuTop).toBeLessThan(overlay.mediaTop + 8);
  expect(Math.abs(overlay.labelSize - overlay.filterSize)).toBeLessThan(0.6);
  expect(Math.abs(overlay.summaryRight - overlay.mediaRight)).toBeLessThan(2);
  expect(overlay.filterPadRight).toBeGreaterThan(8);
  expect(overlay.filterBorder).toBeGreaterThan(0);
  expect(overlay.filterCaret).toMatch(/▾/);
});

test('landscape Station learn filters look like dropdowns', async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 800 });
  await page.goto('/');
  await page.waitForSelector('#home.active');
  if ((await page.locator('html').getAttribute('data-exam-skin')) !== 'station') {
    await cycleSkin(page);
    await page.waitForFunction(() => document.documentElement.getAttribute('data-exam-skin') === 'station');
  }
  await page.click('[data-navigate="categories"]');
  await page.waitForSelector('#categories.active');
  await page.click('.mode-btn[data-mode="learn"]');
  await page.click('.category-card[data-category="B"]');
  await page.waitForSelector('#quiz.active.learn-active');
  await page.waitForSelector('.question-text:not(:empty)');
  await expect.poll(() => page.evaluate(() => document.documentElement.getAttribute('data-ui-orient'))).toBe('landscape');

  const filter = await page.evaluate(() => {
    const el = document.querySelector('.learn-filter-select .learn-queue-select');
    const cs = el ? getComputedStyle(el) : null;
    return {
      padRight: cs ? parseFloat(cs.paddingRight) || 0 : 0,
      border: cs ? parseFloat(cs.borderTopWidth) || 0 : 0,
      caret: el ? getComputedStyle(el, '::after').content : '',
    };
  });
  expect(filter.padRight).toBeGreaterThan(8);
  expect(filter.border).toBeGreaterThan(0);
  expect(filter.caret).toMatch(/▾/);
});

test('portrait Station learn media is 16:9 without extra letterbox; Panel question matches landscape proportion', async ({ page }) => {
  await page.setViewportSize({ width: 420, height: 900 });
  await page.goto('/');
  await page.waitForSelector('#home.active');
  if ((await page.locator('html').getAttribute('data-exam-skin')) !== 'station') {
    await page.click('.skin-btn');
    await page.waitForFunction(() => document.documentElement.getAttribute('data-exam-skin') === 'station');
  }
  await page.click('[data-navigate="categories"]');
  await page.waitForSelector('#categories.active');
  await page.click('.mode-btn[data-mode="learn"]');
  await page.click('.category-grid .category-card[data-category="B"]');
  await page.waitForSelector('#quiz.active.learn-active');
  await page.waitForSelector('.question-text:not(:empty)');
  await expect.poll(() => page.evaluate(() => document.documentElement.getAttribute('data-ui-orient'))).toBe('portrait');
  await expect.poll(() => page.evaluate(() => document.querySelector('.media-area')?.getBoundingClientRect().height || 0)).toBeGreaterThan(80);

  const station = await page.evaluate(() => {
    const media = document.querySelector('.media-area').getBoundingClientRect();
    const video = document.querySelector('.media-area video, .media-area img');
    const film = video?.getBoundingClientRect();
    return {
      orient: document.documentElement.getAttribute('data-ui-orient'),
      mediaW: media.width,
      mediaH: media.height,
      filmH: film?.height ?? 0,
    };
  });
  expect(station.orient).toBe('portrait');
  expect(station.mediaW).toBeGreaterThan(80);
  expect(Math.abs(station.mediaH / station.mediaW - 9 / 16)).toBeLessThan(0.04);
  if (station.filmH > 8) {
    expect(Math.abs(station.mediaH - station.filmH)).toBeLessThan(8);
  }

  await page.goto('/');
  await page.waitForSelector('#home.active');
  if ((await page.locator('html').getAttribute('data-exam-skin')) !== 'panel') {
    await cycleSkin(page);
    await page.waitForFunction(() => document.documentElement.getAttribute('data-exam-skin') === 'panel');
  }
  await page.click('[data-navigate="categories"]');
  await page.waitForSelector('#categories.active');
  await page.click('.mode-btn[data-mode="learn"]');
  await page.click('.category-grid .category-card[data-category="B"]');
  await page.waitForSelector('#quiz.active.learn-active');
  await page.waitForSelector('.question-text:not(:empty)');
  await expect.poll(() => page.evaluate(() => document.querySelector('.media-area')?.getBoundingClientRect().height || 0)).toBeGreaterThan(80);
  const panelPortrait = await page.evaluate(() => {
    const media = document.querySelector('.media-area').getBoundingClientRect();
    const film = document.querySelector('.media-area video, .media-area img')?.getBoundingClientRect();
    const q = getComputedStyle(document.querySelector('.question-text'));
    const btn = document.querySelector('.learn-nav .btn-next, .yn-answers .answer-btn');
    const btnFs = btn ? parseFloat(getComputedStyle(btn).fontSize) : 20;
    return {
      qSize: parseFloat(q.fontSize),
      btnSize: btnFs,
      orient: document.documentElement.getAttribute('data-ui-orient'),
      mediaW: media.width,
      mediaH: media.height,
      filmH: film?.height ?? 0,
      mediaTop: media.top,
      navTop: document.querySelector('.learn-nav')?.getBoundingClientRect().top ?? 0,
    };
  });
  expect(panelPortrait.orient).toBe('portrait');
  expect(panelPortrait.mediaW).toBeGreaterThan(80);
  expect(panelPortrait.mediaH).toBeGreaterThan(80);
  expect(Math.abs(panelPortrait.mediaH / panelPortrait.mediaW - 9 / 16)).toBeLessThan(0.04);
  expect(panelPortrait.mediaTop).toBeLessThan(panelPortrait.navTop);
  expect(panelPortrait.qSize / panelPortrait.btnSize).toBeGreaterThan(1.15);
  expect(panelPortrait.qSize).toBeGreaterThanOrEqual(24);
});

test('portrait Panel learn wraps header labels and matches back to next height', async ({ page }) => {
  await page.setViewportSize({ width: 420, height: 900 });
  await page.goto('/');
  await page.waitForSelector('#home.active');
  if ((await page.locator('html').getAttribute('data-exam-skin')) !== 'panel') {
    await cycleSkin(page);
    await page.waitForFunction(() => document.documentElement.getAttribute('data-exam-skin') === 'panel');
  }
  await page.click('[data-navigate="categories"]');
  await page.waitForSelector('#categories.active');
  await page.click('.mode-btn[data-mode="learn"]');
  await page.click('.category-grid .category-card[data-category="B"]');
  await page.waitForSelector('#quiz.active.learn-active');
  await page.waitForSelector('.question-text:not(:empty)');
  await expect.poll(() => page.evaluate(() => document.documentElement.getAttribute('data-ui-orient'))).toBe('portrait');

  const metrics = await page.evaluate(() => {
    const back = document.querySelector('.quiz-back.visible')?.getBoundingClientRect();
    const next = document.querySelector('.learn-nav .btn-next')?.getBoundingClientRect();
    const qnum = document.querySelector('.learn-qnum')?.getBoundingClientRect();
    const cat = document.querySelector('.learn-category-value')?.getBoundingClientRect();
    const qLabel = document.querySelector('.learn-top-fields .word-meta-item:first-child .word-meta-label');
    const cLabel = document.querySelector('.learn-top-fields .word-meta-item:nth-child(2) .word-meta-label');
    const media = document.querySelector('.media-area')?.getBoundingClientRect();
    const qCs = qLabel ? getComputedStyle(qLabel) : null;
    return {
      backH: back?.height ?? 0,
      nextH: next?.height ?? 0,
      qnumH: qnum?.height ?? 0,
      catH: cat?.height ?? 0,
      qLabelH: qLabel?.getBoundingClientRect().height ?? 0,
      cLabelH: cLabel?.getBoundingClientRect().height ?? 0,
      flexDir: qCs?.flexDirection ?? null,
      qLines: qLabel?.children.length ?? 0,
      headBottom: document.querySelector('.learn-top')?.getBoundingClientRect().bottom ?? 0,
      mediaTop: media?.top ?? 0,
    };
  });
  expect(metrics.flexDir).toBe('column');
  expect(metrics.qLines).toBe(2);
  expect(metrics.nextH).toBeGreaterThan(30);
  expect(metrics.backH).toBeGreaterThan(20);
  expect(metrics.backH).toBeLessThan(metrics.nextH - 4);
  expect(Math.abs(metrics.qnumH - metrics.qLabelH)).toBeLessThan(3);
  expect(Math.abs(metrics.catH - metrics.cLabelH)).toBeLessThan(3);
  expect(metrics.headBottom).toBeLessThanOrEqual(metrics.mediaTop + 2);
});

test('portrait Panel keeps ABC and YN in a fixed dock; filters look like dropdowns', async ({ page }) => {
  await page.setViewportSize({ width: 420, height: 900 });
  await page.goto('/');
  await page.waitForSelector('#home.active');
  if ((await page.locator('html').getAttribute('data-exam-skin')) !== 'panel') {
    await cycleSkin(page);
    await page.waitForFunction(() => document.documentElement.getAttribute('data-exam-skin') === 'panel');
  }

  const jumpTo = async (n) => {
    const input = page.locator('.learn-qnum-input');
    await input.click();
    await input.fill(String(n));
    await input.press('Enter');
    await page.waitForFunction((pos) => {
      const el = document.querySelector('.learn-qnum-input');
      return el && el.value === String(pos);
    }, n);
  };

  const measureAnswers = () => page.evaluate(() => {
    const answers = document.querySelector('.answers');
    const dock = document.querySelector('.quiz-dock');
    const q = document.querySelector('.question-text');
    const rows = [...(answers?.querySelectorAll('.answer-btn') || [])].map((el) => el.getBoundingClientRect());
    const a = answers?.getBoundingClientRect();
    const d = dock?.getBoundingClientRect();
    const filter = document.querySelector('.learn-filter-select .learn-queue-select');
    const filterCs = filter ? getComputedStyle(filter) : null;
    return {
      kind: answers?.className || '',
      answersTop: a?.top ?? 0,
      answersH: a?.height ?? 0,
      dockH: d?.height ?? 0,
      qH: q?.getBoundingClientRect().height ?? 0,
      rowH: rows.map((r) => r.height),
      filterPadRight: filterCs ? parseFloat(filterCs.paddingRight) || 0 : 0,
      filterBorder: filterCs ? parseFloat(filterCs.borderTopWidth) || 0 : 0,
      filterMinH: filterCs ? parseFloat(filterCs.minHeight) || 0 : 0,
      filterCaret: filter ? getComputedStyle(filter, '::after').content : '',
    };
  });

  await page.click('[data-navigate="categories"]');
  await page.waitForSelector('#categories.active');
  await page.click('.mode-btn[data-mode="learn"]');
  await page.click('.category-grid .category-card[data-category="C"]');
  await page.waitForSelector('#quiz.active.learn-active');
  await page.waitForSelector('.question-text:not(:empty)');
  await expect.poll(() => page.evaluate(() => document.documentElement.getAttribute('data-ui-orient'))).toBe('portrait');

  await page.click('.learn-filter-select .learn-queue-select');
  await page.click('.learn-filter-select [data-value="all"]');
  await page.click('.learn-order-select .learn-queue-select');
  await page.click('.learn-order-select [data-value="sequential"]');

  await jumpTo(1183);
  await page.waitForSelector('.abc-answers .answer-btn');
  const abcA = await measureAnswers();
  await jumpTo(1184);
  await page.waitForSelector('.abc-answers .answer-btn');
  const abcB = await measureAnswers();
  expect(abcA.kind).toContain('abc-answers');
  expect(abcB.kind).toContain('abc-answers');
  expect(abcA.rowH).toHaveLength(3);
  expect(Math.abs(abcA.rowH[0] - abcA.rowH[1])).toBeLessThan(4);
  expect(Math.abs(abcA.rowH[1] - abcA.rowH[2])).toBeLessThan(4);
  expect(Math.abs(abcA.answersTop - abcB.answersTop)).toBeLessThan(4);
  expect(Math.abs(abcA.rowH[0] - abcB.rowH[0])).toBeLessThan(4);
  expect(abcA.filterPadRight).toBeGreaterThan(8);
  expect(abcA.filterBorder).toBeGreaterThan(0);
  expect(abcA.filterCaret).toMatch(/▾/);

  await jumpTo(1201);
  await page.waitForSelector('.yn-answers .answer-btn');
  const ynA = await measureAnswers();
  await jumpTo(1252);
  await page.waitForSelector('.yn-answers .answer-btn');
  const ynB = await measureAnswers();
  expect(ynA.kind).toContain('yn-answers');
  expect(ynB.kind).toContain('yn-answers');
  expect(Math.abs(ynA.answersTop - ynB.answersTop)).toBeLessThan(4);
  expect(Math.abs(ynA.qH - ynB.qH)).toBeLessThan(4);

  await page.click('.quiz-back.visible');
  await page.waitForSelector('#categories.active');
  await page.click('.mode-btn[data-mode="exam"]');
  await page.click('.category-grid .category-card[data-category="C"]');
  await page.waitForSelector('.modal-overlay.active');
  await page.click('.btn-confirm-end');
  await page.waitForSelector('#quiz.active.exam-active');
  await page.waitForSelector('.question-text:not(:empty)');
  const examDock = await page.evaluate(() => {
    const answers = document.querySelector('.answers')?.getBoundingClientRect();
    const dock = document.querySelector('.quiz-dock')?.getBoundingClientRect();
    return {
      dockH: dock?.height ?? 0,
      pin: (dock?.bottom ?? 0) - (answers?.bottom ?? 0),
    };
  });
  expect(examDock.dockH).toBeGreaterThan(80);
  expect(examDock.pin).toBeLessThan(24);
});

test('portrait Station keeps ABC and YN in a fixed dock; filters look like dropdowns', async ({ page }) => {
  await page.setViewportSize({ width: 420, height: 900 });
  await page.goto('/');
  await page.waitForSelector('#home.active');
  if ((await page.locator('html').getAttribute('data-exam-skin')) !== 'station') {
    await cycleSkin(page);
    await page.waitForFunction(() => document.documentElement.getAttribute('data-exam-skin') === 'station');
  }

  const jumpTo = async (n) => {
    const input = page.locator('.learn-qnum-input');
    await input.click();
    await input.fill(String(n));
    await input.press('Enter');
    await page.waitForFunction((pos) => {
      const el = document.querySelector('.learn-qnum-input');
      return el && el.value === String(pos);
    }, n);
  };

  const measureAnswers = () => page.evaluate(() => {
    const answers = document.querySelector('.answers');
    const rows = [...(answers?.querySelectorAll('.answer-btn') || [])].map((el) => el.getBoundingClientRect());
    const a = answers?.getBoundingClientRect();
    const q = document.querySelector('.question-text');
    const media = document.querySelector('.media-area')?.getBoundingClientRect();
    const filter = document.querySelector('.learn-filter-select .learn-queue-select');
    const filterCs = filter ? getComputedStyle(filter) : null;
    return {
      kind: answers?.className || '',
      answersTop: a?.top ?? 0,
      qH: q?.getBoundingClientRect().height ?? 0,
      rowH: rows.map((r) => r.height),
      mediaRatio: media && media.width ? media.height / media.width : 0,
      filterPadRight: filterCs ? parseFloat(filterCs.paddingRight) || 0 : 0,
      filterBorder: filterCs ? parseFloat(filterCs.borderTopWidth) || 0 : 0,
      filterCaret: filter ? getComputedStyle(filter, '::after').content : '',
    };
  });

  await page.click('[data-navigate="categories"]');
  await page.waitForSelector('#categories.active');
  await page.click('.mode-btn[data-mode="learn"]');
  await page.click('.category-grid .category-card[data-category="C"]');
  await page.waitForSelector('#quiz.active.learn-active');
  await page.waitForSelector('.question-text:not(:empty)');
  await expect.poll(() => page.evaluate(() => document.documentElement.getAttribute('data-ui-orient'))).toBe('portrait');

  await page.click('.learn-filter-select .learn-queue-select');
  await page.click('.learn-filter-select [data-value="all"]');
  await page.click('.learn-order-select .learn-queue-select');
  await page.click('.learn-order-select [data-value="sequential"]');

  await jumpTo(1183);
  await page.waitForSelector('.abc-answers .answer-btn');
  const abcA = await measureAnswers();
  await jumpTo(1184);
  await page.waitForSelector('.abc-answers .answer-btn');
  const abcB = await measureAnswers();
  expect(abcA.kind).toContain('abc-answers');
  expect(abcB.kind).toContain('abc-answers');
  expect(abcA.rowH).toHaveLength(3);
  expect(Math.abs(abcA.rowH[0] - abcA.rowH[1])).toBeLessThan(4);
  expect(Math.abs(abcA.rowH[1] - abcA.rowH[2])).toBeLessThan(4);
  expect(Math.abs(abcA.answersTop - abcB.answersTop)).toBeLessThan(4);
  expect(Math.abs(abcA.mediaRatio - 9 / 16)).toBeLessThan(0.04);
  expect(abcA.filterPadRight).toBeGreaterThan(8);
  expect(abcA.filterBorder).toBeGreaterThan(0);
  expect(abcA.filterCaret).toMatch(/▾/);

  await jumpTo(1201);
  await page.waitForSelector('.yn-answers .answer-btn');
  const ynA = await measureAnswers();
  await jumpTo(1252);
  await page.waitForSelector('.yn-answers .answer-btn');
  const ynB = await measureAnswers();
  expect(ynA.kind).toContain('yn-answers');
  expect(ynB.kind).toContain('yn-answers');
  expect(Math.abs(ynA.answersTop - ynB.answersTop)).toBeLessThan(4);
  expect(Math.abs(ynA.qH - ynB.qH)).toBeLessThan(4);
});

test('portrait Panel exam header fits above the film; question matches learn size', async ({ page }) => {
  await page.setViewportSize({ width: 420, height: 900 });
  await page.goto('/');
  await page.waitForSelector('#home.active');
  if ((await page.locator('html').getAttribute('data-exam-skin')) !== 'panel') {
    await page.click('.skin-btn');
    await page.waitForFunction(() => document.documentElement.getAttribute('data-exam-skin') === 'panel');
  }
  await page.click('[data-navigate="categories"]');
  await page.waitForSelector('#categories.active');
  await page.click('.mode-btn[data-mode="exam"]');
  await page.click('.category-grid .category-card[data-category="B"]');
  await page.waitForSelector('.modal-overlay.active');
  await page.click('.btn-confirm-end');
  await page.waitForSelector('#quiz.active.exam-active');
  await page.waitForSelector('.question-text:not(:empty)');
  await expect.poll(() => page.evaluate(() => document.documentElement.getAttribute('data-ui-orient'))).toBe('portrait');

  const examPortrait = await page.evaluate(() => {
    const fields = document.querySelector('.exam-top-fields');
    const media = document.querySelector('.media-area').getBoundingClientRect();
    const q = getComputedStyle(document.querySelector('.question-text'));
    const btn = document.querySelector('.yn-answers .answer-btn, .abc-answers .answer-btn');
    const items = [...fields.querySelectorAll('.word-meta-item')].map((el) => {
      const box = el.getBoundingClientRect();
      const parent = fields.getBoundingClientRect();
      return {
        overflowX: box.right > parent.right + 2 || box.left < parent.left - 2,
        overflowY: box.bottom > parent.bottom + 2 || box.top < parent.top - 2,
      };
    });
    const end = document.querySelector('.btn-end-exam.visible')?.getBoundingClientRect();
    const head = fields.getBoundingClientRect();
    return {
      orient: document.documentElement.getAttribute('data-ui-orient'),
      skin: document.documentElement.getAttribute('data-exam-skin'),
      qSize: parseFloat(q.fontSize),
      btnSize: btn ? parseFloat(getComputedStyle(btn).fontSize) : 20,
      fieldsOverflow: fields.scrollWidth > fields.clientWidth + 2,
      itemOverflow: items.some((item) => item.overflowX || item.overflowY),
      headBottom: head.bottom,
      mediaTop: media.top,
      endRight: end?.right ?? 0,
      stageRight: document.querySelector('.word-layout')?.getBoundingClientRect().right ?? 0,
    };
  });
  expect(examPortrait.orient).toBe('portrait');
  expect(examPortrait.skin).toBe('panel');
  expect(examPortrait.fieldsOverflow).toBe(false);
  expect(examPortrait.itemOverflow).toBe(false);
  expect(examPortrait.headBottom).toBeLessThanOrEqual(examPortrait.mediaTop + 2);
  expect(examPortrait.endRight).toBeLessThanOrEqual(examPortrait.stageRight + 2);
  expect(examPortrait.qSize).toBeGreaterThanOrEqual(24);
  expect(examPortrait.qSize / examPortrait.btnSize).toBeGreaterThan(1.15);
});

test('Panel exam keeps time-bar space while the clip plays so chrome does not jump', async ({ page }) => {
  await page.setViewportSize({ width: 420, height: 900 });
  await page.goto('/');
  await page.waitForSelector('#home.active');
  if ((await page.locator('html').getAttribute('data-exam-skin')) !== 'panel') {
    await page.click('.skin-btn');
    await page.waitForFunction(() => document.documentElement.getAttribute('data-exam-skin') === 'panel');
  }
  await page.click('[data-navigate="categories"]');
  await page.waitForSelector('#categories.active');
  await page.click('.mode-btn[data-mode="exam"]');
  await page.click('.category-grid .category-card[data-category="PT"]');
  await page.waitForSelector('.modal-overlay.active');
  await page.click('.btn-confirm-end');
  await page.waitForSelector('#quiz.active.exam-active');
  await page.waitForSelector('.question-text:not(:empty)');

  for (let i = 0; i < 8 && !(await page.locator('.exam-film-pending').count()); i += 1) {
    const yn = page.locator('.yn-answers .answer-btn').first();
    if (!(await yn.count())) break;
    await yn.click();
    await expect(page.locator('.btn-exam-next.visible')).toBeEnabled();
    await page.locator('.btn-exam-next.visible').click();
    await page.waitForSelector('.question-text:not(:empty)');
  }
  if (!(await page.locator('.exam-film-pending').count())) return;

  const measure = () => page.evaluate(() => {
    const row = document.querySelector('.exam-time-row');
    const caption = document.querySelector('.exam-phase-caption');
    const dock = document.querySelector('.quiz-dock');
    const next = document.querySelector('.btn-exam-next.visible');
    const q = document.querySelector('.question-text');
    const media = document.querySelector('.media-area');
    const rowBox = row?.getBoundingClientRect();
    const cs = row ? getComputedStyle(row) : null;
    return {
      phase: document.getElementById('quiz')?.getAttribute('data-exam-phase'),
      rowH: rowBox?.height ?? 0,
      rowVis: cs?.visibility || '',
      rowDisplay: cs?.display || '',
      captionH: caption?.getBoundingClientRect().height ?? 0,
      dockTop: dock?.getBoundingClientRect().top ?? 0,
      nextTop: next?.getBoundingClientRect().top ?? 0,
      qTop: q?.getBoundingClientRect().top ?? 0,
      mediaBottom: media?.getBoundingClientRect().bottom ?? 0,
    };
  });

  const before = await measure();
  await page.click('.exam-film-start');
  await expect.poll(() => page.evaluate(() => document.getElementById('quiz')?.getAttribute('data-exam-phase'))).toBe('watch');
  const during = await measure();
  expect(during.rowDisplay).not.toBe('none');
  expect(during.rowH).toBeGreaterThan(8);
  expect(during.rowVis).toBe('hidden');
  expect(Math.abs(during.dockTop - before.dockTop)).toBeLessThan(4);
  expect(Math.abs(during.nextTop - before.nextTop)).toBeLessThan(4);
  expect(Math.abs(during.qTop - before.qTop)).toBeLessThan(4);
  expect(Math.abs(during.mediaBottom - before.mediaBottom)).toBeLessThan(4);

  await page.evaluate(() => {
    document.querySelector('#quiz video')?.dispatchEvent(new Event('ended'));
  });
  await expect.poll(() => page.evaluate(() => document.getElementById('quiz')?.getAttribute('data-exam-phase'))).toBe('answer');
  const after = await measure();
  expect(after.rowVis).not.toBe('hidden');
  expect(Math.abs(after.dockTop - during.dockTop)).toBeLessThan(4);
  expect(Math.abs(after.nextTop - during.nextTop)).toBeLessThan(4);
  expect(Math.abs(after.qTop - during.qTop)).toBeLessThan(4);
});
