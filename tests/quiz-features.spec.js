const { test, expect } = require('@playwright/test');

// Helper: navigate to categories and start learn mode for category B
async function startLearnMode(page) {
  await page.goto('/');
  await page.waitForSelector('#home.active');
  await page.click('[data-navigate="categories"]');
  await page.waitForSelector('#categories.active');
  // Ensure "Nauka" mode is selected (default)
  await page.click('.mode-btn[data-mode="learn"]');
  await page.click('.category-grid .category-card[data-category="B"]');
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
    expect(backBox.x).toBeLessThan(tableBox.x + 8);
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
    await page.click('.quiz-back');
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
      return video ? { muted: video.muted, autoplay: video.autoplay } : null;
    });

    if (hasVideo) {
      expect(hasVideo.muted).toBe(true);
      expect(hasVideo.autoplay).toBe(true);
    } else {
      // No video on first question - verify the attributes are set in the source code
      // by checking that the renderQuestion function sets them
      const uiSource = await page.evaluate(async () => {
        const resp = await fetch('/js/ui.js');
        return resp.text();
      });
      expect(uiSource).toContain('video.muted = true');
      expect(uiSource).toContain('video.autoplay = true');
    }
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

test.describe('Language switch during quiz', () => {
  test('language switch updates html lang and radio state', async ({ page }) => {
    await page.goto('/');
    await page.waitForSelector('#home.active');

    await expect(page.locator('html')).toHaveAttribute('lang', 'pl');
    await expect(page.locator('.lang-btn[data-lang="pl"]')).toHaveAttribute('aria-checked', 'true');
    await expect(page.locator('.lang-btn[data-lang="en"]')).toHaveAttribute('aria-checked', 'false');

    await page.click('.lang-btn[data-lang="en"]');

    await expect(page.locator('html')).toHaveAttribute('lang', 'en');
    await expect(page.locator('.lang-btn[data-lang="pl"]')).toHaveAttribute('aria-checked', 'false');
    await expect(page.locator('.lang-btn[data-lang="en"]')).toHaveAttribute('aria-checked', 'true');
  });

  test('switching language updates question text in learn mode', async ({ page }) => {
    await startLearnMode(page);

    // Get the Polish question text
    const questionTextPl = await page.textContent('.question-text');
    expect(questionTextPl.length).toBeGreaterThan(0);

    // Switch to English
    await page.click('.lang-btn[data-lang="en"]');
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
    await page.click('.lang-btn[data-lang="en"]');
    await page.waitForTimeout(500);

    const answersEn = await page.evaluate(() =>
      [...document.querySelectorAll('.answer-btn')].map(b => b.textContent.trim())
    );

    // For basic questions: TAK/NIE → YES/NO
    // For specialist: answer text should be translated
    expect(answersEn).not.toEqual(answersPl);
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
    await page.click('.lang-btn[data-lang="en"]');
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
    expect(prevPl).toBe('Poprzednie');

    await page.click('.lang-btn[data-lang="en"]');
    await page.waitForTimeout(500);

    const prevEn = await page.textContent('.btn-prev');
    expect(prevEn).toBe('Previous');
  });

  test('switching language updates question text in exam mode', async ({ page }) => {
    await startExamMode(page);

    const questionTextPl = await page.textContent('.question-text');
    expect(questionTextPl.length).toBeGreaterThan(0);

    // Switch to English
    await page.click('.lang-btn[data-lang="en"]');
    await page.waitForTimeout(500);

    const questionTextEn = await page.textContent('.question-text');
    expect(questionTextEn.length).toBeGreaterThan(0);
    expect(questionTextEn).not.toBe(questionTextPl);
  });
});

