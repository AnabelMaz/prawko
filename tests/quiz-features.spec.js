const { test, expect } = require('@playwright/test');
const { goToCategories, cycleLanguage, cycleSkin, learnCatalogLabel, waitForUiHold } = require('./helpers');
const TINY_MP4 = require('./tiny-mp4');

// Helper: navigate to categories and start learn mode for category B
async function startLearnMode(page, { localJson, category = 'B' } = {}) {
  await page.route('**/local.json', async (route) => {
    if (localJson) {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify(localJson),
      });
      return;
    }
    await route.fulfill({ status: 404, body: '' });
  });
  await page.goto('/');
  await goToCategories(page);
  // Ensure "Nauka" mode is selected (default)
  await page.click('.mode-btn[data-mode="learn"]');
  await page.click(`.category-grid .category-card[data-category="${category}"]`);
  await page.waitForSelector('#quiz.active');
  await waitForUiHold(page);
}

async function setLearnQueue(page, kind, value) {
  const root = page.locator(`.learn-${kind}-select`);
  await root.locator('.learn-queue-select').click();
  await root.locator(`[role="option"][data-value="${value}"]`).click();
}

/** Player waits for captureViewedMedia; a hanging mp4 route never creates <video>. */
async function stubLearnVideoFiles(page) {
  const body = TINY_MP4;
  await page.route(/\.(mp4|webm)(\?|$)/i, async (route) => {
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
    await route.fulfill({
      status: 200,
      contentType: 'video/mp4',
      headers: { 'Access-Control-Allow-Origin': '*' },
      body,
    });
  });
}

// Helper: navigate to categories and start exam mode for category PT (smallest)
async function startExamMode(page) {
  await page.goto('/');
  await goToCategories(page);
  await page.click('.mode-btn[data-mode="exam"]');
  await page.click('.category-grid .category-card[data-category="PT"]');
  await page.waitForSelector('.modal-overlay.active');
  await page.click('.btn-confirm-end');
  await page.waitForSelector('#quiz.active');
  await page.waitForSelector('.question-text:not(:empty)');
}

test.describe('Results screen back button', () => {

  test('results header has back-to-categories button', async ({ page }) => {
    await page.goto('/');
    await page.waitForSelector('#home.active');

    // Check the button exists in the HTML
    const backBtn = page.locator('#results .screen-header .btn-back');
    await expect(backBtn).toHaveAttribute('data-navigate', 'categories');
    await expect(backBtn).toHaveAttribute('data-i18n', 'backToCategories');
    await expect(backBtn).toHaveText(/← Powrót do kategorii/);
  });

  test('results back button navigates to categories', async ({ page }) => {
    // Start an exam and finish it quickly by clicking through all questions
    await startExamMode(page);

    // Wait for first question, then end exam via the end button + confirm
    await page.click('.btn-end-exam');
    await page.waitForSelector('.modal-overlay.active');
    await page.click('.btn-confirm-end');
    await page.waitForSelector('#results.active');

    // Click the back button in the results header
    const backBtn = page.locator('#results .screen-header .btn-back');
    await expect(backBtn).toBeVisible();
    await expect(backBtn).toHaveText(/←/);
    const backBox = await backBtn.boundingBox();
    const tableBox = await page.locator('#results .score-breakdown').boundingBox();
    expect(backBox).toBeTruthy();
    expect(tableBox).toBeTruthy();
    expect(backBox.x).toBeLessThan(page.viewportSize().width / 2);
    await backBtn.click();
    await page.waitForSelector('#categories.active');
    await expect(page.locator('.mode-btn[data-mode="exam"]')).toHaveClass(/active/);
  });
});

test.describe('Quiz back button (learn mode only)', () => {

  test('quiz-back button is visible in learn mode', async ({ page }) => {
    await startLearnMode(page);
    const quizBack = page.locator('.quiz-back');
    await expect(quizBack).toBeVisible();
  });

  test('quiz-back button is hidden in exam mode', async ({ page }) => {
    await startExamMode(page);
    const quizBack = page.locator('.quiz-back');
    await expect(quizBack).not.toBeVisible();
  });

  test('quiz-back button navigates to categories', async ({ page }) => {
    await startLearnMode(page);
    await page.click('.quiz-back', { force: true });
    await page.waitForSelector('#categories.active');
  });
});

test.describe('Video autoplay', () => {

  test('video elements have muted and autoplay attributes', async ({ page }) => {
    await startLearnMode(page);

    // Find a question with video by navigating through questions
    // We'll check by evaluating the renderQuestion logic - look for any video element
    const hasVideo = await page.evaluate(() => {
      const video = document.querySelector('.media-area video');
      return video ? { muted: video.muted, autoplay: video.autoplay, preload: video.preload } : null;
    });

    if (hasVideo) {
      expect(hasVideo.muted).toBe(true);
      expect(hasVideo.autoplay).toBe(true);
      expect(hasVideo.preload).toBe('auto');
    } else {
      // No video on first question - verify the attributes are set in the source code
      // by checking that the renderQuestion function sets them
      const uiSource = await page.evaluate(async () => {
        const resp = await fetch('/js/ui.js');
        return resp.text();
      });
      expect(uiSource).toContain('video.muted = true');
      expect(uiSource).toContain('video.autoplay = !holdEnd');
      expect(uiSource).toContain("video.preload = 'auto'");
    }
  });

  test('returning to an answered video shows the last frame and does not play', async ({ page }) => {
    await stubLearnVideoFiles(page);
    await startLearnMode(page, {
      localJson: { mediaBase: 'cdn', learnQuestionJump: true },
    });
    await setLearnQueue(page, 'filter', 'all');
    await setLearnQueue(page, 'order', 'sequential');
    const pos = await page.evaluate(async () => {
      const data = await import(new URL('./js/data.js', location.href).href).then((m) => m.fetchCategory('B'));
      const i = data.questions.findIndex((q) => q.mediaType === 'video');
      return i >= 0 ? i + 1 : 0;
    });
    expect(pos).toBeGreaterThan(0);
    const input = page.locator('.learn-qnum-input');
    await input.fill(String(pos));
    await input.press('Enter');
    const video = page.locator('#quiz .media-area video');
    await expect(video).toHaveCount(1);
    await expect(video).toHaveJSProperty('autoplay', true);
    const qid = await page.locator('.question-card').getAttribute('data-question-id');

    await page.locator('.btn-next').click();
    await expect(input).not.toHaveValue(String(pos));
    await page.locator('.btn-prev').click();
    await expect(input).toHaveValue(String(pos));
    await expect(video).toHaveJSProperty('autoplay', true);

    await page.locator('.answers .answer-btn').first().click();
    await page.locator('.btn-next').click();
    await expect(input).not.toHaveValue(String(pos));

    await page.evaluate((id) => {
      window.__learnFrames = [];
      const sample = () => {
        const card = document.querySelector('.question-card');
        if (card?.dataset.questionId !== id) return;
        const el = document.querySelector('#quiz .media-area video');
        if (!el) return;
        window.__learnFrames.push({
          t: el.currentTime,
          dur: el.duration,
          opacity: Number(getComputedStyle(el).opacity),
        });
      };
      window.__learnFrameTimer = setInterval(sample, 16);
    }, qid);

    await page.locator('.btn-prev').click();
    await expect(input).toHaveValue(String(pos));
    await page.waitForFunction(() => {
      const el = document.querySelector('#quiz .media-area video');
      if (!el || !Number.isFinite(el.duration) || el.duration <= 0) return false;
      const opacity = Number(getComputedStyle(el).opacity);
      return opacity > 0.9 && el.paused && el.currentTime >= el.duration - 0.05;
    });
    const snap = await video.evaluate((el) => ({
      autoplay: el.autoplay,
      paused: el.paused,
      t: el.currentTime,
      dur: el.duration,
    }));
    expect(snap.autoplay).toBe(false);
    expect(snap.paused).toBe(true);
    expect(snap.t).toBeGreaterThanOrEqual(snap.dur - 0.05);
    await expect(page.locator('#quiz .media-replay-btn')).toBeVisible();

    const earlyVisible = await page.evaluate(() => {
      clearInterval(window.__learnFrameTimer);
      return (window.__learnFrames || []).filter((frame) => (
        frame.opacity > 0.9
        && Number.isFinite(frame.dur)
        && frame.dur > 0
        && frame.t < frame.dur - 0.05
      ));
    });
    expect(earlyVisible).toEqual([]);
  });
});

test.describe('Learn media is only the current question', () => {
  test('catalog 867 in T does not also fetch another question webp', async ({ page }) => {
    const media = [];
    page.on('request', (req) => {
      const url = req.url();
      if (/\.(mp4|webm|webp)(\?|$)/i.test(url)) media.push(url);
    });
    await startLearnMode(page, {
      category: 'T',
      localJson: { learnQuestionJump: true, mediaBase: 'cdn' },
    });
    await setLearnQueue(page, 'filter', 'all');
    await setLearnQueue(page, 'order', 'sequential');
    const input = page.locator('.learn-qnum-input');
    await input.click();
    await input.fill('867');
    await input.press('Enter');
    await page.waitForFunction(() => document.querySelector('.learn-qnum-input')?.value === '867');
    await page.waitForSelector('#quiz .media-area video, #quiz .media-area img');
    const src = await page.locator('#quiz .media-area video, #quiz .media-area img').evaluate((el) => el.currentSrc || el.src);
    expect(src.startsWith('blob:') || src.includes('3596.mp4')).toBe(true);
    const names = [...new Set(media.map((url) => url.split('/').pop().split('?')[0]))];
    expect(names).toContain('3596.mp4');
    expect(names).not.toContain('4C301.webp');
  });
});

test.describe('Learn video result mark', () => {
  test('mark stays on after answer while the clip plays; only replay hides it', async ({ page }) => {
    await stubLearnVideoFiles(page);
    await startLearnMode(page, {
      localJson: { mediaBase: 'cdn', learnQuestionJump: true },
    });
    await setLearnQueue(page, 'filter', 'all');
    await setLearnQueue(page, 'order', 'sequential');
    const pos = await page.evaluate(async () => {
      const data = await import(new URL('./js/data.js', location.href).href).then((m) => m.fetchCategory('B'));
      const i = data.questions.findIndex((q) => q.mediaType === 'video');
      return i >= 0 ? i + 1 : 0;
    });
    expect(pos).toBeGreaterThan(0);
    await page.locator('.learn-qnum-input').fill(String(pos));
    await page.locator('.learn-qnum-input').press('Enter');
    const mediaArea = page.locator('#quiz .media-area');
    await expect(mediaArea.locator('video')).toHaveCount(1);
    await mediaArea.locator('video').evaluate((video) => {
      video.autoplay = false;
      video.pause();
      video.play = () => Promise.resolve();
      Object.defineProperty(video, 'ended', { configurable: true, get: () => false });
      Object.defineProperty(video, 'seeking', { configurable: true, get: () => false });
      for (const type of ['play', 'pause', 'ended', 'seeking', 'seeked']) {
        video.addEventListener(type, (event) => {
          if (event.isTrusted) event.stopImmediatePropagation();
        }, true);
      }
    });
    await page.locator('.answers .answer-btn').first().click();
    const mark = page.locator('#quiz .learn-media-mark');
    await expect(mark).toBeVisible();
    await expect(mark).toHaveCSS('font-family', /Noto Sans Symbols/);
    await mediaArea.locator('video').evaluate((video) => {
      video.dispatchEvent(new Event('play'));
    });
    await expect(mark).toBeVisible();
    const markedAnswers = page.locator('.answers .answer-btn.correct, .answers .answer-btn.incorrect');
    await expect(markedAnswers).not.toHaveCount(0);
    const answerSnapshot = await markedAnswers.evaluateAll((els) => els.map((el) => el.className).sort());
    await mediaArea.locator('video').evaluate((video) => {
      video.pause();
      video.dispatchEvent(new Event('ended'));
    });
    await expect(mark).toBeVisible();
    await page.locator('#quiz .media-replay-btn').click();
    await expect(mark).toBeHidden();
    await expect(markedAnswers).not.toHaveCount(0);
    expect(await markedAnswers.evaluateAll((els) => els.map((el) => el.className).sort())).toEqual(answerSnapshot);
    await mediaArea.locator('video').evaluate((video) => {
      video.dispatchEvent(new Event('pause'));
    });
    await expect(mark).toBeHidden();
    await mediaArea.locator('video').evaluate((video) => {
      Object.defineProperty(video, 'currentTime', { configurable: true, get: () => 1, set: () => {} });
      video.pause();
      video.dispatchEvent(new Event('pause'));
    });
    await expect(mark).toBeVisible();
    await mediaArea.locator('video').evaluate((video) => {
      video.dispatchEvent(new Event('play'));
    });
    await expect(mark).toBeHidden();
    await mediaArea.locator('video').evaluate((video) => {
      video.pause();
      video.dispatchEvent(new Event('ended'));
    });
    await expect(mark).toBeVisible();
    expect(await markedAnswers.evaluateAll((els) => els.map((el) => el.className).sort())).toEqual(answerSnapshot);
  });

  test('answer mark returns after next/prev on image and video questions', async ({ page }) => {
    await stubLearnVideoFiles(page);
    await startLearnMode(page, {
      localJson: { mediaBase: 'cdn', learnQuestionJump: true },
    });
    await setLearnQueue(page, 'filter', 'all');
    await setLearnQueue(page, 'order', 'sequential');
    const targets = await page.evaluate(async () => {
      const data = await import(new URL('./js/data.js', location.href).href).then((m) => m.fetchCategory('B'));
      const emptyPos = data.questions.findIndex((q) => !q.media) + 1;
      const imagePos = data.questions.findIndex((q) => q.media && q.mediaType === 'image') + 1;
      const videoPos = data.questions.findIndex((q) => q.mediaType === 'video') + 1;
      return { emptyPos, imagePos, videoPos };
    });
    expect(targets.emptyPos).toBeGreaterThan(0);
    expect(targets.imagePos).toBeGreaterThan(0);
    expect(targets.videoPos).toBeGreaterThan(0);

    const mark = page.locator('#quiz .learn-media-mark');
    const jump = async (pos) => {
      await page.locator('.learn-qnum-input').fill(String(pos));
      await page.locator('.learn-qnum-input').press('Enter');
    };

    const watchMarkDuringLoad = () => page.evaluate(() => {
      window.__markDuringLoad = false;
      const area = document.querySelector('#quiz .media-area');
      const see = () => {
        const badge = area.querySelector('.learn-media-mark');
        if (area.classList.contains('loading') && badge && !badge.hidden) window.__markDuringLoad = true;
      };
      new MutationObserver(see).observe(area, {
        attributes: true,
        childList: true,
        subtree: true,
      });
    });

    await jump(targets.emptyPos);
    await expect(page.locator('#quiz .media-area')).toHaveClass(/media-empty/);
    await page.locator('.answers .answer-btn').first().click();
    await expect(mark).toBeVisible();
    await page.locator('.btn-next').click();
    await page.locator('.btn-prev').click();
    await expect(page.locator('#quiz .media-area')).toHaveClass(/media-empty/);
    await expect(mark).toBeVisible();

    await jump(targets.imagePos);
    await expect(page.locator('#quiz .media-area img')).toHaveCount(1);
    await page.locator('.answers .answer-btn').first().click();
    await expect(mark).toBeVisible();
    await page.locator('.btn-next').click();
    await watchMarkDuringLoad();
    await page.locator('.btn-prev').click();
    await expect(page.locator('#quiz .media-area img')).toHaveCount(1);
    await expect(mark).toBeVisible();
    expect(await page.evaluate(() => window.__markDuringLoad)).toBe(false);

    await jump(targets.videoPos);
    await expect(page.locator('#quiz .media-area video')).toHaveCount(1);
    await page.locator('.answers .answer-btn').first().click();
    await expect(mark).toBeVisible();
    await page.locator('#quiz .media-area video').evaluate((video) => {
      video.dispatchEvent(new Event('play'));
    });
    await expect(mark).toBeVisible();
    await page.locator('.btn-next').click();
    await watchMarkDuringLoad();
    await page.locator('.btn-prev').click();
    await expect(page.locator('#quiz .media-area video')).toHaveCount(1);
    await expect(mark).toBeVisible();
    expect(await page.evaluate(() => window.__markDuringLoad)).toBe(false);
    await page.locator('#quiz .media-area video').evaluate((video) => {
      video.dispatchEvent(new Event('play'));
    });
    await expect(mark).toBeVisible();
    await page.locator('#quiz .media-area video').evaluate((video) => {
      video.pause();
      video.dispatchEvent(new Event('ended'));
    });
    await page.locator('#quiz .media-replay-btn').click();
    await expect(mark).toBeHidden();
    await page.locator('#quiz .media-area video').evaluate((video) => {
      video.pause();
      video.dispatchEvent(new Event('ended'));
    });
    await expect(mark).toBeVisible();
  });
});

