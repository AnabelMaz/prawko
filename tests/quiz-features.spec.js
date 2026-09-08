const { test, expect } = require('@playwright/test');
const { cycleLanguage, cycleSkin, learnCatalogLabel } = require('./helpers');

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
  await page.waitForSelector('#home.active');
  await page.click('[data-navigate="categories"]');
  await page.waitForSelector('#categories.active');
  // Ensure "Nauka" mode is selected (default)
  await page.click('.mode-btn[data-mode="learn"]');
  await page.click(`.category-grid .category-card[data-category="${category}"]`);
  await page.waitForSelector('#quiz.active');
}

async function setLearnQueue(page, kind, value) {
  const root = page.locator(`.learn-${kind}-select`);
  await root.locator('.learn-queue-select').click();
  await root.locator(`[role="option"][data-value="${value}"]`).click();
}

// Helper: navigate to categories and start exam mode for category PT (smallest)
async function startExamMode(page) {
  await page.goto('/');
  await page.waitForSelector('#home.active');
  await page.click('[data-navigate="categories"]');
  await page.waitForSelector('#categories.active');
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
      expect(uiSource).toContain('video.autoplay = true');
      expect(uiSource).toContain("video.preload = 'auto'");
    }
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
    expect(src).toContain('3596.mp4');
    const names = [...new Set(media.map((url) => url.split('/').pop().split('?')[0]))];
    expect(names).not.toContain('4C301.webp');
  });
});

test.describe('Learn video result mark', () => {
  test('replay hides the mark until the clip ends and leaves answer buttons', async ({ page }) => {
    await page.route(/\.(mp4|webm)(\?|$)/i, async () => {});
    await startLearnMode(page);
    const mediaArea = page.locator('#quiz .media-area');
    for (let i = 0; i < 25; i += 1) {
      if (await mediaArea.locator('video').count()) break;
      const next = page.locator('.btn-next');
      if (await next.isDisabled()) break;
      await next.click();
    }
    await expect(mediaArea.locator('video')).toHaveCount(1);
    await page.locator('.answers .answer-btn').first().click();
    const mark = page.locator('#quiz .learn-media-mark');
    await expect(mark).toBeVisible();
    const markedAnswers = page.locator('.answers .answer-btn.correct, .answers .answer-btn.incorrect');
    await expect(markedAnswers).not.toHaveCount(0);
    const answerSnapshot = await markedAnswers.evaluateAll((els) => els.map((el) => el.className).sort());
    await mediaArea.locator('video').evaluate((video) => {
      video.pause();
      video.dispatchEvent(new Event('ended'));
    });
    await page.locator('#quiz .media-replay-btn').click();
    await expect(mark).toBeHidden();
    await expect(markedAnswers).not.toHaveCount(0);
    expect(await markedAnswers.evaluateAll((els) => els.map((el) => el.className).sort())).toEqual(answerSnapshot);
    await mediaArea.locator('video').evaluate((video) => {
      video.pause();
      video.dispatchEvent(new Event('ended'));
    });
    await expect(mark).toBeVisible();
    expect(await markedAnswers.evaluateAll((els) => els.map((el) => el.className).sort())).toEqual(answerSnapshot);
  });
});