test.describe('Learn queue filter', () => {
  test('learn mode has all/unknown/new/wrong/known and sequential/random controls', async ({ page }) => {
    await startLearnMode(page);
    const filter = page.locator('.learn-filter-select');
    const order = page.locator('.learn-order-select');
    await expect(filter).toBeVisible();
    await expect(order).toBeVisible();
    await expect(filter.locator('[role="option"]')).toHaveCount(5);
    await expect(order.locator('[role="option"]')).toHaveCount(2);
    await expect(filter).toHaveAttribute('data-value', 'unknown');
    await expect(order).toHaveAttribute('data-value', 'random');
    await expect(page.locator('.learn-stats-known')).toBeVisible();
  });

  test('learn queue menus stay square in both exam skins', async ({ page }) => {
    await startLearnMode(page);
    await page.click('.learn-filter-select .learn-queue-select');
    const menu = page.locator('.learn-filter-select .learn-queue-menu');
    await expect(menu).toBeVisible();
    const image = await menu.evaluate((el) => getComputedStyle(el).borderTopLeftRadius);
    expect(parseFloat(image)).toBe(0);
    await page.locator('.skin-btn').click({ force: true });
    await page.click('.learn-filter-select .learn-queue-select');
    await expect(menu).toBeVisible();
    const pwpw = await menu.evaluate((el) => getComputedStyle(el).borderTopLeftRadius);
    expect(parseFloat(pwpw)).toBe(0);
  });

  test('learn always shows unanswered buttons even after going back', async ({ page }) => {
    await startLearnMode(page);
    const firstBtn = page.locator('.answer-btn').first();
    await expect(firstBtn).toBeEnabled();
    await firstBtn.click();
    await expect(page.locator('.answer-btn.correct')).toHaveCount(1);
    await page.click('.btn-next');
    await page.waitForSelector('.answer-btn');
    await page.click('.btn-prev');
    await expect(page.locator('.answer-btn').first()).toBeEnabled();
    await expect(page.locator('.answer-btn.correct, .answer-btn.incorrect')).toHaveCount(0);
  });

  test('random walks a list shuffled once; toggling order keeps the question and its new index', async ({ page }) => {
    await startLearnMode(page);
    await setLearnQueue(page, 'order', 'sequential');
    await setLearnQueue(page, 'filter', 'all');
    await expect(page.locator('.question-card')).toHaveAttribute('data-question-id', /./);

    const catalog = await page.evaluate(async () => {
      const data = await fetch('data/B.json').then((res) => res.json());
      return data.questions.map((q) => String(q.id));
    });
    const startId = await page.locator('.question-card').getAttribute('data-question-id');
    expect(startId).toBe(catalog[0]);
    const startTotal = (await page.locator('.question-progress').textContent()).split(' / ')[1];
    expect(Number(startTotal)).toBe(catalog.length);

    await setLearnQueue(page, 'order', 'random');
    await expect(page.locator('.question-card')).toHaveAttribute('data-question-id', startId);
    await expect(page.locator('.question-progress')).toHaveText(`1 / ${startTotal}`);

    const randomWalk = [startId];
    const catalogNums = [1];
    for (let i = 0; i < 8; i++) {
      const prev = randomWalk[randomWalk.length - 1];
      await page.click('.btn-next');
      await expect(page.locator('.question-card')).not.toHaveAttribute('data-question-id', prev);
      const id = await page.locator('.question-card').getAttribute('data-question-id');
      randomWalk.push(id);
      const num = Number((await page.locator('.question-progress').textContent()).split(' / ')[0]);
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
    await expect(page.locator('.question-progress')).toHaveText(`1 / ${startTotal}`);

    await setLearnQueue(page, 'order', 'sequential');
    await expect(page.locator('.question-card')).toHaveAttribute('data-question-id', startId);
    await expect(page.locator('.question-progress')).toHaveText(`1 / ${startTotal}`);
    await setLearnQueue(page, 'order', 'random');
    await expect(page.locator('.question-card')).toHaveAttribute('data-question-id', startId);
    await expect(page.locator('.question-progress')).toHaveText(`1 / ${startTotal}`);
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
    await expect(page.locator('.question-progress')).toHaveText(`${randomCatalogPos} / ${catalog.length}`);

    await setLearnQueue(page, 'order', 'sequential');
    await expect(page.locator('.question-card')).toHaveAttribute('data-question-id', randomId);
    const catalogIndex = catalog.indexOf(randomId);
    expect(catalogIndex).toBeGreaterThan(0);
    await expect(page.locator('.question-progress')).toHaveText(`${catalogIndex + 1} / ${catalog.length}`);

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
    await expect(page.locator('.profile-stat-learn')).toHaveText('Nauka: 0');
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
    await expect(page.locator('.profile-stat-learn')).toHaveText('Nauka: 0');
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
    await page.click('.lang-btn[data-lang="en"]');
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
    await page.click('.lang-btn[data-lang="en"]');
    await expect(page.locator('.profile-toggle-name')).toHaveText('Me');
    await page.click('.profile-toggle');
    await expect(page.locator('.profile-list-btn')).toHaveText(['Me']);
  });
});

test.describe('Language fallback', () => {
  test.use({ locale: 'de-DE' });

  test('unsupported browser language uses English', async ({ page }) => {
    await page.goto('/');
    await page.waitForSelector('#home.active');
    await expect(page.locator('.profile-toggle-name')).toHaveText('Me');
    await expect(page.locator('[data-navigate="categories"]').first()).toHaveText('Start');
    await page.click('.profile-toggle');
    await expect(page.locator('.profile-action-new')).toHaveText('New');
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
    await page.click('.quiz-back');
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
    expect(navBox.y + navBox.height).toBeLessThanOrEqual(reviewBox.y + 2);
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