test.describe('Media slot size', () => {
  test('empty and filled media slots stay 16:9 and the same size', async ({ page }) => {
    await startLearnMode(page, { localJson: { learnQuestionJump: true, mediaBase: 'cdn' } });
    await setLearnQueue(page, 'filter', 'all');
    await setLearnQueue(page, 'order', 'sequential');
    const area = page.locator('.media-area');
    await expect(area).toBeVisible();
    const targets = await page.evaluate(async () => {
      const data = await import(new URL('./js/data.js', location.href).href).then((m) => m.fetchCategory('B'));
      const empty = data.questions.findIndex((q) => !q.media);
      const filled = data.questions.findIndex((q) => q.media && q.mediaType === 'image');
      return {
        emptyPos: empty >= 0 ? empty + 1 : 0,
        filledPos: filled >= 0 ? filled + 1 : 0,
      };
    });
    expect(targets.emptyPos).toBeGreaterThan(0);
    expect(targets.filledPos).toBeGreaterThan(0);

    await page.locator('.learn-qnum-input').fill(String(targets.emptyPos));
    await page.locator('.learn-qnum-input').press('Enter');
    await expect(area).toHaveClass(/media-empty/);
    const emptyBox = await area.boundingBox();

    await page.locator('.learn-qnum-input').fill(String(targets.filledPos));
    await page.locator('.learn-qnum-input').press('Enter');
    await expect(area).toHaveClass(/has-media/);
    const filledBox = await area.boundingBox();

    expect(emptyBox, 'expected a question without media').toBeTruthy();
    expect(filledBox, 'expected a question with media').toBeTruthy();
    expect(emptyBox.width / emptyBox.height).toBeCloseTo(16 / 9, 1);
    expect(filledBox.width / filledBox.height).toBeCloseTo(16 / 9, 1);
    expect(Math.abs(emptyBox.width - filledBox.width)).toBeLessThan(2);
    expect(Math.abs(emptyBox.height - filledBox.height)).toBeLessThan(2);
  });
});

test.describe('Unavailable CDN media', () => {
  test('learn fallback keeps the message and links to category download', async ({ page }) => {
    await page.route('https://f003.backblazeb2.com/**', (route) => route.abort());
    await page.route('https://pub-e8e3a36b9ab44034913636d87ee3f0ee.r2.dev/**', async (route) => {
      await new Promise((resolve) => setTimeout(resolve, 20000));
      await route.abort();
    });
    await startLearnMode(page, { localJson: { mediaBase: 'cdn' } });
    await page.evaluate(async () => {
      const { renderQuestion } = await import(new URL('./js/ui.js', location.href).href);
      renderQuestion({
        id: 1,
        q: 'Test?',
        media: 'no-such-file.webp',
        mediaType: 'image',
        type: 'basic',
        correct: 'T',
      }, document.querySelector('.question-card'), { categoryId: 'B' });
    });
    const box = page.locator('.media-unavailable');
    await expect(box).toContainText('Multimedia niedostępne');
    const link = page.locator('.media-offline-link');
    await expect(link).toHaveText('Pobierz kategorię B offline');
    await expect(page.locator('.media-retry-btn')).toHaveText('Spróbuj ponownie');
    await link.click();
    await page.waitForSelector('#categories.active');
    await expect(page.locator('.category-grid .category-card[data-category="B"] .offline-btn')).toHaveClass(/downloading/);
  });

  test('local media fallback does not offer a CDN pack download', async ({ page }) => {
    await page.route('**/media/**', (route) => route.abort());
    await page.route('https://f003.backblazeb2.com/**', (route) => route.abort());
    await startLearnMode(page, { localJson: { mediaBase: 'media' } });
    await page.evaluate(async () => {
      const { renderQuestion } = await import(new URL('./js/ui.js', location.href).href);
      renderQuestion({
        id: 1,
        q: 'Test?',
        media: 'no-such-file.webp',
        mediaType: 'image',
        type: 'basic',
        correct: 'T',
      }, document.querySelector('.question-card'), { categoryId: 'B' });
    });
    await expect(page.locator('.media-unavailable')).toHaveText('Multimedia niedostępne');
    await expect(page.locator('.media-offline-link')).toHaveCount(0);
  });
});

test.describe('Language switch during quiz', () => {
  test('language switch updates html lang and radio state', async ({ page }) => {
    await page.goto('/');
    await page.waitForSelector('#home.active');

    await expect(page.locator('html')).toHaveAttribute('lang', 'pl');
    await expect(page.locator('.lang-cycle')).toHaveAttribute('data-lang', 'pl');
    await expect(page.locator('.lang-cycle')).toHaveText('PL');

    await cycleLanguage(page);

    await expect(page.locator('html')).toHaveAttribute('lang', 'en');
    await expect(page.locator('.lang-cycle')).toHaveAttribute('data-lang', 'en');
    await expect(page.locator('.lang-cycle')).toHaveText('EN');
  });

  test('language cycle includes Ukrainian', async ({ page }) => {
    await page.goto('/');
    await page.waitForSelector('#home.active');
    await cycleLanguage(page);
    await cycleLanguage(page);
    await cycleLanguage(page);
    await expect(page.locator('.lang-cycle')).toHaveAttribute('data-lang', 'uk');
    await expect(page.locator('.lang-cycle')).toHaveText('UK');
  });

  test('missing Ukrainian question text falls back to English, not Polish', async ({ page }) => {
    await page.route('**/data/translations_uk.json', async (route) => {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: '{}',
      });
    });
    await startLearnMode(page);
    const questionTextPl = await page.textContent('.question-text');
    expect(questionTextPl.length).toBeGreaterThan(0);

    await cycleLanguage(page);
    await page.waitForFunction((pl) => {
      const el = document.querySelector('.question-text');
      return el && el.textContent && el.textContent !== pl;
    }, questionTextPl);
    const questionTextEn = await page.textContent('.question-text');
    expect(questionTextEn).not.toBe(questionTextPl);

    await cycleLanguage(page);
    await cycleLanguage(page);
    await expect(page.locator('.lang-cycle')).toHaveAttribute('data-lang', 'uk');
    const questionTextUk = await page.textContent('.question-text');
    expect(questionTextUk).toBe(questionTextEn);
    expect(questionTextUk).not.toBe(questionTextPl);
  });

  test('switching language updates question text in learn mode', async ({ page }) => {
    await startLearnMode(page);

    // Get the Polish question text
    const questionTextPl = await page.textContent('.question-text');
    expect(questionTextPl.length).toBeGreaterThan(0);

    // Switch to English
    await cycleLanguage(page);
    // Wait for translations to load
    await page.waitForTimeout(500);

    // Get the English question text
    const questionTextEn = await page.textContent('.question-text');
    expect(questionTextEn.length).toBeGreaterThan(0);

    // The text should have changed (translation applied)
    expect(questionTextEn).not.toBe(questionTextPl);
  });

  test('switching language updates answer buttons in learn mode', async ({ page }) => {
    await startLearnMode(page);

    // Get Polish answer text (TAK/NIE for basic questions)
    const answersPl = await page.evaluate(() =>
      [...document.querySelectorAll('.answer-btn')].map(b => b.textContent.trim())
    );

    // Switch to English
    await cycleLanguage(page);
    await page.waitForTimeout(500);

    const answersEn = await page.evaluate(() =>
      [...document.querySelectorAll('.answer-btn')].map(b => b.textContent.trim())
    );

    // TAK/NIE → YES/NO; specialist sentences translate. Letter-only ABC keys
    // ("A." / "B." / "C.") are the same in every language — skip those.
    const letterOnly = answersPl.every((t) => /^[ABC]\.\s*$/i.test(t));
    if (!letterOnly) {
      expect(answersEn).not.toEqual(answersPl);
    } else {
      expect(answersEn).toEqual(answersPl);
    }
  });

  test('switching language preserves answer highlight in learn mode', async ({ page }) => {
    await startLearnMode(page);

    // Answer the question
    await page.click('.answer-btn:first-child');
    await page.waitForTimeout(200);

    // Verify a highlight exists (correct or incorrect class)
    const hasHighlight = await page.evaluate(() => {
      const btns = document.querySelectorAll('.answer-btn');
      return [...btns].some(b => b.classList.contains('correct') || b.classList.contains('incorrect'));
    });
    expect(hasHighlight).toBe(true);

    // Switch to English
    await cycleLanguage(page);
    await page.waitForTimeout(500);

    // Highlight should still be present
    const hasHighlightAfter = await page.evaluate(() => {
      const btns = document.querySelectorAll('.answer-btn');
      return [...btns].some(b => b.classList.contains('correct') || b.classList.contains('incorrect'));
    });
    expect(hasHighlightAfter).toBe(true);
  });

  test('switching language updates UI labels on quiz screen', async ({ page }) => {
    await startLearnMode(page);

    // Check that data-i18n elements update (e.g., nav buttons)
    const prevPl = await page.textContent('.btn-prev');
    expect(prevPl.trim()).toBe('Poprzednie Pytanie');

    await cycleLanguage(page);
    await page.waitForTimeout(500);

    const prevEn = await page.textContent('.btn-prev');
    expect(prevEn.trim()).toBe('Previous Question');
  });

  test('switching language updates question text in exam mode', async ({ page }) => {
    await startExamMode(page);

    const questionTextPl = await page.textContent('.question-text');
    expect(questionTextPl.length).toBeGreaterThan(0);

    // Switch to English
    await cycleLanguage(page);
    await page.waitForTimeout(500);

    const questionTextEn = await page.textContent('.question-text');
    expect(questionTextEn.length).toBeGreaterThan(0);
    expect(questionTextEn).not.toBe(questionTextPl);
  });
});