test.describe('Media slot size', () => {
  test('empty and filled media slots stay 16:9 and the same size', async ({ page }) => {
    await startLearnMode(page);
    const area = page.locator('.media-area');
    await expect(area).toBeVisible();

    let emptyBox = null;
    let filledBox = null;
    for (let i = 0; i < 50; i += 1) {
      const hasMedia = await page.locator('.media-area img, .media-area video').count();
      const box = await area.boundingBox();
      expect(box).toBeTruthy();
      expect(box.width / box.height).toBeCloseTo(16 / 9, 1);
      if (hasMedia) filledBox = box;
      else emptyBox = box;
      if (emptyBox && filledBox) break;
      await page.click('.btn-next');
      await expect(page.locator('.question-text')).not.toBeEmpty();
    }

    expect(emptyBox, 'expected a question without media').toBeTruthy();
    expect(filledBox, 'expected a question with media').toBeTruthy();
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
    await startLearnMode(page);
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
          99: { answer: 'N', streak: 0, dueAt: 1, misses: 2 },
          100: { answer: 'T', streak: 2, dueAt: 1, misses: 5 },
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
        B: { 1: { answer: 'T', streak: 2, dueAt: 1, misses: 0 } },
        C: {
          1: { answer: 'N', streak: 0, dueAt: 1, misses: 2 },
          2: { answer: 'N', streak: 0, dueAt: 1, misses: 0 },
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
    await page.waitForFunction(() => !document.querySelector('.quiz-dock')?.classList.contains('is-fitting'));
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
      await page.waitForFunction(() => !document.querySelector('.quiz-dock')?.classList.contains('is-fitting'));
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
      expect(room.leftRoom).toBeGreaterThanOrEqual(room.halo - 1.5);
      expect(room.rightRoom).toBeGreaterThanOrEqual(room.halo - 1.5);
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
      const data = await fetch('data/B.json').then((res) => res.json());
      return data.questions.map((q) => String(q.id));
    });
    await expect(page.locator('.learn-qnum-input')).not.toHaveAttribute('readonly');
    await page.locator('.learn-qnum-input').fill('1');
    await page.locator('.learn-qnum-input').press('Enter');
    await expect(page.locator('.question-card')).toHaveAttribute('data-question-id', catalog[0]);
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
      const data = await fetch('data/B.json').then((res) => res.json());
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
      const data = await fetch('data/B.json').then((res) => res.json());
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
    await expect(page.locator('.profile-list-btn')).toHaveCount(1);
    await expect(page.locator('.profile-stat-learn')).toContainText('Nauka:');
    await expect(page.locator('.profile-stat-exams')).toContainText('Egzaminy:');
    await expect(page.locator('.profile-action-history')).toHaveCount(0);
    await expect(page.locator('.profile-action-rename')).toBeVisible();
    await expect(page.locator('.profile-action-new')).toBeVisible();
    await expect(page.locator('.profile-action-delete')).toHaveText('Resetuj');
    await page.click('.profile-panel-close');
    await expect(panel).toBeHidden();
    await expect(page.locator('.profile-toggle-name')).toHaveText('Ja');
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
    await expect(page.locator('.profile-list-btn')).toHaveCount(2);
    await expect(page.locator('.profile-action-delete')).toHaveText('Usuń');
    await page.click('.profile-action-delete');
    await page.waitForSelector('.modal-overlay.active');
    await expect(page.locator('#modal-desc')).toContainText('Anabela');
    await page.click('.btn-confirm-end');
    await page.waitForSelector('#home.active');
    await expect(page.locator('.profile-toggle-name')).toHaveText('Ja');
    await page.click('.profile-toggle');
    await expect(page.locator('.profile-list-btn')).toHaveCount(1);
    await expect(page.locator('.profile-action-delete')).toHaveText('Resetuj');
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
    await page.click('.profile-list-btn[data-id="p2"]');
    await expect(page.locator('#profile-panel')).toBeHidden();
    await expect(page.locator('.profile-toggle-name')).toHaveText('Anabela');
    expect(await page.evaluate(() => window.__prawkoStay)).toBe(1);
    await page.click('.profile-toggle');
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
    await expect(page.locator('.profile-toggle-name')).toHaveText('Ja');
    await page.click('.profile-toggle');
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
    page.once('dialog', (dialog) => dialog.accept('Nowy'));
    await page.click('.profile-toggle');
    await page.click('.profile-action-new');
    await expect(page.locator('.profile-toggle-name')).toHaveText('Nowy');

    page.once('dialog', (dialog) => dialog.accept('Nowy'));
    await page.click('.profile-toggle');
    await page.click('.profile-action-new');
    await expect(page.locator('.profile-toggle-name')).toHaveText('Nowy (2)');
    await page.click('.profile-toggle');
    await expect(page.locator('.profile-list-btn')).toHaveText(['Ja', 'Nowy', 'Nowy (2)']);
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
    page.once('dialog', (dialog) => dialog.accept('New'));
    await page.click('.profile-toggle');
    await page.click('.profile-action-new');
    await expect(page.locator('.profile-toggle-name')).toHaveText('Nowy (2)');
  });

  test('switching to English shows Me and New', async ({ page }) => {
    await page.goto('/');
    await page.waitForSelector('#home.active');
    await cycleLanguage(page);
    await expect(page.locator('.profile-toggle-name')).toHaveText('Me');
    await page.click('.profile-toggle');
    await expect(page.locator('.profile-action-new')).toHaveText('New');
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
    await expect(page.locator('.profile-toggle-name')).toHaveText('Ja');
    await cycleLanguage(page);
    await expect(page.locator('.profile-toggle-name')).toHaveText('Me');
    await page.click('.profile-toggle');
    await expect(page.locator('.profile-list-btn')).toHaveText(['Me']);
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
      await expect(page.locator('.profile-action-new')).toHaveText('Neu');
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
      await expect(page.locator('.profile-action-new')).toHaveText('New');
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
    await page.click('[data-navigate="categories"]');
    await page.waitForSelector('#categories.active');
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
