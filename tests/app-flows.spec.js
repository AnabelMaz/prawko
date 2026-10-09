const { test, expect } = require('@playwright/test');
const { goToCategories, enablePracticeExam, recentCategoryIds } = require('./helpers');

async function openCategories(page) {
  await page.goto('/');
  await goToCategories(page);
}

async function startExamMode(page, category = 'PT') {
  await openCategories(page);
  await page.click('.mode-btn[data-mode="exam"]');
  await page.click(`.category-card[data-category="${category}"]`);
  await page.waitForSelector('.modal-overlay.active');
}

async function expectFilmPlayingOrAnswerClock(page) {
  await expect.poll(async () => page.evaluate(() => {
    const video = document.querySelector('#quiz video');
    const caption = document.querySelector('.exam-phase-caption')?.textContent || '';
    const clockPaused = document.querySelector('.timer-display-question')?.classList.contains('paused');
    const answering = /Czas na udzielenie odpowiedzi|Time to answer/i.test(caption);
    const playing = Boolean(video && !video.paused && (video.currentSrc || video.src));
    return (playing && !clockPaused) || (answering && !clockPaused);
  }), { timeout: 15000 }).toBe(true);
}

test.describe('App flows', () => {
  test('exam starts with an unscored practice banner', async ({ page }) => {
    await enablePracticeExam(page);
    await startExamMode(page);
    await page.click('.btn-confirm-end');
    await page.waitForSelector('#quiz.active');
    await expect(page.locator('.exam-practice-banner')).toBeVisible();
    await expect(page.locator('.exam-practice-banner')).toHaveText(/EGZAMIN PRÓBNY|PRACTICE EXAM/i);
    await expect(page.locator('#quiz')).toHaveClass(/exam-practice/);
    await expect(page.locator('.answer-btn').first()).toBeEnabled();
    await expect(page.locator('.btn-exam-next')).toHaveClass(/visible/);
  });

  test('START is only on film questions; photos stay visible during read time', async ({ page }) => {
    await startExamMode(page);
    await page.click('.btn-confirm-end');
    await page.waitForSelector('#quiz.active');
    await page.waitForSelector('.question-text:not(:empty)');

    const isBasic = await page.locator('.answers.yn-answers').count();
    const waitingForFilm = await page.locator('.exam-film-pending').count();
    if (!isBasic) {
      await expect(page.locator('.exam-film-start')).toBeHidden();
      return;
    }

    await expect(page.locator('.answer-btn').first()).toBeEnabled();
    await page.locator('.answer-btn').first().click();
    await expect(page.locator('.answer-btn').first()).toHaveClass(/selected/);
    if (waitingForFilm) {
      await expect(page.locator('.exam-film-start')).toBeVisible();
      await page.click('.exam-film-start');
      await expect(page.locator('.exam-film-start')).toBeHidden();
      await expect(page.locator('.exam-film-pending')).toHaveCount(0);
      await expectFilmPlayingOrAnswerClock(page);
    } else {
      await expect(page.locator('.exam-film-start')).toBeHidden();
    }
  });

  test('read-time expiry starts the film or the answer clock', async ({ page }) => {
    await page.clock.install();
    await startExamMode(page);
    await page.click('.btn-confirm-end');
    await page.waitForSelector('#quiz.active');
    await page.waitForSelector('.question-text:not(:empty)');
    if (!(await page.locator('.exam-film-pending').count())) return;

    await expect(page.locator('.exam-film-start')).toBeVisible();
    await page.clock.fastForward(21000);
    await expect(page.locator('.exam-film-start')).toBeHidden();
    await expect(page.locator('.exam-film-pending')).toHaveCount(0);
    await expectFilmPlayingOrAnswerClock(page);
  });

  test('exam chrome matches WORD layout: counters, seconds timer, locked keys', async ({ page }) => {
    await startExamMode(page);
    await page.click('.btn-confirm-end');
    await page.waitForSelector('#quiz.active');
    await expect(page.locator('#quiz')).toHaveClass(/exam-active/);
    await expect(page.locator('.exam-counters')).toBeVisible();
    await expect(page.locator('.exam-counter-basic')).toHaveText(/\d+ z \d+/);
    await expect(page.locator('.exam-counter-specialist')).toHaveText(/\d+ z \d+/);
    await expect(page.locator('.question-timer')).toHaveText(/\d+ s/);
    await expect(page.locator('.timer-display-question')).toBeVisible();
    await expect(page.locator('.exam-top-fields')).toBeVisible();
    await expect(page.locator('.btn-end-exam')).toBeVisible();
    await expect(page.locator('.top-controls')).toBeHidden();
    await expect(page.locator('.quiz-mode-pill')).toBeHidden();
    await expect(page.locator('.progress-bar')).toBeHidden();
    await expect(page.locator('#quiz.exam-active .media-area')).toHaveCSS('pointer-events', 'none');
  });

  test('specialist ABC is 50s for reading and answering together', async ({ page }) => {
    await page.clock.install();
    await enablePracticeExam(page);
    await startExamMode(page);
    await page.click('.btn-confirm-end');
    await page.waitForSelector('#quiz.active');

    for (let i = 0; i < 20; i++) {
      if (await page.locator('.abc-answers').isVisible()) break;
      await page.waitForSelector('.yn-answers');
      if (await page.locator('.exam-film-start').isVisible()) {
        await page.locator('.exam-film-start').click();
        await page.evaluate(() => {
          document.querySelector('#quiz video')?.dispatchEvent(new Event('ended'));
        });
      } else {
        await page.clock.fastForward(20000);
      }
      await expect(page.locator('.yn-answers .answer-btn').first()).toBeEnabled();
      await page.locator('.yn-answers .answer-btn').first().click();
      await page.clock.fastForward(1000);
      await page.locator('.btn-exam-next.visible').click();
    }

    await expect(page.locator('.abc-answers')).toBeVisible();
    await expect(page.locator('.abc-answers .answer-btn').first()).toBeEnabled();
    await expect(page.locator('.exam-film-start')).toBeHidden();
    await expect(page.locator('.exam-phase-caption')).toHaveText(/Czas na udzielenie odpowiedzi|Time to answer/);
    await expect(page.locator('.question-timer')).toHaveText(/^(50|49|48) s$/);
    await expect(page.locator('.abc-answers .answer-label').first()).toHaveText('A');
    await page.locator('.abc-answers .answer-btn').first().click();
    await expect(page.locator('.abc-answers .answer-btn').first()).toHaveClass(/selected/);
  });
  test('stale quiz route redirects to categories', async ({ page }) => {
    await page.goto('/#quiz');
    await page.waitForSelector('#categories.active');
    await expect(page).toHaveURL(/#categories$/);
  });

  test('category search shows empty state and clear restores cards', async ({ page }) => {
    await openCategories(page);

    const input = page.locator('#category-search');
    await input.fill('not-a-real-category');

    await expect(page.locator('#category-empty-state')).toBeVisible();
    await expect(page.locator('#category-search-clear')).toBeVisible();
    await expect(page.locator('.category-grid .category-card[data-category="B"]')).toBeHidden();

    await page.click('#category-search-clear');

    await expect(input).toHaveValue('');
    await expect(page.locator('#category-empty-state')).toBeHidden();
    await expect(page.locator('.category-grid .category-card[data-category="B"]')).toBeVisible();
  });

  test('recent categories are shown in most-recent-first order', async ({ page }) => {
    await openCategories(page);

    await page.click('.category-card[data-category="B"]');
    await page.waitForSelector('#quiz.active');
    await page.click('.quiz-back', { force: true });
    await page.waitForSelector('#categories.active');

    await page.click('.category-card[data-category="C"]');
    await page.waitForSelector('#quiz.active');
    await page.click('.quiz-back', { force: true });
    await page.waitForSelector('#categories.active');

    const recentIds = await recentCategoryIds(page);
    expect(recentIds.slice(0, 2)).toEqual(['C', 'B']);

    const recentCards = page.locator('#recent-categories-row .category-card');
    await expect(recentCards).toHaveCount(2);
    await expect(recentCards.nth(0)).toHaveAttribute('data-category', 'C');
    await expect(recentCards.nth(1)).toHaveAttribute('data-category', 'B');
  });

  test('canceling exam intro returns to categories', async ({ page }) => {
    await startExamMode(page, 'PT');
    await page.click('.btn-cancel-end');
    await page.waitForSelector('#categories.active');
    await expect(page).toHaveURL(/#categories$/);
  });

  test('results retry restarts exam intro for last category', async ({ page }) => {
    await startExamMode(page, 'PT');
    await page.click('.btn-confirm-end');
    await page.waitForSelector('#quiz.active');
    await page.click('.btn-end-exam');
    await page.waitForSelector('.modal-overlay.active');
    await page.click('.btn-confirm-end');
    await page.waitForSelector('#results.active');
    await expect(page.locator('.review-item')).toHaveCount(32);
    const firstReview = page.locator('.review-item').first();
    await firstReview.locator('summary').click();
    await expect(firstReview).toHaveJSProperty('open', true);
    await expect(firstReview.locator('.review-body')).toBeVisible();

    await page.click('.btn-retry');
    await page.waitForSelector('.modal-overlay.active');
    await page.click('.btn-confirm-end');
    await page.waitForSelector('#quiz.active');
    await expect(page.locator('#quiz')).toHaveClass(/exam-active/);
    await expect(page.locator('.question-text')).not.toBeEmpty();
  });

  test('CACHE_VERSION poll on tab return is only when serviceWorker is missing', async ({ page }) => {
    await page.addInitScript(() => {
      Object.defineProperty(navigator, 'serviceWorker', {
        configurable: true,
        get() { return undefined; },
      });
    });
    let version = 'prawko-test-1';
    let hits = 0;
    await page.route('**/sw.js', async (route) => {
      hits += 1;
      await route.fulfill({
        status: 200,
        contentType: 'text/javascript',
        body: `const CACHE_VERSION = '${version}';`,
        headers: { 'Cache-Control': 'no-store' },
      });
    });
    await page.goto('/');
    await page.waitForSelector('#home.active');
    await expect.poll(() => hits).toBeGreaterThan(0);
    await expect(page.locator('#update-banner')).toBeHidden();
    const afterLoad = hits;
    await page.evaluate(() => {
      Object.defineProperty(document, 'hidden', { configurable: true, get: () => false });
      window.dispatchEvent(new Event('focus'));
      window.dispatchEvent(new Event('focus'));
    });
    await page.waitForTimeout(200);
    expect(hits).toBe(afterLoad);
    const before = hits;
    version = 'prawko-test-2';
    await page.clock.install();
    await page.clock.fastForward(30_001);
    await page.evaluate(() => {
      window.dispatchEvent(new Event('focus'));
    });
    await expect.poll(() => hits).toBeGreaterThan(before);
    await expect(page.locator('#update-banner')).toBeVisible();
  });

  test('with a service worker, tab focus does not poll sw.js', async ({ page }) => {
    let hits = 0;
    await page.route('**/sw.js', async (route) => {
      hits += 1;
      await route.fulfill({
        status: 200,
        contentType: 'text/javascript',
        body: "const CACHE_VERSION = 'prawko-test-sw';",
        headers: { 'Cache-Control': 'no-store' },
      });
    });
    await page.goto('/');
    await page.waitForSelector('#home.active');
    await expect.poll(() => hits).toBeGreaterThan(0);
    const afterLoad = hits;
    await page.evaluate(() => {
      Object.defineProperty(document, 'hidden', { configurable: true, get: () => false });
      window.dispatchEvent(new Event('focus'));
      window.dispatchEvent(new Event('focus'));
      document.dispatchEvent(new Event('visibilitychange'));
    });
    await page.waitForTimeout(200);
    expect(hits).toBe(afterLoad);
    await expect(page.locator('#update-banner')).toBeHidden();
  });

  test('first service worker claim does not reload the page', async ({ page }) => {
    const loads = [];
    page.on('load', () => { loads.push(page.url()); });
    await page.goto('/');
    await page.waitForSelector('#home.active');
    await page.evaluate(() => { window.__prawkoStay = 1; });
    await page.evaluate(() => {
      navigator.serviceWorker.dispatchEvent(new Event('controllerchange'));
    });
    await page.waitForTimeout(800);
    expect(await page.evaluate(() => window.__prawkoStay)).toBe(1);
    expect(loads.length).toBe(1);
    await expect(page.locator('#home.active')).toBeVisible();
    await expect(page.locator('#update-banner')).toBeHidden();
  });

  test('service worker controllerchange reloads when a controller already existed', async ({ page }) => {
    await page.addInitScript(() => {
      const sw = navigator.serviceWorker;
      if (!sw) return;
      Object.defineProperty(sw, 'controller', {
        configurable: true,
        get() { return { scriptURL: `${location.origin}/sw.js` }; },
      });
      sw.register = async () => ({
        waiting: null,
        installing: null,
        active: { scriptURL: `${location.origin}/sw.js` },
        addEventListener() {},
      });
    });
    await page.goto('/');
    await page.waitForSelector('#home.active');
    const reloaded = page.waitForEvent('load');
    await page.evaluate(() => {
      navigator.serviceWorker.dispatchEvent(new Event('controllerchange'));
    });
    await reloaded;
    await page.waitForSelector('#home.active');
  });

  test('update banner refresh reloads when serviceWorker is missing', async ({ page }) => {
    await page.addInitScript(() => {
      Object.defineProperty(navigator, 'serviceWorker', {
        configurable: true,
        get() { return undefined; },
      });
    });
    const pageErrors = [];
    page.on('pageerror', (err) => pageErrors.push(String(err)));
    await page.goto('/');
    await page.waitForSelector('#home.active');
    await page.evaluate(() => {
      const banner = document.getElementById('update-banner');
      if (banner) banner.hidden = false;
    });
    await expect(page.locator('#update-banner')).toBeVisible();
    await page.evaluate(() => { window.__prawkoStay = 1; });
    await page.click('#update-banner-btn');
    await expect.poll(() => page.evaluate(() => window.__prawkoStay || 0)).toBe(0);
    await page.waitForSelector('#home.active');
    await expect(page.locator('#update-banner')).toBeHidden();
    expect(pageErrors).toEqual([]);
  });
});