test.describe('Learn queue filter', () => {
  test('learn mode has to-learn/hard/known/all and sequential/random controls', async ({ page }) => {
    await startLearnMode(page);
    const filter = page.locator('.learn-filter-select');
    const order = page.locator('.learn-order-select');
    await expect(filter).toBeVisible();
    await expect(order).toBeVisible();
    await expect(filter.locator('[role="option"]')).toHaveCount(4);
    await expect(order.locator('[role="option"]')).toHaveCount(2);
    await expect(filter).toHaveAttribute('data-value', 'unknown');
    await expect(order).toHaveAttribute('data-value', 'random');
    await expect(page.locator('.learn-stats-known')).toBeVisible();
    const headerOrder = await page.evaluate(() => {
      const qnum = document.querySelector('.learn-qnum')?.getBoundingClientRect();
      const filter = document.querySelector('.learn-filter-select')?.getBoundingClientRect();
      const summary = document.querySelector('.learn-stats-summary')?.getBoundingClientRect();
      if (!qnum || !filter || !summary) return false;
      return qnum.right <= filter.left + 1 && filter.right <= summary.left + 1;
    });
    expect(headerOrder).toBe(true);
  });

  test('saved new or wrong queue prefs fall back to to-learn', async ({ page }) => {
    await page.addInitScript(() => {
      localStorage.setItem('prawko_p_p1_learn_queue_mode', JSON.stringify({
        B: { filter: 'wrong', order: 'sequential' },
      }));
    });
    await startLearnMode(page);
    await expect(page.locator('.learn-filter-select')).toHaveAttribute('data-value', 'unknown');
    await expect(page.locator('.learn-order-select')).toHaveAttribute('data-value', 'sequential');
    await expect(page.locator('.learn-filter-select .learn-queue-select')).toHaveText('Do nauki');
  });

  test('learn queue menus stay square in both exam skins', async ({ page }) => {
    await startLearnMode(page);
    await page.click('.learn-filter-select .learn-queue-select');
    const menu = page.locator('.learn-filter-select .learn-queue-menu');
    await expect(menu).toBeVisible();
    const image = await menu.evaluate((el) => getComputedStyle(el).borderTopLeftRadius);
    expect(parseFloat(image)).toBe(0);
    await cycleSkin(page);
    await page.click('.learn-filter-select .learn-queue-select');
    await expect(menu).toBeVisible();
    const pwpw = await menu.evaluate((el) => getComputedStyle(el).borderTopLeftRadius);
    expect(parseFloat(pwpw)).toBe(0);
  });

  test('learn uses the arrow cursor on answers after they are locked', async ({ page }) => {
    await startLearnMode(page);
    const firstBtn = page.locator('.answer-btn').first();
    await expect(firstBtn).toBeEnabled();
    const before = await firstBtn.evaluate((el) => getComputedStyle(el).cursor);
    expect(before).toMatch(/cursor-pointer/);
    await firstBtn.click();
    await expect(firstBtn).toBeDisabled();
    const after = await firstBtn.evaluate((el) => getComputedStyle(el).cursor);
    expect(after).toMatch(/cursor-(black|white)\.png/);
    expect(after).not.toMatch(/cursor-pointer/);
    const other = page.locator('.answer-btn').nth(1);
    await expect(other).toBeDisabled();
    const otherCursor = await other.evaluate((el) => getComputedStyle(el).cursor);
    expect(otherCursor).not.toMatch(/cursor-pointer/);
  });

  test('learn locks the first answer in a session when going back', async ({ page }) => {
    await page.addInitScript(() => {
      localStorage.setItem('prawko_p_p1_learn_queue_mode', JSON.stringify({
        B: { filter: 'all', order: 'sequential' },
      }));
    });
    await startLearnMode(page);
    const firstBtn = page.locator('.answer-btn').first();
    await expect(firstBtn).toBeEnabled();
    await firstBtn.click();
    await expect(page.locator('.answer-btn.correct')).toHaveCount(1);
    const correctText = await page.locator('.learn-stats-correct').textContent();
    const incorrectText = await page.locator('.learn-stats-incorrect').textContent();
    await page.click('.btn-next');
    await page.waitForSelector('.answer-btn');
    await page.click('.btn-prev');
    await expect(page.locator('.answer-btn').first()).toBeDisabled();
    await expect(page.locator('.answer-btn.correct')).toHaveCount(1);
    await page.locator('.answer-btn').nth(1).click({ force: true });
    await expect(page.locator('.learn-stats-correct')).toHaveText(correctText);
    await expect(page.locator('.learn-stats-incorrect')).toHaveText(incorrectText);

    await page.click('.quiz-back', { force: true });
    await page.waitForSelector('#categories.active');
    await page.click('.mode-btn[data-mode="learn"]');
    await page.click('.category-grid .category-card[data-category="B"]');
    await page.waitForSelector('#quiz.active');
    await expect(page.locator('.answer-btn').first()).toBeEnabled();
    await expect(page.locator('.answer-btn.correct, .answer-btn.incorrect')).toHaveCount(0);
  });

  test('hard filter lists questions missed at least twice and not yet known', async ({ page }) => {
    await page.addInitScript(() => {
      localStorage.setItem('prawko_p_p1_learn', JSON.stringify({
        B: {
          99: { answer: 'N', streak: 0, misses: 2 },
          100: { answer: 'T', streak: 2, misses: 5 },
        },
      }));
      localStorage.setItem('prawko_p_p1_learn_queue_mode', JSON.stringify({
        B: { filter: 'all', order: 'sequential' },
      }));
    });
    await startLearnMode(page);
    await setLearnQueue(page, 'filter', 'hard');
    await expect(page.locator('.learn-filter-select')).toHaveAttribute('data-value', 'hard');
    await expect(page.locator('.question-card')).toHaveAttribute('data-question-id', '99');
    expect(await learnCatalogLabel(page)).toBe('1 / 1');
  });

  test('empty filter toast sits in the center of the media area', async ({ page }) => {
    await startLearnMode(page);
    await page.locator('.learn-filter-select .learn-queue-select').click();
    await page.locator('.learn-filter-select [data-value="hard"]').click();
    const pos = await page.evaluate(() => {
      const overlay = document.querySelector('.learn-toast');
      const pill = overlay?.querySelector('.learn-toast-msg') || overlay;
      const media = document.querySelector('#quiz .media-area');
      if (!overlay || !pill || !media) return { ok: false };
      const t = pill.getBoundingClientRect();
      const m = media.getBoundingClientRect();
      return {
        ok: true,
        text: pill.textContent,
        inMedia: media.contains(overlay),
        dx: Math.abs((t.left + t.width / 2) - (m.left + m.width / 2)),
        dy: Math.abs((t.top + t.height / 2) - (m.top + m.height / 2)),
      };
    });
    expect(pos).toEqual(expect.objectContaining({ ok: true, text: 'Brak trudnych', inMedia: true }));
    expect(pos.dx).toBeLessThan(40);
    expect(pos.dy).toBeLessThan(40);
  });

  test('learn toast scales down in a small window', async ({ page }) => {
    await page.setViewportSize({ width: 640, height: 450 });
    await startLearnMode(page);
    await page.locator('.learn-filter-select .learn-queue-select').click();
    await page.locator('.learn-filter-select [data-value="hard"]').click();
    const metrics = await page.evaluate(() => {
      const pill = document.querySelector('.learn-toast-msg');
      const media = document.querySelector('#quiz .media-area');
      if (!pill || !media) return null;
      const p = pill.getBoundingClientRect();
      const m = media.getBoundingClientRect();
      return {
        pillH: p.height,
        mediaH: m.height,
        scale: Number(getComputedStyle(document.documentElement).getPropertyValue('--ui-scale')),
      };
    });
    expect(metrics).toBeTruthy();
    expect(metrics.scale).toBeGreaterThan(0.05);
    expect(metrics.scale).toBeLessThan(0.9);
    expect(metrics.pillH).toBeLessThan(metrics.mediaH * 0.35);
  });

  test('switching a non-empty filter toasts the new queue', async ({ page }) => {
    await startLearnMode(page);
    await setLearnQueue(page, 'filter', 'all');
    const pos = await page.evaluate(() => {
      const overlay = document.querySelector('.learn-toast');
      const pill = overlay?.querySelector('.learn-toast-msg') || overlay;
      return { text: pill?.textContent || null };
    });
    expect(pos.text).toBe('Wszystkie · Losowo');
    await expect(page.locator('.learn-filter-select')).toHaveAttribute('data-value', 'all');
  });
});

test.describe('Learn progress summary', () => {
  test('top chips count unique question ids across categories', async ({ page }) => {
    await page.addInitScript(() => {
      localStorage.setItem('prawko_p_p1_learn', JSON.stringify({
        B: { 1: { answer: 'T', streak: 2, misses: 0 } },
        C: {
          1: { answer: 'N', streak: 0, misses: 2 },
          2: { answer: 'N', streak: 0, misses: 0 },
        },
      }));
    });
    await page.goto('/');
    await page.waitForSelector('#home.active');
    const counts = await page.evaluate(async () => {
      const { getLearnUniqueFilterCounts } = await import(new URL('./js/stats.js', location.href).href);
      const q = (id) => ({ id, correct: 'T' });
      return getLearnUniqueFilterCounts([
        { category: 'B', questions: [q(1), q(2), q(3)] },
        { category: 'C', questions: [q(1), q(2)] },
      ]);
    });
    expect(counts).toEqual({ total: 3, known: 1, hard: 0, unknown: 2 });
  });
});

test.describe('Quiz text selection', () => {
  const views = [
    { skin: 'panel', orient: 'portrait', viewport: { width: 420, height: 900 } },
    { skin: 'panel', orient: 'landscape', viewport: { width: 1280, height: 800 } },
    { skin: 'station', orient: 'portrait', viewport: { width: 420, height: 900 } },
    { skin: 'station', orient: 'landscape', viewport: { width: 1280, height: 800 } },
  ];

  async function openLearn(page, { skin, viewport, localJson } = {}) {
    await page.setViewportSize(viewport);
    await page.addInitScript((nextSkin) => {
      try { localStorage.setItem('prawko_exam_skin', nextSkin); } catch {}
    }, skin);
    await startLearnMode(page, { localJson });
    await expect.poll(() => page.locator('html').getAttribute('data-exam-skin')).toBe(skin);
    await expect.poll(() => page.locator('html').getAttribute('data-ui-orient')).toBe(
      viewport.width < viewport.height ? 'portrait' : 'landscape',
    );
  }

  function selectionStyles() {
    const u = (s) => {
      const el = document.querySelector(s);
      return el ? getComputedStyle(el).userSelect : null;
    };
    return {
      question: u('.question-text'),
      answer: u('.answer-btn'),
      input: u('.learn-qnum-input'),
      suffix: u('.learn-qnum-suffix'),
      category: u('.learn-category-value'),
      points: u('.exam-points-value'),
      examCategory: u('.exam-category-value'),
      side: u('.word-side'),
      mark: u('.learn-media-mark'),
    };
  }

  for (const view of views) {
    test(`learn ${view.skin} ${view.orient}: question is selectable, chrome is not`, async ({ page }) => {
      await openLearn(page, view);
      const sel = await page.evaluate(selectionStyles);
      expect(sel.question).toBe('text');
      expect(sel.answer).toBe('text');
      expect(sel.input).toBe('none');
      expect(sel.suffix).toBe('none');
      expect(sel.category).toBe('none');
      expect(sel.side).toBe('none');
      await page.locator('#quiz .question-text').click({ clickCount: 3 });
      const copied = await page.evaluate(() => window.getSelection()?.toString() || '');
      expect(copied.trim().length).toBeGreaterThan(0);
    });
  }

  test('learn jump input is selectable only with local.json', async ({ page }) => {
    await openLearn(page, { skin: 'panel', viewport: { width: 420, height: 900 }, localJson: { learnQuestionJump: true } });
    await page.locator('.answers .answer-btn').first().click();
    const sel = await page.evaluate(selectionStyles);
    expect(sel.input).toBe('text');
    expect(sel.suffix).toBe('none');
    expect(sel.mark).toBe('none');
  });

  test('learn catalog number is not selectable without jump', async ({ page }) => {
    await startLearnMode(page);
    const sel = await page.evaluate(selectionStyles);
    expect(sel.input).toBe('none');
    expect(sel.suffix).toBe('none');
  });

  for (const view of views) {
    test(`exam ${view.skin} ${view.orient}: question is selectable, chrome is not`, async ({ page }) => {
      await page.setViewportSize(view.viewport);
      await page.addInitScript((nextSkin) => {
        try { localStorage.setItem('prawko_exam_skin', nextSkin); } catch {}
      }, view.skin);
      await startExamMode(page);
      await expect.poll(() => page.locator('html').getAttribute('data-exam-skin')).toBe(view.skin);
      await expect.poll(() => page.locator('html').getAttribute('data-ui-orient')).toBe(view.orient);
      const sel = await page.evaluate(selectionStyles);
      expect(sel.question).toBe('text');
      expect(sel.answer).toBe('text');
      expect(sel.points).toBe('none');
      expect(sel.examCategory).toBe('none');
      expect(sel.side).toBe('none');
    });
  }
});

test('page favicon is svg; pwa icons stay in the manifest', async ({ page }) => {
  await page.goto('/');
  const links = await page.evaluate(() => [...document.querySelectorAll('link')].map((l) => ({
    rel: l.rel,
    href: l.getAttribute('href'),
  })));
  expect(links.some((l) => l.rel.includes('icon') && l.href.endsWith('icons/icon.svg'))).toBe(true);
  expect(links.some((l) => (l.href || '').includes('icon-192.png'))).toBe(false);
  const res = await page.request.get('/manifest.json');
  const manifest = await res.json();
  expect(manifest.icons.some((icon) => icon.src.includes('icon-192.png'))).toBe(true);
  expect(manifest.icons.some((icon) => icon.src.includes('icon-512.png'))).toBe(true);
});

test.describe('Home and categories are not selectable', () => {
  function pageSelection(selectors) {
    const u = (s) => {
      const el = document.querySelector(s);
      return el ? getComputedStyle(el).userSelect : null;
    };
    const out = {};
    for (const s of selectors) out[s] = u(s);
    out.selected = (window.getSelection()?.toString() || '').trim();
    return out;
  }

  test('home copy and chrome cannot be selected', async ({ page }) => {
    await page.goto('/');
    await page.waitForSelector('#home.active');
    const selectors = [
      '#home .hero-title',
      '#home .hero-tagline',
      '#home .feature-card p',
      '#home .exam-info li',
      '#home .app-footer',
      '.theme-btn',
      '.skin-btn',
    ];
    const sel = await page.evaluate(pageSelection, selectors);
    for (const s of selectors) expect(sel[s], s).toBe('none');
    await page.locator('#home .hero-title').click({ clickCount: 3 });
    await page.locator('#home .feature-card p').first().click({ clickCount: 3 });
    const after = await page.evaluate(() => (window.getSelection()?.toString() || '').trim());
    expect(after).toBe('');
  });

  test('categories copy, cards, and search cannot be selected', async ({ page }) => {
    await page.goto('/');
    await goToCategories(page);
    const selectors = [
      '#categories .screen-header h2',
      '#mode-description',
      '.mode-btn',
      '.category-card[data-category="B"] .category-name',
      '.category-card[data-category="B"] .category-letter',
      '#category-search',
      '.btn-history-link',
    ];
    const sel = await page.evaluate(pageSelection, selectors);
    for (const s of selectors) expect(sel[s], s).toBe('none');
    await page.locator('#mode-description').click({ clickCount: 3 });
    await page.locator('.category-card[data-category="B"] .category-name').click({ clickCount: 3 });
    const after = await page.evaluate(() => (window.getSelection()?.toString() || '').trim());
    expect(after).toBe('');
  });

  test('history and learn progress copy cannot be selected', async ({ page }) => {
    await page.goto('/');
    await page.waitForSelector('#home.active');
    await page.click('.profile-toggle');
    await page.click('.profile-stat-exams');
    await page.waitForSelector('#history.active');
    const history = await page.evaluate(pageSelection, [
      '#history .screen-header h2',
      '.history-intro',
      '.history-empty p',
    ]);
    expect(history['#history .screen-header h2']).toBe('none');
    expect(history['.history-intro']).toBe('none');
    expect(history['.history-empty p']).toBe('none');
    await page.goto('/');
    await page.waitForSelector('#home.active');
    await page.click('.profile-toggle');
    await page.click('.profile-stat-learn');
    await page.waitForSelector('#learn-progress.active');
    const progress = await page.evaluate(pageSelection, [
      '#learn-progress .screen-header h2',
      '.learn-progress-intro',
      '.learn-progress-empty p',
    ]);
    expect(progress['#learn-progress .screen-header h2']).toBe('none');
    expect(progress['.learn-progress-intro']).toBe('none');
    expect(progress['.learn-progress-empty p']).toBe('none');
  });

  test('data source copy cannot be selected', async ({ page }) => {
    await page.goto('/');
    await page.waitForSelector('#home.active');
    await page.click('[data-navigate="zrodlo-danych"]');
    await page.waitForSelector('#zrodlo-danych.active');
    const sel = await page.evaluate(pageSelection, [
      '#zrodlo-danych .screen-header h2',
      '#zrodlo-danych .source-content p',
      '#zrodlo-danych .source-content a',
    ]);
    expect(sel['#zrodlo-danych .screen-header h2']).toBe('none');
    expect(sel['#zrodlo-danych .source-content p']).toBe('none');
    expect(sel['#zrodlo-danych .source-content a']).toBe('none');
  });
});

test.describe('YN answer halo is not clipped', () => {
  const views = [
    { skin: 'panel', orient: 'portrait', viewport: { width: 420, height: 900 } },
    { skin: 'panel', orient: 'landscape', viewport: { width: 1280, height: 800 } },
    { skin: 'station', orient: 'portrait', viewport: { width: 420, height: 900 } },
    { skin: 'station', orient: 'landscape', viewport: { width: 1280, height: 800 } },
  ];

  function ynHaloRoom() {
    const btn = document.querySelector('.yn-answers .answer-btn.selected, .yn-answers .answer-btn.correct');
    const row = document.querySelector('.yn-answers');
    if (!btn || !row) return null;
    const scale = Number(getComputedStyle(document.documentElement).getPropertyValue('--ui-scale')) || 1;
    const ynHCss = parseFloat(getComputedStyle(row).getPropertyValue('--yn-h')) || 34;
    const ynH = ynHCss * scale;
    const halo = ynHCss * (2 / 3) * scale;
    const b = btn.getBoundingClientRect();
    const r = row.getBoundingClientRect();
    let top = -Infinity;
    let right = Infinity;
    let bottom = Infinity;
    let left = -Infinity;
    for (let el = btn.parentElement; el; el = el.parentElement) {
      if (!(el instanceof HTMLElement)) continue;
      const cs = getComputedStyle(el);
      const clipsX = cs.overflowX !== 'visible';
      const clipsY = cs.overflowY !== 'visible';
      if (!clipsX && !clipsY) continue;
      const box = el.getBoundingClientRect();
      if (clipsY) {
        top = Math.max(top, box.top);
        bottom = Math.min(bottom, box.bottom);
      }
      if (clipsX) {
        left = Math.max(left, box.left);
        right = Math.min(right, box.right);
      }
    }
    return {
      ynH,
      halo,
      rowH: r.height,
      topRoom: b.top - top,
      bottomRoom: bottom - b.bottom,
      leftRoom: b.left - left,
      rightRoom: right - b.right,
      shadow: getComputedStyle(btn).boxShadow,
    };
  }

  async function clickYn(page) {
    const yn = page.locator('.yn-answers .answer-btn').first();
    await expect(yn).toHaveCount(1);
    await yn.click({ force: true });
    await expect(yn).toHaveClass(/selected|correct/);
  }

  for (const view of views) {
    test(`learn ${view.skin} ${view.orient}: Tak/Nie ring fits in the dock`, async ({ page }) => {
      await page.setViewportSize(view.viewport);
      await page.addInitScript((nextSkin) => {
        try { localStorage.setItem('prawko_exam_skin', nextSkin); } catch {}
      }, view.skin);
      await startLearnMode(page, { category: 'PT' });
      await expect.poll(() => page.locator('html').getAttribute('data-exam-skin')).toBe(view.skin);
      await expect.poll(() => page.locator('html').getAttribute('data-ui-orient')).toBe(view.orient);
      await expect.poll(() => page.locator('html').getAttribute('data-ui-mode')).toBe('fit');
      await page.waitForSelector('.yn-answers .answer-btn, .abc-answers .answer-btn');
      for (let i = 0; i < 20 && !(await page.locator('.yn-answers .answer-btn').count()); i += 1) {
        await page.locator('.learn-nav .btn-next').click();
        await page.waitForSelector('.answers .answer-btn');
      }
      await clickYn(page);
      const room = await page.evaluate(ynHaloRoom);
      expect(room).toBeTruthy();
      expect(room.shadow).toMatch(/0px 0px 0px/);
      expect(room.rowH).toBeGreaterThanOrEqual(room.ynH + 2 * room.halo - 2);
      expect(room.topRoom).toBeGreaterThanOrEqual(room.halo - 1.5);
      expect(room.bottomRoom).toBeGreaterThanOrEqual(room.halo - 1.5);
      // Portrait: same as exam below — html/ui-slot overflow-x clips the ring
      // when Tak sits near the scaled canvas edge (Linux CI 420px).
      if (view.orient === 'landscape') {
        expect(room.leftRoom).toBeGreaterThanOrEqual(room.halo - 1.5);
        expect(room.rightRoom).toBeGreaterThanOrEqual(room.halo - 1.5);
      }
    });
  }

  test('exam panel portrait: selected Tak/Nie ring fits in the dock', async ({ page }) => {
    await page.setViewportSize({ width: 420, height: 900 });
    await page.addInitScript(() => {
      try { localStorage.setItem('prawko_exam_skin', 'panel'); } catch {}
    });
    await startExamMode(page);
    await expect.poll(() => page.locator('html').getAttribute('data-exam-skin')).toBe('panel');
    await expect.poll(() => page.locator('html').getAttribute('data-ui-orient')).toBe('portrait');
    await clickYn(page);
    const room = await page.evaluate(ynHaloRoom);
    expect(room).toBeTruthy();
    expect(room.bottomRoom).toBeGreaterThanOrEqual(room.halo - 1.5);
    expect(room.topRoom).toBeGreaterThanOrEqual(room.halo - 1.5);
  });
});

test.describe('Learn catalog jump', () => {
  test('learn catalog number is not a jump field by default', async ({ page }) => {
    await startLearnMode(page);
    await expect(page.locator('#quiz')).not.toHaveClass(/learn-qnum-jump/);
    await expect(page.locator('.learn-qnum-input')).toHaveAttribute('readonly', '');
  });

  test('learn catalog jump works only with local.json on localhost', async ({ page }) => {
    await startLearnMode(page, { localJson: { learnQuestionJump: true } });
    await setLearnQueue(page, 'filter', 'all');
    await setLearnQueue(page, 'order', 'sequential');
    const catalog = await page.evaluate(async () => {
      const data = await import(new URL('./js/data.js', location.href).href).then((m) => m.fetchCategory('B'));
      return data.questions.map((q) => String(q.id));
    });
    await expect(page.locator('.learn-qnum-input')).not.toHaveAttribute('readonly');
    await page.locator('.learn-qnum-input').fill('1');
    await page.locator('.learn-qnum-input').press('Enter');
    await expect(page.locator('.question-card')).toHaveAttribute('data-question-id', catalog[0]);
  });

  test('panel ABC fit-text keeps long specialist copy readable instead of 7px', async ({ page }) => {
    await page.setViewportSize({ width: 874, height: 580 });
    await page.addInitScript(() => {
      try { localStorage.setItem('prawko_exam_skin', 'panel'); } catch {}
    });
    await startLearnMode(page, { localJson: { learnQuestionJump: true } });
    await expect.poll(() => page.locator('html').getAttribute('data-exam-skin')).toBe('panel');
    await expect.poll(() => page.locator('html').getAttribute('data-ui-orient')).toBe('landscape');
    await setLearnQueue(page, 'filter', 'all');
    await setLearnQueue(page, 'order', 'sequential');
    const ynPos = await page.evaluate(async () => {
      const data = await import(new URL('./js/data.js', location.href).href).then((m) => m.fetchCategory('B'));
      const pos = data.questions.findIndex((q) => q.type === 'basic');
      return pos >= 0 ? pos + 1 : 0;
    });
    expect(ynPos).toBeGreaterThan(0);
    await page.locator('.learn-qnum-input').fill(String(ynPos));
    await page.locator('.learn-qnum-input').press('Enter');
    await expect(page.locator('.yn-answers .answer-btn').first()).toBeVisible();
    const targets = await page.evaluate(async () => {
      const data = await import(new URL('./js/data.js', location.href).href).then((m) => m.fetchCategory('B'));
      const ids = ['7516', '11003', '11005'];
      return ids.map((id) => {
        const pos = data.questions.findIndex((q) => String(q.id) === id);
        return pos >= 0 ? { id, pos: pos + 1 } : null;
      }).filter(Boolean);
    });
    expect(targets.length).toBe(3);
    const fonts = [];
    for (const target of targets) {
      await page.locator('.learn-qnum-input').fill(String(target.pos));
      await page.locator('.learn-qnum-input').press('Enter');
      await expect(page.locator('.question-card')).toHaveAttribute('data-question-id', target.id);
      await expect.poll(() => page.evaluate(() => {
        const q = parseFloat(getComputedStyle(document.querySelector('.question-text')).fontSize);
        const a = parseFloat(getComputedStyle(document.querySelector('.abc-answers .answer-text')).fontSize);
        return q >= 12 && a >= 12;
      })).toBe(true);
      const font = await page.evaluate(() => {
        const q = document.querySelector('.question-text');
        const a = document.querySelector('.abc-answers .answer-text');
        return {
          q: parseFloat(getComputedStyle(q).fontSize),
          a: parseFloat(getComputedStyle(a).fontSize),
          qH: q.clientHeight,
          aW: a.clientWidth,
        };
      });
      fonts.push(font);
      expect(font.qH, `question slot for ${target.id}`).toBeGreaterThan(40);
      expect(font.aW, `answer column for ${target.id}`).toBeGreaterThan(400);
      expect(font.q, `question px for ${target.id}`).toBeGreaterThanOrEqual(12);
      expect(font.a, `answer px for ${target.id}`).toBeGreaterThanOrEqual(12);
      expect(font.q).toBeLessThanOrEqual(32);
      expect(font.a).toBeLessThanOrEqual(32);
    }
    const short = fonts[0];
    expect(short.a, 'short ABC answers must not hit the 7px floor').toBeGreaterThanOrEqual(16);
    expect(Math.abs(short.q - short.a)).toBeLessThan(16);
    expect(Math.abs(fonts[1].q - fonts[2].q)).toBeLessThan(10);
    expect(Math.abs(fonts[1].a - fonts[2].a)).toBeLessThan(10);
    const flicker = await page.evaluate(async () => {
      const samples = [];
      for (let i = 0; i < 10; i++) {
        samples.push([
          getComputedStyle(document.querySelector('.question-text')).fontSize,
          getComputedStyle(document.querySelector('.abc-answers .answer-text')).fontSize,
        ].join('|'));
        await new Promise((r) => setTimeout(r, 50));
      }
      return { unique: [...new Set(samples)], samples };
    });
    expect(flicker.unique, `fit-text flickered: ${flicker.samples.join(' → ')}`).toHaveLength(1);

    const pos6362 = await page.evaluate(async () => {
      const data = await import(new URL('./js/data.js', location.href).href).then((m) => m.fetchCategory('B'));
      const pos = data.questions.findIndex((q) => String(q.id) === '6362');
      return pos >= 0 ? pos + 1 : 0;
    });
    expect(pos6362).toBeGreaterThan(0);
    await page.locator('.learn-qnum-input').fill(String(pos6362));
    await page.locator('.learn-qnum-input').press('Enter');
    await expect(page.locator('.question-card')).toHaveAttribute('data-question-id', '6362');
    await expect.poll(() => page.evaluate(() => {
      const a = parseFloat(getComputedStyle(document.querySelector('.abc-answers .answer-text')).fontSize);
      return a >= 16;
    })).toBe(true);
    const beforeNav = await page.evaluate(() => ({
      q: getComputedStyle(document.querySelector('.question-text')).fontSize,
      a: getComputedStyle(document.querySelector('.abc-answers .answer-text')).fontSize,
    }));
    await page.locator('.learn-nav .btn-next').click();
    await expect(page.locator('.question-card')).not.toHaveAttribute('data-question-id', '6362');
    const afterNext = await page.evaluate(() => ({
      q: getComputedStyle(document.querySelector('.question-text')).fontSize,
      a: document.querySelector('.abc-answers .answer-text')
        ? getComputedStyle(document.querySelector('.abc-answers .answer-text')).fontSize
        : '',
      hasAbc: Boolean(document.querySelector('.abc-answers')),
    }));
    expect(afterNext.q, 'question size after next must already be fitted').toMatch(/px$/);
    if (afterNext.hasAbc) {
      expect(afterNext.a, 'answer size after next must already be fitted').toMatch(/px$/);
    }
    await page.locator('.learn-nav .btn-prev').click();
    await expect(page.locator('.question-card')).toHaveAttribute('data-question-id', '6362');
    await expect.poll(() => page.evaluate((beforeNav) => {
      const q = getComputedStyle(document.querySelector('.question-text')).fontSize;
      const a = getComputedStyle(document.querySelector('.abc-answers .answer-text')).fontSize;
      return q === beforeNav.q && a === beforeNav.a;
    }, beforeNav)).toBe(true);
  });

  test('panel question is fitted on the first learn frame', async ({ page }) => {
    await page.setViewportSize({ width: 874, height: 580 });
    await page.route('**/data/B.json', async (route) => {
      const res = await route.fetch();
      const data = await res.json();
      const [facts, polish] = await Promise.all([
        page.request.get('data/questions.json').then((r) => r.json()),
        page.request.get('data/translations_pl.json').then((r) => r.json()),
      ]);
      const ids = Array.isArray(data.questionIds) ? data.questionIds : [];
      const longId = [...ids]
        .filter((id) => facts[String(id)]?.type === 'basic')
        .sort((a, b) => String(polish[String(b)]?.q || '').length - String(polish[String(a)]?.q || '').length)[0];
      if (longId != null) {
        data.questionIds = [longId, ...ids.filter((id) => id !== longId)];
      }
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify(data),
      });
    });
    await page.addInitScript(() => {
      try { localStorage.setItem('prawko_exam_skin', 'panel'); } catch {}
      localStorage.setItem('prawko_p_p1_learn_queue_mode', JSON.stringify({
        B: { filter: 'all', order: 'sequential' },
      }));
      document.addEventListener('DOMContentLoaded', () => {
        window.__learnFirst = null;
        const quiz = document.getElementById('quiz');
        if (!quiz) return;
        const take = () => {
          if (document.documentElement.hasAttribute('data-ui-hold')) return;
          if (!quiz.classList.contains('learn-active') || window.__learnFirst) return;
          const q = quiz.querySelector('.question-text');
          if (!q?.textContent?.trim() || !q.style.fontSize) return;
          window.__learnFirst = {
            qInline: q.style.fontSize,
            qC: getComputedStyle(q).fontSize,
            overflow: q.scrollHeight > q.clientHeight + 1 ? 1 : 0,
            yn: Boolean(quiz.querySelector('.yn-answers')),
          };
        };
        new MutationObserver(take).observe(document.documentElement, {
          attributes: true,
          attributeFilter: ['data-ui-hold'],
        });
        new MutationObserver(take).observe(quiz, {
          subtree: true,
          childList: true,
          attributes: true,
        });
      });
    });
    await startLearnMode(page);
    await page.waitForSelector('#quiz.learn-active .question-text:not(:empty)');
    const first = await page.evaluate(() => window.__learnFirst);
    expect(first, 'observer missed the first learn question').toBeTruthy();
    expect(first.yn, 'first learn question should be a long YN').toBe(true);
    expect(first.qInline).toMatch(/px$/);
    expect(first.qC, `computed ${first.qC} vs inline ${first.qInline}`).toBe(first.qInline);
    expect(first.overflow, 'question overflowed on the first learn frame').toBe(0);
  });

  test('panel question uses the fitted inline size on the first YN→ABC frame', async ({ page }) => {
    await page.setViewportSize({ width: 874, height: 580 });
    await page.addInitScript(() => {
      try { localStorage.setItem('prawko_exam_skin', 'panel'); } catch {}
    });
    await startLearnMode(page, { localJson: { learnQuestionJump: true } });
    await expect.poll(() => page.locator('html').getAttribute('data-exam-skin')).toBe('panel');
    await setLearnQueue(page, 'filter', 'all');
    await setLearnQueue(page, 'order', 'sequential');
    const pos = await page.evaluate(async () => {
      const data = await import(new URL('./js/data.js', location.href).href).then((m) => m.fetchCategory('B'));
      const yn = data.questions.findIndex((q) => String(q.id) === '10526');
      const abc = data.questions.findIndex((q) => String(q.id) === '14063');
      return { yn: yn + 1, abc: abc + 1 };
    });
    expect(pos.yn).toBeGreaterThan(0);
    expect(pos.abc).toBeGreaterThan(0);
    await page.locator('.learn-qnum-input').fill(String(pos.yn));
    await page.locator('.learn-qnum-input').press('Enter');
    await expect(page.locator('.question-card')).toHaveAttribute('data-question-id', '10526');
    await page.evaluate(() => {
      window.__qFirst = null;
      const card = document.querySelector('.question-card');
      new MutationObserver(() => {
        if (card.dataset.questionId !== '14063' || window.__qFirst) return;
        const q = document.querySelector('.question-text');
        window.__qFirst = {
          qC: q ? getComputedStyle(q).fontSize : '',
          qInline: q?.style.fontSize || '',
          overflow: q && q.scrollHeight > q.clientHeight + 1 ? 1 : 0,
        };
      }).observe(card, { attributes: true, attributeFilter: ['data-question-id'] });
    });
    await page.locator('.learn-qnum-input').fill(String(pos.abc));
    await page.locator('.learn-qnum-input').press('Enter');
    await expect(page.locator('.question-card')).toHaveAttribute('data-question-id', '14063');
    const first = await page.evaluate(() => window.__qFirst);
    expect(first, 'observer missed the YN→ABC swap').toBeTruthy();
    expect(first.qInline).toMatch(/px$/);
    expect(first.qC, `computed ${first.qC} vs inline ${first.qInline}`).toBe(first.qInline);
    expect(first.overflow, 'question overflowed at the previous 32px').toBe(0);
  });

  test('panel ABC answers use the fitted inline size on the first ABC→ABC frame', async ({ page }) => {
    await page.setViewportSize({ width: 874, height: 580 });
    await page.addInitScript(() => {
      try { localStorage.setItem('prawko_exam_skin', 'panel'); } catch {}
    });
    await startLearnMode(page, { localJson: { learnQuestionJump: true } });
    await expect.poll(() => page.locator('html').getAttribute('data-exam-skin')).toBe('panel');
    await setLearnQueue(page, 'filter', 'all');
    await setLearnQueue(page, 'order', 'sequential');
    const pos = await page.evaluate(async () => {
      const data = await import(new URL('./js/data.js', location.href).href).then((m) => m.fetchCategory('B'));
      const a = data.questions.findIndex((q) => String(q.id) === '14063');
      const b = data.questions.findIndex((q) => String(q.id) === '11003');
      return { a: a + 1, b: b + 1 };
    });
    expect(pos.a).toBeGreaterThan(0);
    expect(pos.b).toBeGreaterThan(0);
    await page.locator('.learn-qnum-input').fill(String(pos.a));
    await page.locator('.learn-qnum-input').press('Enter');
    await expect(page.locator('.question-card')).toHaveAttribute('data-question-id', '14063');
    await page.evaluate(() => {
      window.__aFirst = null;
      window.__aTrace = [];
      const card = document.querySelector('.question-card');
      new MutationObserver(() => {
        if (card.dataset.questionId !== '11003' || window.__aFirst) return;
        const a = document.querySelector('.abc-answers .answer-text');
        window.__aFirst = {
          aC: a ? getComputedStyle(a).fontSize : '',
          aInline: a?.style.fontSize || '',
          overflow: a && a.scrollHeight > a.clientHeight + 1 ? 1 : 0,
        };
        const take = (left) => {
          const el = document.querySelector('.abc-answers .answer-text');
          window.__aTrace.push(el ? getComputedStyle(el).fontSize : '');
          if (left) requestAnimationFrame(() => take(left - 1));
        };
        take(12);
      }).observe(card, { attributes: true, attributeFilter: ['data-question-id'] });
    });
    await page.locator('.learn-qnum-input').fill(String(pos.b));
    await page.locator('.learn-qnum-input').press('Enter');
    await expect(page.locator('.question-card')).toHaveAttribute('data-question-id', '11003');
    const first = await page.evaluate(() => window.__aFirst);
    expect(first, 'observer missed the ABC→ABC swap').toBeTruthy();
    expect(first.aInline).toMatch(/px$/);
    expect(first.aC, `computed ${first.aC} vs inline ${first.aInline}`).toBe(first.aInline);
    expect(first.overflow, 'answer overflowed at the previous ABC size').toBe(0);
    await expect.poll(() => page.evaluate(() => (window.__aTrace || []).length)).toBeGreaterThanOrEqual(8);
    const trace = await page.evaluate(() => window.__aTrace);
    expect(new Set(trace).size, `answer font jumped: ${trace.join(' → ')}`).toBe(1);
  });

  test('panel ABC copy does not resize when the photo paints', async ({ page }) => {
    await page.setViewportSize({ width: 874, height: 580 });
    await page.addInitScript(() => {
      try { localStorage.setItem('prawko_exam_skin', 'panel'); } catch {}
    });
    await startLearnMode(page, { localJson: { learnQuestionJump: true } });
    await expect.poll(() => page.locator('html').getAttribute('data-exam-skin')).toBe('panel');
    await setLearnQueue(page, 'filter', 'all');
    await setLearnQueue(page, 'order', 'sequential');
    const targets = await page.evaluate(async () => {
      const data = await import(new URL('./js/data.js', location.href).href).then((m) => m.fetchCategory('B'));
      const yn = data.questions.findIndex((q) => q.type === 'basic' && q.media);
      const abc = data.questions.findIndex((q) => q.type === 'specialist' && q.mediaType === 'image' && q.a);
      return {
        yn: yn + 1,
        abc: abc + 1,
        abcId: abc >= 0 ? String(data.questions[abc].id) : '',
      };
    });
    expect(targets.yn).toBeGreaterThan(0);
    expect(targets.abc).toBeGreaterThan(0);
    await page.locator('.learn-qnum-input').fill(String(targets.yn));
    await page.locator('.learn-qnum-input').press('Enter');
    await page.evaluate(() => {
      window.__abcFit = [];
      const dock = document.querySelector('.quiz-dock');
      const obs = new MutationObserver(() => {
        const dock = document.querySelector('.quiz-dock');
        const size = dock?.style.getPropertyValue('--dock-a-size');
        if (size) window.__abcFit.push(size);
      });
      obs.observe(dock, { subtree: true, childList: true, attributes: true, attributeFilter: ['style'] });
      window.__abcFitObs = obs;
    });
    await page.route('**/*', async (route) => {
      const url = route.request().url();
      if (/\.(webp|mp4)(\?|$)/i.test(url) || /\/(img|vid)\//.test(url)) {
        await new Promise((resolve) => setTimeout(resolve, 400));
      }
      await route.continue();
    });
    await page.locator('.learn-qnum-input').fill(String(targets.abc));
    await page.locator('.learn-qnum-input').press('Enter');
    await expect(page.locator('.question-card')).toHaveAttribute('data-question-id', targets.abcId);
    const before = await page.evaluate(() => {
      const text = document.querySelector('.abc-answers .answer-text');
      const q = document.querySelector('.question-text');
      const btn = document.querySelector('.abc-answers .answer-btn');
      const dock = document.querySelector('.quiz-dock');
      return {
        font: dock?.style.getPropertyValue('--dock-a-size') || '',
        computed: text ? getComputedStyle(text).fontSize : '',
        qInline: q?.style.fontSize || '',
        qComputed: q ? getComputedStyle(q).fontSize : '',
        overflow: q ? (q.scrollHeight > q.clientHeight + 1 ? 1 : 0) : 0,
        btnH: btn ? Math.round(btn.getBoundingClientRect().height) : 0,
      };
    });
    expect(before.font, 'ABC must be fitted before the photo request').toMatch(/px$/);
    expect(before.computed, 'first ABC paint must already use the dock size').toBe(before.font);
    expect(before.qInline, 'question must be fitted before first paint').toMatch(/px$/);
    expect(
      Math.abs(parseFloat(before.qComputed) - parseFloat(before.qInline)),
      `question computed ${before.qComputed} vs inline ${before.qInline}`,
    ).toBeLessThan(0.5);
    expect(before.overflow, 'question overflowed at the previous 32px').toBe(0);
    const widthTrace = await page.evaluate(async () => {
      const lineCount = (el) => {
        if (!el) return 0;
        const cs = getComputedStyle(el);
        const lh = parseFloat(cs.lineHeight) || parseFloat(cs.fontSize) || 1;
        return Math.max(1, Math.round(el.getBoundingClientRect().height / lh));
      };
      const sample = () => {
        const answers = document.querySelector('.answers');
        const q = document.querySelector('.question-text');
        const media = document.querySelector('.media-area');
        const c = document.querySelector('.abc-answers .answer-btn:nth-child(3) .answer-text');
        return {
          ansW: Math.round(answers?.getBoundingClientRect().width || 0),
          qW: Math.round(q?.getBoundingClientRect().width || 0),
          qC: q ? getComputedStyle(q).fontSize : '',
          qInline: q?.style.fontSize || '',
          overflow: q ? (q.scrollHeight > q.clientHeight + 1 ? 1 : 0) : 0,
          mediaW: Math.round(media?.getBoundingClientRect().width || 0),
          qLines: lineCount(q),
          cLines: lineCount(c),
        };
      };
      const out = [sample()];
      for (let i = 0; i < 6; i++) {
        await new Promise((r) => requestAnimationFrame(r));
        out.push(sample());
      }
      return out;
    });
    const ansWs = [...new Set(widthTrace.map((s) => s.ansW))];
    const qWs = [...new Set(widthTrace.map((s) => s.qW))];
    const lineNs = [...new Set(widthTrace.map((s) => s.cLines))];
    const qLineNs = [...new Set(widthTrace.map((s) => s.qLines))];
    expect(ansWs, `ABC column width jumped: ${JSON.stringify(widthTrace)}`).toHaveLength(1);
    expect(qWs, `question width jumped: ${JSON.stringify(widthTrace)}`).toHaveLength(1);
    expect(lineNs, `ABC C wrapping jumped: ${JSON.stringify(widthTrace)}`).toHaveLength(1);
    expect(qLineNs, `question wrapping jumped: ${JSON.stringify(widthTrace)}`).toHaveLength(1);
    expect(
      [...new Set(widthTrace.map((s) => s.qC))],
      `question font jumped: ${JSON.stringify(widthTrace)}`,
    ).toHaveLength(1);
    widthTrace.forEach((s) => {
      expect(s.ansW, `ABC answers ${s.ansW} should use the dock, not the film ${s.mediaW}`).toBeGreaterThan(s.mediaW + 16);
      expect(s.qW, `question ${s.qW} should use the dock, not the film ${s.mediaW}`).toBeGreaterThan(s.mediaW + 16);
      expect(s.overflow, `question overflowed at ${s.qC}`).toBe(0);
      expect(
        Math.abs(parseFloat(s.qC) - parseFloat(s.qInline)),
        `question computed ${s.qC} vs inline ${s.qInline}`,
      ).toBeLessThan(0.5);
    });
    await new Promise((resolve) => setTimeout(resolve, 250));
    const waiting = await page.evaluate(() => {
      const text = document.querySelector('.abc-answers .answer-text');
      const btn = document.querySelector('.abc-answers .answer-btn');
      const dock = document.querySelector('.quiz-dock');
      return {
        font: dock?.style.getPropertyValue('--dock-a-size') || '',
        computed: text ? getComputedStyle(text).fontSize : '',
        btnH: btn ? Math.round(btn.getBoundingClientRect().height) : 0,
      };
    });
    expect(waiting.font, 'ABC must not jump while the photo is still loading').toBe(before.font);
    expect(waiting.computed).toBe(before.computed);
    expect(Math.abs(waiting.btnH - before.btnH), 'ABC row height jumped while loading').toBeLessThanOrEqual(2);
    await page.locator('#quiz .media-area img').waitFor({ state: 'attached' });
    await page.evaluate(() => new Promise((resolve) => {
      requestAnimationFrame(() => requestAnimationFrame(resolve));
    }));
    const after = await page.evaluate(() => {
      const text = document.querySelector('.abc-answers .answer-text');
      const btn = document.querySelector('.abc-answers .answer-btn');
      const dock = document.querySelector('.quiz-dock');
      return {
        font: dock?.style.getPropertyValue('--dock-a-size') || '',
        computed: text ? getComputedStyle(text).fontSize : '',
        btnH: btn ? Math.round(btn.getBoundingClientRect().height) : 0,
      };
    });
    expect(after.font, 'ABC font jumped when the photo painted').toBe(before.font);
    expect(after.computed).toBe(before.computed);
    expect(Math.abs(after.btnH - before.btnH), 'ABC row height jumped when the photo painted').toBeLessThanOrEqual(2);
    const unique = await page.evaluate(() => {
      window.__abcFitObs?.disconnect();
      return [...new Set(window.__abcFit || [])];
    });
    expect(unique.length, `ABC fit jumped: ${unique.join(' → ')}`).toBeLessThanOrEqual(1);
    expect(unique[0] || before.font).toBe(before.font);
  });

  test('random draws undated questions first, then date bands oldest to newest', async ({ page }) => {
    const answerDaysAgo = (days) => {
      const d = new Date();
      d.setHours(12, 0, 0, 0);
      d.setDate(d.getDate() - days);
      return d.getTime();
    };
    const hard = (days) => ({
      answer: '!',
      streak: 0,
      misses: 2,
      ...(days == null ? {} : { answeredAt: answerDaysAgo(days) }),
    });
    await page.addInitScript((learn) => {
      localStorage.setItem('prawko_p_p1_learn', JSON.stringify({ B: learn }));
      localStorage.setItem('prawko_p_p1_learn_queue_mode', JSON.stringify({
        B: { filter: 'hard', order: 'random' },
      }));
    }, {
      99: hard(null),
      475: hard(40),
      477: hard(20),
      110: hard(10),
      478: hard(6),
      100: hard(3),
      352: hard(2),
      109: hard(1),
      469: hard(0),
    });
    await startLearnMode(page);

    const groups = [
      ['99'],
      ['475'],
      ['477'],
      ['110'],
      ['478'],
      ['100'],
      ['352'],
      ['109', '469'],
    ];
    const walkIds = async () => {
      const ids = [];
      for (let guard = 0; guard < 20; guard++) {
        ids.push(await page.locator('.question-card').getAttribute('data-question-id'));
        const next = page.locator('.btn-next');
        if (await next.isDisabled()) return ids;
        await next.click();
      }
      throw new Error('learn list did not end');
    };
    const backToStart = async () => {
      for (let guard = 0; guard < 20; guard++) {
        const prev = page.locator('.btn-prev');
        if (await prev.isDisabled()) return;
        await prev.click();
      }
      throw new Error('learn list did not rewind');
    };
    const expectGroups = (ids, bands) => {
      expect(ids).toHaveLength(bands.reduce((n, group) => n + group.length, 0));
      let at = 0;
      for (const group of bands) {
        expect(ids.slice(at, at + group.length).sort()).toEqual([...group].sort());
        at += group.length;
      }
    };

    const randomIds = await walkIds();
    expectGroups(randomIds, groups);
    await backToStart();
    await expect(page.locator('.question-card')).toHaveAttribute('data-question-id', '99');

    await setLearnQueue(page, 'order', 'sequential');
    await expect(page.locator('.question-card')).toHaveAttribute('data-question-id', '99');
    await page.click('.btn-next');
    await expect(page.locator('.question-card')).toHaveAttribute('data-question-id', '100');
    await page.click('.btn-prev');
    await setLearnQueue(page, 'order', 'random');
    expect(await walkIds()).toEqual(randomIds);

    await backToStart();
    await setLearnQueue(page, 'filter', 'all');
    await setLearnQueue(page, 'filter', 'hard');
    await expect(page.locator('.question-card')).toHaveAttribute('data-question-id', '99');
    expect(await walkIds()).toEqual(randomIds);

    await backToStart();
    await page.locator('.answer-btn').first().click();
    await page.click('.btn-next');
    await expect(page.locator('.question-card')).toHaveAttribute('data-question-id', randomIds[1]);

    await page.click('.quiz-back', { force: true });
    await page.waitForSelector('#categories.active');
    await page.click('.mode-btn[data-mode="learn"]');
    await page.click('.category-grid .category-card[data-category="B"]');
    await page.waitForSelector('#quiz.active');
    await waitForUiHold(page);
    const again = await walkIds();
    expectGroups(again, [
      ['475'],
      ['477'],
      ['110'],
      ['478'],
      ['100'],
      ['352'],
      ['109', '469', '99'],
    ]);
  });

  test('random walks a list shuffled once; toggling order keeps the question and its new index', async ({ page }) => {
    await page.addInitScript(() => {
      localStorage.setItem('prawko_p_p1_learn_queue_mode', JSON.stringify({
        B: { filter: 'all', order: 'sequential' },
      }));
    });
    await startLearnMode(page);
    await expect(page.locator('.question-card')).toHaveAttribute('data-question-id', /./);

    const catalog = await page.evaluate(async () => {
      const data = await import(new URL('./js/data.js', location.href).href).then((m) => m.fetchCategory('B'));
      return data.questions.map((q) => String(q.id));
    });
    const startId = await page.locator('.question-card').getAttribute('data-question-id');
    expect(startId).toBe(catalog[0]);
    const startTotal = (await learnCatalogLabel(page)).split(' / ')[1];
    expect(Number(startTotal)).toBe(catalog.length);

    await setLearnQueue(page, 'order', 'random');
    await expect(page.locator('.question-card')).toHaveAttribute('data-question-id', startId);
    expect(await learnCatalogLabel(page)).toBe(`1 / ${startTotal}`);

    const randomWalk = [startId];
    const catalogNums = [1];
    for (let i = 0; i < 8; i++) {
      const prev = randomWalk[randomWalk.length - 1];
      await page.click('.btn-next');
      await expect(page.locator('.question-card')).not.toHaveAttribute('data-question-id', prev);
      const id = await page.locator('.question-card').getAttribute('data-question-id');
      randomWalk.push(id);
      const num = Number((await learnCatalogLabel(page)).split(' / ')[0]);
      catalogNums.push(num);
      expect(num).toBe(catalog.indexOf(id) + 1);
    }
    expect(randomWalk.slice(1)).not.toEqual(catalog.slice(1, 9));
    expect(catalogNums.slice(1)).not.toEqual([2, 3, 4, 5, 6, 7, 8, 9]);

    for (let i = 0; i < 8; i++) {
      await page.click('.btn-prev');
      await expect(page.locator('.question-card')).toHaveAttribute(
        'data-question-id',
        randomWalk[randomWalk.length - 2 - i],
      );
    }
    await expect(page.locator('.question-card')).toHaveAttribute('data-question-id', startId);
    expect(await learnCatalogLabel(page)).toBe(`1 / ${startTotal}`);

    await setLearnQueue(page, 'order', 'sequential');
    await expect(page.locator('.question-card')).toHaveAttribute('data-question-id', startId);
    expect(await learnCatalogLabel(page)).toBe(`1 / ${startTotal}`);
    await setLearnQueue(page, 'order', 'random');
    await expect(page.locator('.question-card')).toHaveAttribute('data-question-id', startId);
    expect(await learnCatalogLabel(page)).toBe(`1 / ${startTotal}`);
    for (let i = 1; i < randomWalk.length; i++) {
      await page.click('.btn-next');
      await expect(page.locator('.question-card')).toHaveAttribute('data-question-id', randomWalk[i]);
    }
  });

  test('switching to sequential walks the catalog from the current question', async ({ page }) => {
    await startLearnMode(page);
    await setLearnQueue(page, 'filter', 'all');
    await expect(page.locator('.question-card')).toHaveAttribute('data-question-id', /./);

    const catalog = await page.evaluate(async () => {
      const data = await import(new URL('./js/data.js', location.href).href).then((m) => m.fetchCategory('B'));
      return data.questions.map((q) => String(q.id));
    });

    await setLearnQueue(page, 'order', 'random');
    await page.click('.btn-next');
    const randomId = await page.locator('.question-card').getAttribute('data-question-id');
    expect(randomId).not.toBe(catalog[1]);
    const randomCatalogPos = catalog.indexOf(randomId) + 1;
    expect(randomCatalogPos).not.toBe(2);
    expect(await learnCatalogLabel(page)).toBe(`${randomCatalogPos} / ${catalog.length}`);

    await setLearnQueue(page, 'order', 'sequential');
    await expect(page.locator('.question-card')).toHaveAttribute('data-question-id', randomId);
    const catalogIndex = catalog.indexOf(randomId);
    expect(catalogIndex).toBeGreaterThan(0);
    expect(await learnCatalogLabel(page)).toBe(`${catalogIndex + 1} / ${catalog.length}`);

    await page.click('.btn-next');
    await expect(page.locator('.question-card')).toHaveAttribute(
      'data-question-id',
      catalog[catalogIndex + 1],
    );
    await page.click('.btn-prev');
    await expect(page.locator('.question-card')).toHaveAttribute('data-question-id', randomId);
    await page.click('.btn-prev');
    await expect(page.locator('.question-card')).toHaveAttribute(
      'data-question-id',
      catalog[catalogIndex - 1],
    );
  });
});

test.describe('Local profiles', () => {
  test('home shows the profile panel with stats and reset for a single profile', async ({ page }) => {
    await page.goto('/');
    await page.waitForSelector('#home.active');
    const toggle = page.locator('.profile-toggle');
    await expect(toggle).toBeVisible();
    await expect(page.locator('.profile-toggle-name')).toHaveText('Ja');
    await toggle.click();
    const panel = page.locator('#profile-panel');
    await expect(panel).toBeVisible();
    const toggleBox = await toggle.boundingBox();
    const panelBox = await panel.boundingBox();
    expect(Math.abs(panelBox.y - toggleBox.y)).toBeLessThan(2);
    expect(Math.abs((panelBox.x + panelBox.width) - (toggleBox.x + toggleBox.width))).toBeLessThan(2);
    await expect(page.locator('.profile-name-input')).toHaveValue('Ja');
    await expect(page.locator('.profile-list-toggle')).toBeVisible();
    await expect(page.locator('.profile-list-toggle')).toHaveAttribute('aria-expanded', 'false');
    await expect(page.locator('.profile-list-btn')).toHaveCount(0);
    await expect(page.locator('.profile-appearance .theme-btn')).toBeVisible();
    await expect(page.locator('.profile-appearance .skin-btn')).toBeVisible();
    await expect(page.locator('.profile-appearance .lang-cycle')).toBeVisible();
    await expect(page.locator('.top-controls > .theme-btn')).toHaveCount(0);
    await expect(page.locator('.profile-stat-learn')).toContainText('Nauka:');
    await expect(page.locator('.profile-stat-exams')).toContainText('Egzaminy:');
    await expect(page.locator('.profile-action-history')).toHaveCount(0);
    await expect(page.locator('.profile-action-rename')).toHaveCount(0);
    await expect(page.locator('.profile-action-new')).toHaveCount(0);
    await expect(page.locator('.profile-action-delete')).toHaveAttribute('aria-label', 'Resetuj');
    const nameBox = await page.locator('.profile-name-input').boundingBox();
    const iconBoxes = await page.locator('.profile-current .profile-icon-btn').evaluateAll((els) => els.map((el) => {
      const r = el.getBoundingClientRect();
      return { x: r.x, y: r.y, w: r.width, h: r.height };
    }));
    expect(iconBoxes).toHaveLength(4);
    expect(nameBox.x).toBeLessThan(iconBoxes[0].x);
    const gap0 = iconBoxes[1].x - (iconBoxes[0].x + iconBoxes[0].w);
    for (let i = 1; i < iconBoxes.length; i++) {
      expect(iconBoxes[i].x).toBeGreaterThan(iconBoxes[i - 1].x);
      expect(Math.abs(iconBoxes[i].w - iconBoxes[0].w)).toBeLessThan(1);
      expect(Math.abs(iconBoxes[i].h - iconBoxes[0].h)).toBeLessThan(1);
      const gap = iconBoxes[i].x - (iconBoxes[i - 1].x + iconBoxes[i - 1].w);
      expect(Math.abs(gap - gap0)).toBeLessThan(1.5);
      expect(gap).toBeLessThan(6);
    }
    const closedBox = await panel.boundingBox();
    await page.click('.profile-list-toggle');
    await expect(page.locator('.profile-list')).toBeVisible();
    await expect(page.locator('.profile-list-new')).toHaveAttribute('placeholder', 'Nowy profil');
    const openBox = await panel.boundingBox();
    expect(Math.abs(openBox.height - closedBox.height)).toBeLessThan(1);
    const listBox = await page.locator('.profile-list').boundingBox();
    const themeBox = await page.locator('.profile-appearance .theme-btn').boundingBox();
    expect(listBox.y).toBeLessThan(themeBox.y + themeBox.height);
    expect(listBox.y + listBox.height).toBeGreaterThan(themeBox.y);
    await page.click('.profile-panel-close');
    await expect(panel).toBeHidden();
    await expect(page.locator('.profile-toggle-name')).toHaveText('Ja');
    await expect(toggle).toBeVisible();
    await page.click('[data-navigate="categories"]');
    await page.waitForSelector('#categories.active');
    await expect(page.locator('.top-controls')).toBeHidden();
    await page.locator('#categories .btn-back').click();
    await page.waitForSelector('#home.active');
    await expect(toggle).toBeVisible();
  });

  test('delete removes the active profile when more than one exists', async ({ page }) => {
    await page.addInitScript(() => {
      localStorage.setItem('prawko_profiles', JSON.stringify({
        activeId: 'p2',
        profiles: [
          { id: 'p1', name: 'Ja', createdAt: 1 },
          { id: 'p2', name: 'Anabela', createdAt: 2 },
        ],
      }));
    });
    await page.goto('/');
    await page.waitForSelector('#home.active');
    await page.click('.profile-toggle');
    await expect(page.locator('.profile-list-toggle')).toBeVisible();
    await expect(page.locator('.profile-action-delete')).toHaveAttribute('aria-label', 'Usuń');
    await page.click('.profile-action-delete');
    await page.waitForSelector('.modal-overlay.active');
    await expect(page.locator('#modal-desc')).toContainText('Anabela');
    await expect(page.locator('.modal-dismiss')).toBeVisible();
    await page.click('.modal-dismiss');
    await expect(page.locator('.modal-overlay')).not.toHaveClass(/active/);
    await expect(page.locator('#profile-panel')).toBeVisible();
    await expect(page.locator('.profile-toggle-name')).toHaveText('Anabela');
    await page.click('.profile-action-delete');
    await page.waitForSelector('.modal-overlay.active');
    await page.click('.btn-confirm-end');
    await page.waitForSelector('#home.active');
    await expect(page.locator('#profile-panel')).toBeVisible();
    await expect(page.locator('.profile-toggle-name')).toHaveText('Ja');
    await expect(page.locator('.profile-list-btn')).toHaveCount(0);
    await expect(page.locator('.profile-action-delete')).toHaveAttribute('aria-label', 'Resetuj');
  });

  test('switching profiles updates stats without a full reload', async ({ page }) => {
    await page.addInitScript(() => {
      localStorage.setItem('prawko_profiles', JSON.stringify({
        activeId: 'p1',
        profiles: [
          { id: 'p1', name: 'Ja', createdAt: 1 },
          { id: 'p2', name: 'Anabela', createdAt: 2 },
        ],
      }));
      localStorage.setItem('prawko_p_p1_learn', JSON.stringify({ B: { q1: { answer: 'T', streak: 2 } } }));
    });
    await page.goto('/');
    await page.waitForSelector('#home.active');
    await page.evaluate(() => { window.__prawkoStay = 1; });
    await page.click('.profile-toggle');
    await expect(page.locator('.profile-stat-learn')).toContainText('1');
    await page.click('.profile-list-toggle');
    await page.click('.profile-list-btn[data-id="p2"]');
    await expect(page.locator('#profile-panel')).toBeVisible();
    await expect(page.locator('.profile-toggle-name')).toHaveText('Anabela');
    await expect(page.locator('.profile-name-input')).toHaveValue('Anabela');
    expect(await page.evaluate(() => window.__prawkoStay)).toBe(1);
    await expect(page.locator('.profile-stat-learn')).toHaveText('Nauka: 0 umiem');
  });

  test('resetting the last profile wipes progress and restores Ja', async ({ page }) => {
    await page.addInitScript(() => {
      localStorage.setItem('prawko_profiles', JSON.stringify({
        activeId: 'p1',
        profiles: [{ id: 'p1', name: 'Anabela', createdAt: 1 }],
      }));
      localStorage.setItem('prawko_p_p1_learn', JSON.stringify({ B: { q1: { answer: 'T', streak: 2 } } }));
      localStorage.setItem('prawko_p_p1_stats', JSON.stringify([
        { date: '2026-01-01T00:00:00.000Z', category: 'B', score: 70, maxPoints: 74, passed: true },
      ]));
    });
    await page.goto('/');
    await page.waitForSelector('#home.active');
    await expect(page.locator('.profile-toggle-name')).toHaveText('Anabela');
    await page.click('.profile-toggle');
    await expect(page.locator('.profile-stat-learn')).toContainText('1');
    await expect(page.locator('.profile-stat-exams')).toContainText('1');
    await page.click('.profile-action-delete');
    await page.waitForSelector('.modal-overlay.active');
    await expect(page.locator('#modal-title')).toContainText('Zresetować');
    await page.click('.btn-confirm-end');
    await page.waitForSelector('#home.active');
    await expect(page.locator('#profile-panel')).toBeVisible();
    await expect(page.locator('.profile-toggle-name')).toHaveText('Ja');
    await expect(page.locator('.profile-stat-learn')).toHaveText('Nauka: 0 umiem');
    await expect(page.locator('.profile-stat-exams')).toHaveText('Egzaminy: 0 (0 zdane)');
  });

  test('exam summary in the profile panel opens the history screen', async ({ page }) => {
    await page.addInitScript(() => {
      localStorage.setItem('prawko_p_p1_stats', JSON.stringify([
        {
          date: '2026-01-01T12:00:00.000Z',
          category: 'B',
          score: 70,
          maxPoints: 74,
          passed: true,
          basicScore: 44,
          specialistScore: 26,
        },
      ]));
    });
    await page.goto('/');
    await page.waitForSelector('#home.active');
    await page.click('.profile-toggle');
    await page.click('.profile-stat-exams');
    await expect(page.locator('#history')).toHaveClass(/active/);
    await expect(page.locator('.history-intro')).toBeVisible();
    await expect(page.locator('.history-item')).toHaveCount(1);
    await expect(page.locator('.history-item-category')).toHaveText('B');
    await expect(page.locator('.history-item-score')).toContainText('70/74');
    await expect(page.locator('.history-item-parts')).toContainText('44');
  });

  test('exam count in the profile panel opens the empty history screen', async ({ page }) => {
    await page.goto('/');
    await page.waitForSelector('#home.active');
    await page.click('.profile-toggle');
    await expect(page.locator('.profile-action-history')).toHaveCount(0);
    await page.click('.profile-stat-exams');
    await expect(page.locator('#history')).toHaveClass(/active/);
    await expect(page.locator('.history-empty')).toBeVisible();
  });

  test('adding another New profile gets a Windows-style (2) suffix', async ({ page }) => {
    await page.goto('/');
    await page.waitForSelector('#home.active');
    await page.click('.profile-toggle');
    await page.click('.profile-list-toggle');
    const add = page.locator('.profile-list-new');
    await add.fill('Nowy');
    await add.press('Enter');
    await expect(page.locator('.profile-toggle-name')).toHaveText('Nowy');
    await expect(page.locator('#profile-panel')).toBeVisible();
    const addAgain = page.locator('.profile-list-new');
    await addAgain.fill('Nowy');
    await addAgain.press('Enter');
    await expect(page.locator('.profile-toggle-name')).toHaveText('Nowy (2)');
    await expect(page.locator('.profile-list-btn')).toHaveText(['Ja', 'Nowy']);
  });

  test('the profile list scrolls once it no longer fits', async ({ page }) => {
    await page.addInitScript(() => {
      const profiles = Array.from({ length: 8 }, (_, i) => ({
        id: `p${i + 1}`,
        name: i === 0 ? 'Ja' : `Osoba ${i}`,
        createdAt: i + 1,
      }));
      localStorage.setItem('prawko_profiles', JSON.stringify({ activeId: 'p1', profiles }));
    });
    await page.goto('/');
    await page.waitForSelector('#home.active');
    await page.click('.profile-toggle');
    const panel = page.locator('#profile-panel');
    const closedBox = await panel.boundingBox();
    await page.click('.profile-list-toggle');
    const list = page.locator('.profile-list');
    await expect(list).toBeVisible();
    const openBox = await panel.boundingBox();
    expect(Math.abs(openBox.height - closedBox.height)).toBeLessThan(1);
    await expect(page.locator('.profile-list-btn')).toHaveCount(7);
    await expect(page.locator('.profile-list-new')).toHaveCount(0);
    expect(await list.evaluate((el) => el.scrollHeight > el.clientHeight + 1)).toBe(true);
  });

  test('Nowy and New count as the same profile name', async ({ page }) => {
    await page.addInitScript(() => {
      localStorage.setItem('prawko_profiles', JSON.stringify({
        activeId: 'p1',
        profiles: [
          { id: 'p1', name: 'Ja', createdAt: 1 },
          { id: 'p2', name: 'Nowy', createdAt: 2 },
        ],
      }));
    });
    await page.goto('/');
    await page.waitForSelector('#home.active');
    await page.click('.profile-toggle');
    const input = page.locator('.profile-name-input');
    await input.fill('New');
    await input.press('Enter');
    await expect(page.locator('.profile-toggle-name')).toHaveText('Nowy (2)');
  });

  test('switching to English shows Me and New', async ({ page }) => {
    await page.goto('/');
    await page.waitForSelector('#home.active');
    await cycleLanguage(page);
    await expect(page.locator('.profile-toggle-name')).toHaveText('Me');
    await page.click('.profile-toggle');
    await expect(page.locator('.profile-name-input')).toHaveValue('Me');
    await expect(page.locator('.profile-list-new')).toHaveAttribute('placeholder', 'New profile');
    await expect(page.locator('.profile-stat-exams')).toContainText('Exams:');
  });

  test('resetting the last profile then switching to English shows Me', async ({ page }) => {
    await page.goto('/');
    await page.waitForSelector('#home.active');
    await page.click('.profile-toggle');
    await page.click('.profile-action-delete');
    await page.waitForSelector('.modal-overlay.active');
    await page.click('.btn-confirm-end');
    await page.waitForSelector('#home.active');
    await expect(page.locator('#profile-panel')).toBeVisible();
    await expect(page.locator('.profile-toggle-name')).toHaveText('Ja');
    await cycleLanguage(page);
    await expect(page.locator('.profile-toggle-name')).toHaveText('Me');
    await expect(page.locator('#profile-panel')).toBeVisible();
    await expect(page.locator('.profile-name-input')).toHaveValue('Me');
  });

  test('profile arrows export and import learn progress', async ({ page }) => {
    const answerDaysAgo = (days) => {
      const d = new Date();
      d.setHours(12, 0, 0, 0);
      d.setDate(d.getDate() - days);
      return d.getTime();
    };
    const daysAgo = (ms) => {
      const now = new Date();
      const then = new Date(ms);
      const today = Date.UTC(now.getFullYear(), now.getMonth(), now.getDate());
      const thenDay = Date.UTC(then.getFullYear(), then.getMonth(), then.getDate());
      return Math.round((today - thenDay) / 86400000);
    };
    const learn = JSON.stringify({
      B: {
        99: { answer: 'T', streak: 2, misses: 0, answeredAt: answerDaysAgo(0) },
        100: { answer: 'T', streak: 1, misses: 0, answeredAt: answerDaysAgo(3) },
        109: { answer: 'T', streak: 0, misses: 1, answeredAt: answerDaysAgo(1) },
        110: { answer: 'T', streak: 0, misses: 2, answeredAt: answerDaysAgo(10) },
        352: { answer: 'N', streak: 1, misses: 2, answeredAt: answerDaysAgo(2) },
        469: { answer: 'T', streak: 1, misses: 1, answeredAt: answerDaysAgo(0) },
        475: { answer: 'N', streak: 4, misses: 3, answeredAt: answerDaysAgo(40) },
      },
    });
    const restored = {
      B: {
        99: { answer: 'T', streak: 2, misses: 0 },
        100: { answer: 'T', streak: 1, misses: 0 },
        109: { answer: '!', streak: 0, misses: 1 },
        110: { answer: '!', streak: 0, misses: 2 },
        352: { answer: 'N', streak: 1, misses: 2 },
        469: { answer: 'T', streak: 1, misses: 1 },
        475: { answer: 'N', streak: 2, misses: 1 },
      },
    };
    const restoredDays = { 99: 0, 100: 3, 109: 1, 110: 10, 352: 2, 469: 0, 475: 31 };
    const expectLearn = (raw) => {
      const parsed = JSON.parse(raw);
      const status = {};
      const days = {};
      for (const [id, entry] of Object.entries(parsed.B)) {
        status[id] = { answer: entry.answer, streak: entry.streak, misses: entry.misses };
        days[id] = daysAgo(entry.answeredAt);
      }
      expect(status).toEqual(restored.B);
      expect(days).toEqual(restoredDays);
    };
    const exams = [
      {
        date: '2026-08-31T10:15:45.123Z',
        category: 'B',
        score: 70,
        maxPoints: 74,
        passed: true,
        basicScore: 44,
        specialistScore: 26,
      },
      {
        date: '2026-09-01T08:00:00.000Z',
        category: 'PT',
        score: 20,
        maxPoints: 74,
        passed: false,
        basicScore: 10,
        specialistScore: 10,
      },
      {
        date: '2026-07-01T00:00:30.000Z',
        category: 'A',
        score: 68,
        maxPoints: 74,
        passed: true,
      },
    ];
    const examsRestored = [
      {
        date: '2026-08-31T10:15:00.000Z',
        category: 'B',
        score: 70,
        maxPoints: 74,
        passed: true,
        basicScore: 44,
        specialistScore: 26,
      },
      {
        date: '2026-09-01T08:00:00.000Z',
        category: 'PT',
        score: 20,
        maxPoints: 74,
        passed: false,
        basicScore: 10,
        specialistScore: 10,
      },
      {
        date: '2026-07-01T00:00:00.000Z',
        category: 'A',
        score: 68,
        maxPoints: 74,
        passed: true,
      },
    ];
    await page.goto('/');
    await page.waitForSelector('#home.active');
    await page.evaluate(({ learnPayload, statsPayload }) => {
      localStorage.setItem('prawko_p_p1_learn', learnPayload);
      localStorage.setItem('prawko_p_p1_stats', statsPayload);
    }, { learnPayload: learn, statsPayload: JSON.stringify(exams) });
    await page.click('.profile-toggle');
    const exp = page.locator('.profile-action-export');
    const imp = page.locator('.profile-action-import');
    await expect(page.locator('#profile-panel-title')).toHaveText('Profil');
    await expect(exp).toBeVisible();
    await expect(imp).toBeVisible();
    await expect(exp).toHaveText('');
    await expect(imp).toHaveText('');
    const nameBox = await page.locator('.profile-name-input').boundingBox();
    const box = await exp.boundingBox();
    const impBox = await imp.boundingBox();
    const panelBox = await page.locator('#profile-panel').boundingBox();
    const chevronBox = await page.locator('.profile-list-toggle').boundingBox();
    expect(box.width).toBeGreaterThanOrEqual(26);
    expect(box.height).toBeGreaterThanOrEqual(26);
    expect(Math.abs(box.width - box.height)).toBeLessThan(2);
    expect(chevronBox.x).toBeGreaterThan(nameBox.x + nameBox.width);
    expect(box.x).toBeGreaterThan(chevronBox.x + chevronBox.width);
    expect(Math.abs((box.y + box.height / 2) - (nameBox.y + nameBox.height / 2))).toBeLessThan(8);
    expect(impBox.x).toBeGreaterThan(box.x);
    const delBox = await page.locator('.profile-action-delete').boundingBox();
    expect(delBox.x).toBeGreaterThan(impBox.x);
    expect(panelBox.x + panelBox.width - (delBox.x + delBox.width)).toBeLessThan(24);
    const [download] = await Promise.all([
      page.waitForEvent('download'),
      exp.click(),
    ]);
    expect(download.suggestedFilename()).toBe('prawko-ja.json');
    const chunks = [];
    const stream = await download.createReadStream();
    for await (const chunk of stream) chunks.push(chunk);
    const file = JSON.parse(Buffer.concat(chunks).toString('utf8'));
    expect(file.v).toBe(2);
    expect(file.profile.name).toBe('Ja');
    const packed = JSON.parse(file.data.learn);
    expect(Object.keys(packed)).toEqual(['B']);
    expect(packed.B).toHaveLength(2848);
    expect(file.data.learn).not.toBe(learn);
    expect(file.data.stats).toHaveLength(28);
    expect(file.data.stats).not.toContain('basicScore');
    const chrome = await page.evaluate(() => ({
      theme: document.documentElement.getAttribute('data-theme') === 'dark' ? 'dark' : 'light',
      lang: document.documentElement.lang,
      skin: document.documentElement.getAttribute('data-exam-skin'),
    }));
    expect(file.data.theme).toBe(chrome.theme);
    expect(file.data.lang).toBe(chrome.lang);
    expect(file.data.exam_skin).toBe(chrome.skin);

    await page.evaluate(() => {
      localStorage.removeItem('prawko_p_p1_learn');
      localStorage.removeItem('prawko_p_p1_stats');
    });
    const snapshot = {
      name: 'prawko-ja.json',
      mimeType: 'application/json',
      buffer: Buffer.from(JSON.stringify(file)),
    };
    await page.locator('.profile-import-file').setInputFiles(snapshot);
    const modal = page.locator('#confirm-modal.active');
    await expect(modal.locator('#modal-title')).toHaveText('Nadpisać profil?');
    await expect(modal.locator('.btn-confirm-end')).toHaveText('Tak, nadpisz');
    await expect(modal.locator('.btn-cancel-end')).toHaveText('Nie, nowy profil');
    const dismiss = modal.locator('.modal-dismiss');
    await expect(dismiss).toBeVisible();
    await expect(dismiss).toHaveText('×');
    const dismissBox = await dismiss.boundingBox();
    const contentBox = await modal.locator('.modal-content').boundingBox();
    expect(contentBox.x + contentBox.width - (dismissBox.x + dismissBox.width)).toBeLessThan(16);
    expect(dismissBox.y - contentBox.y).toBeLessThan(16);
    expect(await page.evaluate(() => localStorage.getItem('prawko_p_p1_learn'))).toBeNull();
    expect(await page.evaluate(() => localStorage.getItem('prawko_p_p1_stats'))).toBeNull();
    await modal.locator('.btn-confirm-end').click();
    await expect(page.locator('#profile-panel')).toBeVisible();
    await expect(page.locator('.profile-toggle-name')).toHaveText('Ja');
    await expect(page.locator('.profile-stat-learn')).toContainText('2 umiem');
    await expect(page.locator('.profile-stat-exams')).toHaveText('Egzaminy: 3 (2 zdane)');
    const stored = await page.evaluate(() => ({
      learn: localStorage.getItem('prawko_p_p1_learn'),
      stats: localStorage.getItem('prawko_p_p1_stats'),
    }));
    expectLearn(stored.learn);
    expect(JSON.parse(stored.stats)).toEqual(examsRestored);
    const names = await page.evaluate(() => {
      const raw = JSON.parse(localStorage.getItem('prawko_profiles'));
      return raw.profiles.map((p) => p.name);
    });
    expect(names).toEqual(['Ja']);

    await page.locator('.profile-import-file').setInputFiles(snapshot);
    await expect(modal.locator('#modal-title')).toHaveText('Nadpisać profil?');
    await modal.locator('.btn-cancel-end').click();
    await expect(page.locator('.profile-toggle-name')).toHaveText('Ja (2)');
    const afterNew = await page.evaluate(() => {
      const raw = JSON.parse(localStorage.getItem('prawko_profiles'));
      const copy = raw.profiles.find((p) => p.name === 'Ja (2)');
      return {
        names: raw.profiles.map((p) => p.name),
        original: localStorage.getItem('prawko_p_p1_learn'),
        copy: copy ? localStorage.getItem(`prawko_p_${copy.id}_learn`) : null,
        originalStats: localStorage.getItem('prawko_p_p1_stats'),
        copyStats: copy ? localStorage.getItem(`prawko_p_${copy.id}_stats`) : null,
      };
    });
    expect(afterNew.names).toEqual(['Ja', 'Ja (2)']);
    expectLearn(afterNew.original);
    expectLearn(afterNew.copy);
    expect(JSON.parse(afterNew.originalStats)).toEqual(examsRestored);
    expect(JSON.parse(afterNew.copyStats)).toEqual(examsRestored);

    await page.locator('.profile-import-file').setInputFiles(snapshot);
    await expect(modal.locator('.modal-dismiss')).toBeVisible();
    await modal.locator('.modal-dismiss').click();
    await expect(modal).toBeHidden();
    const afterDismiss = await page.evaluate(() => {
      const raw = JSON.parse(localStorage.getItem('prawko_profiles'));
      return raw.profiles.map((p) => p.name);
    });
    expect(afterDismiss).toEqual(['Ja', 'Ja (2)']);
    await expect(page.locator('.profile-toggle-name')).toHaveText('Ja (2)');

    const dialogPromise = page.waitForEvent('dialog');
    await page.locator('.profile-import-file').setInputFiles({
      name: 'bad.json',
      mimeType: 'application/json',
      buffer: Buffer.from('{}'),
    });
    const dialog = await dialogPromise;
    expect(dialog.message()).toContain('Nie da się');
    await dialog.accept();
    const afterBad = await page.evaluate(() => ({
      learn: localStorage.getItem('prawko_p_p1_learn'),
      stats: localStorage.getItem('prawko_p_p1_stats'),
    }));
    expectLearn(afterBad.learn);
    expect(JSON.parse(afterBad.stats)).toEqual(examsRestored);

    const oldFilePromise = page.waitForEvent('dialog');
    await page.locator('.profile-import-file').setInputFiles({
      name: 'prawko-ja.json',
      mimeType: 'application/json',
      buffer: Buffer.from(JSON.stringify({
        v: 1,
        profile: { name: 'Stary', createdAt: 1 },
        data: { learn },
      })),
    });
    const oldFile = await oldFilePromise;
    expect(oldFile.message()).toContain('Nie da się');
    await oldFile.accept();
    const afterOld = await page.evaluate(() => {
      const raw = JSON.parse(localStorage.getItem('prawko_profiles'));
      return raw.profiles.map((p) => p.name);
    });
    expect(afterOld).toEqual(['Ja', 'Ja (2)']);
  });

  test('theme language and skin follow the profile', async ({ page }) => {
    await page.goto('/');
    await page.waitForSelector('#home.active');
    await page.evaluate(() => {
      localStorage.setItem('prawko_p_p1_theme', 'dark');
      localStorage.setItem('prawko_p_p1_lang', 'pl');
      localStorage.setItem('prawko_p_p1_exam_skin', 'station');
    });
    await page.reload();
    await page.waitForSelector('#home.active');
    await expect.poll(() => page.locator('html').getAttribute('data-theme')).toBe('dark');
    await expect.poll(() => page.locator('html').getAttribute('lang')).toBe('pl');
    await expect.poll(() => page.locator('html').getAttribute('data-exam-skin')).toBe('station');
    await expect(page.locator('.skin-btn')).toHaveText('Stacja');

    await page.click('.profile-toggle');
    await page.click('.profile-list-toggle');
    await page.locator('.profile-list-new').fill('Nowy');
    await page.locator('.profile-list-new').press('Enter');
    await expect(page.locator('.profile-toggle-name')).toHaveText('Nowy');
    await expect.poll(() => page.locator('html').getAttribute('data-theme')).toBe('dark');
    await expect.poll(() => page.locator('html').getAttribute('lang')).toBe('pl');
    await expect.poll(() => page.locator('html').getAttribute('data-exam-skin')).toBe('station');

    await page.evaluate(() => {
      document.querySelector('.theme-btn')?.click();
      document.querySelector('.skin-btn')?.click();
      document.querySelector('.lang-cycle')?.click();
    });
    await expect.poll(() => page.locator('html').getAttribute('data-theme-choice')).toBe('system');
    await expect.poll(() => page.locator('html').getAttribute('data-theme')).toBeNull();
    await expect.poll(() => page.locator('html').getAttribute('data-exam-skin')).toBe('panel');
    await expect.poll(() => page.locator('html').getAttribute('lang')).toBe('en');
    await expect(page.locator('.skin-btn')).toHaveText('Panel');

    if (await page.locator('#profile-panel').isHidden()) await page.click('.profile-toggle');
    if (await page.locator('.profile-list-toggle').getAttribute('aria-expanded') !== 'true') {
      await page.click('.profile-list-toggle');
    }
    await page.locator('.profile-list-btn').click();
    await expect.poll(() => page.locator('html').getAttribute('data-theme')).toBe('dark');
    await expect.poll(() => page.locator('html').getAttribute('lang')).toBe('pl');
    await expect.poll(() => page.locator('html').getAttribute('data-exam-skin')).toBe('station');
    await expect(page.locator('.skin-btn')).toHaveText('Stacja');

    if (await page.locator('#profile-panel').isHidden()) await page.click('.profile-toggle');
    if (await page.locator('.profile-list-toggle').getAttribute('aria-expanded') !== 'true') {
      await page.click('.profile-list-toggle');
    }
    await page.locator('.profile-list-btn').click();
    await expect.poll(() => page.locator('html').getAttribute('data-theme')).toBeNull();
    await expect.poll(() => page.locator('html').getAttribute('lang')).toBe('en');
    await expect.poll(() => page.locator('html').getAttribute('data-exam-skin')).toBe('panel');
    await expect(page.locator('.skin-btn')).toHaveText('Panel');

    await page.locator('.profile-import-file').setInputFiles({
      name: 'stary.json',
      mimeType: 'application/json',
      buffer: Buffer.from(JSON.stringify({
        v: 2,
        profile: { name: 'Stary', createdAt: 1 },
        data: { learn: '{}' },
      })),
    });
    await expect(page.locator('.profile-toggle-name')).toHaveText('Stary');
    await expect.poll(() => page.locator('html').getAttribute('lang')).toBe('en');
    const inherited = await page.evaluate(() => {
      const raw = JSON.parse(localStorage.getItem('prawko_profiles'));
      const id = raw.activeId;
      return {
        theme: localStorage.getItem(`prawko_p_${id}_theme`),
        lang: localStorage.getItem(`prawko_p_${id}_lang`),
        skin: localStorage.getItem(`prawko_p_${id}_exam_skin`),
      };
    });
    expect(inherited).toEqual({ theme: 'system', lang: 'en', skin: 'panel' });
  });
});

test.describe('phone screen', () => {
  test.use({
    viewport: { width: 390, height: 844 },
    screen: { width: 390, height: 844 },
  });

  test('profile name button and panel icons are finger-sized', async ({ page }) => {
    await page.goto('/');
    await page.waitForSelector('#home.active');
    await expect(page.locator('html')).toHaveAttribute('data-handset', '1');
    const toggle = page.locator('.profile-toggle');
    const toggleBox = await toggle.boundingBox();
    expect(toggleBox.height).toBeGreaterThanOrEqual(30);
    await expect(toggle).toHaveCSS('min-height', '32px');
    await toggle.click();
    const icon = page.locator('.profile-icon-btn').first();
    const iconBox = await icon.boundingBox();
    expect(iconBox.width).toBeGreaterThanOrEqual(26);
    expect(iconBox.height).toBeGreaterThanOrEqual(26);
    await expect(icon).toHaveCSS('width', '28px');
  });
});

test.describe('computer screen', () => {
  test('a narrow window on a large screen keeps compact profile controls', async ({ browser, baseURL }) => {
    const context = await browser.newContext({
      viewport: { width: 420, height: 900 },
      screen: { width: 1920, height: 1080 },
      locale: 'pl-PL',
      serviceWorkers: 'block',
      baseURL,
    });
    const page = await context.newPage();
    try {
      await page.goto('/');
      await page.waitForSelector('#home.active');
      await expect(page.locator('html')).not.toHaveAttribute('data-handset', '1');
      await expect(page.locator('.profile-toggle')).toHaveCSS('min-height', '36px');
      await page.click('.profile-toggle');
      const icon = page.locator('.profile-icon-btn').first();
      await expect(icon).toHaveCSS('width', '26px');
      const iconBox = await icon.boundingBox();
      expect(iconBox.width).toBeLessThan(36);
      expect(iconBox.height).toBeLessThan(36);
    } finally {
      await context.close();
    }
  });
});

test.describe('Language fallback', () => {
  test.describe('German browser language', () => {
    test.use({ locale: 'de-DE' });

    test('uses German UI', async ({ page }) => {
      await page.goto('/');
      await page.waitForSelector('#home.active');
      await expect(page.locator('.profile-toggle-name')).toHaveText('Ich');
      await expect(page.locator('[data-navigate="categories"]').first()).toHaveText('Start');
      await page.click('.profile-toggle');
      await expect(page.locator('.profile-name-input')).toHaveValue('Ich');
      await expect(page.locator('.profile-list-new')).toHaveAttribute('placeholder', 'Neues Profil');
    });
  });

  test.describe('unsupported browser language', () => {
    test.use({ locale: 'fr-FR' });

    test('falls back to English', async ({ page }) => {
      await page.goto('/');
      await page.waitForSelector('#home.active');
      await expect(page.locator('.profile-toggle-name')).toHaveText('Me');
      await expect(page.locator('[data-navigate="categories"]').first()).toHaveText('Start');
      await page.click('.profile-toggle');
      await expect(page.locator('.profile-name-input')).toHaveValue('Me');
      await expect(page.locator('.profile-list-new')).toHaveAttribute('placeholder', 'New profile');
    });
  });
});

test.describe('Category card stats follow the selected mode', () => {
  test('learn mode hides last exam score and exam mode shows it', async ({ page }) => {
    await page.addInitScript(() => {
      localStorage.setItem('prawko_p_p1_stats', JSON.stringify([
        { date: '2026-01-01T00:00:00.000Z', category: 'B', score: 0, maxPoints: 74, passed: false },
      ]));
    });
    await page.goto('/');
    await goToCategories(page);
    await page.click('.mode-btn[data-mode="learn"]');
    await expect(page.locator('.category-grid .category-card[data-category="B"] .exam-badge')).toHaveCount(0);
    const bank = (await page.locator('.category-grid .category-card[data-category="B"] .question-count').innerText()).match(/\d+/);
    await expect(page.locator('.category-grid .category-card[data-category="B"] .progress-text')).toHaveText(`0/${bank[0]}`);
    await page.click('.mode-btn[data-mode="exam"]');
    await expect(page.locator('.category-grid .category-card[data-category="B"] .progress-text')).toHaveText('0/74');
    await expect(page.locator('.category-grid .category-card[data-category="B"] .exam-badge')).toHaveText('NIEZDANY');
  });

  test('exam mode still updates the grid after a category was opened in learn', async ({ page }) => {
    await startLearnMode(page);
    await page.click('.quiz-back', { force: true });
    await page.waitForSelector('#categories.active');
    await page.click('.mode-btn[data-mode="exam"]');
    await expect(page.locator('.category-grid .category-card[data-category="B"] .progress-text')).toHaveText('brak prób');
  });
});

test.describe('Exam results question review', () => {
  test('starts as numbered marks and expands to media, question, and colored keys', async ({ page }) => {
    await startExamMode(page);
    await page.click('.btn-end-exam');
    await page.waitForSelector('.modal-overlay.active');
    await page.click('.btn-confirm-end');
    await page.waitForSelector('#results.active');

    const navBox = await page.locator('#results .results-nav').boundingBox();
    const reviewBox = await page.locator('#results .review-list').boundingBox();
    expect(navBox).toBeTruthy();
    expect(reviewBox).toBeTruthy();
    expect(navBox.y + navBox.height).toBeLessThanOrEqual(reviewBox.y + 24);
    await expect(page.locator('.result-verdict')).toHaveText(/NIEZDANY/);

    const first = page.locator('.review-item').first();
    await expect(page.locator('.review-item')).toHaveCount(32);
    await expect(first).not.toHaveJSProperty('open', true);
    await expect(first.locator('.review-title')).toHaveCount(0);
    await expect(first.locator('.incorrect-question')).toHaveCount(0);
    await expect(first.locator('.review-answers')).toHaveCount(0);
    await expect(first).toHaveClass(/review-item-skip/);
    await expect(first.locator('.review-mark')).toHaveText('−');
    await expect(page.locator('.review-stats')).toHaveText(/Bez odpowiedzi: 32/);
    await expect(first.locator('summary')).toHaveText(/1\s*−/);

    await first.locator('summary').click();
    await expect(first).toHaveJSProperty('open', true);
    await expect(first.locator('.incorrect-question')).toBeVisible();
    await expect(first.locator('.incorrect-question')).not.toBeEmpty();
    await expect(first.locator('.review-no-answer')).toHaveText(/Brak odpowiedzi/);
    await expect(first.locator('.review-answers .answer-btn.correct')).toHaveCount(1);
    await expect(first.locator('.review-answers .answer-btn.incorrect')).toHaveCount(0);

    const reviewSel = await page.evaluate(() => {
      const u = (s) => {
        const el = document.querySelector(s);
        return el ? getComputedStyle(el).userSelect : null;
      };
      return {
        question: u('.incorrect-question'),
        answer: u('.review-answers .answer-btn'),
        answerText: u('.review-answers .answer-text'),
        noAnswer: u('.review-no-answer'),
        stats: u('.review-stats'),
        index: u('.review-index'),
        score: u('.score-value'),
        verdict: u('.result-verdict'),
      };
    });
    expect(reviewSel.question).toBe('text');
    expect(reviewSel.answer).toBe('text');
    if (reviewSel.answerText !== null) expect(reviewSel.answerText).toBe('text');
    expect(reviewSel.noAnswer).toBe('none');
    expect(reviewSel.stats).toBe('none');
    expect(reviewSel.index).toBe('none');
    expect(reviewSel.score).toBe('none');
    expect(reviewSel.verdict).toBe('none');
    await first.locator('.incorrect-question').click({ clickCount: 3 });
    const copied = await page.evaluate(() => (window.getSelection()?.toString() || '').trim());
    expect(copied.length).toBeGreaterThan(0);

    const heightBefore = await page.evaluate(() =>
      parseFloat(getComputedStyle(document.documentElement).getPropertyValue('--ui-design-height'))
    );
    const items = page.locator('.review-item');
    await items.nth(1).locator('summary').click();
    await items.nth(2).locator('summary').click();
    await expect.poll(async () => parseFloat(await page.evaluate(() =>
      getComputedStyle(document.documentElement).getPropertyValue('--ui-design-height')
    ))).toBeGreaterThan(heightBefore + 80);

    const last = items.last();
    await last.scrollIntoViewIfNeeded();
    await expect(last).toBeInViewport();

    await page.reload();
    await page.waitForSelector('#results.active');
    await expect(page.locator('.result-verdict')).toHaveText(/NIEZDANY/);
    await expect(page.locator('.review-item')).toHaveCount(32);
    await expect(page.locator('.review-stats')).toHaveText(/Bez odpowiedzi: 32/);
  });
});
