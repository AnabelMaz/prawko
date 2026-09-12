/** Shared Playwright helpers for the current Panel/WORD UI. */

async function goToCategories(page) {
  await page.waitForSelector('#home.active');
  const nav = page.locator('#home [data-navigate="categories"]');
  for (let attempt = 0; attempt < 3; attempt++) {
    await nav.click();
    try {
      await page.waitForSelector('#categories.active', { timeout: 8000 });
      return;
    } catch (err) {
      if (attempt === 2) throw err;
    }
  }
}

async function enablePracticeExam(page) {
  await page.addInitScript(() => {
    try { localStorage.setItem('prawko_p_p1_practice_exam', '1'); } catch {}
  });
}

async function recentCategoryIds(page) {
  return page.evaluate(() => {
    const raw = localStorage.getItem('prawko_p_p1_recent_categories')
      || localStorage.getItem('prawko_recent_categories')
      || '[]';
    try {
      const parsed = JSON.parse(raw);
      return Array.isArray(parsed) ? parsed : [];
    } catch {
      return [];
    }
  });
}

async function cycleLanguage(page) {
  await page.evaluate(() => document.querySelector('.lang-cycle')?.click());
}

async function cycleSkin(page) {
  await page.evaluate(() => document.querySelector('.skin-btn')?.click());
}

async function learnCatalogLabel(page) {
  const pos = await page.locator('.learn-qnum-input').inputValue();
  const suffix = (await page.locator('.learn-qnum-suffix').textContent() || '').replace(/\s+/g, ' ').trim();
  return `${pos}${suffix.startsWith('/') ? ' ' : ''}${suffix}`.replace(/\s+/g, ' ').trim();
}

async function waitForExamMediaAlign(page) {
  await page.waitForFunction(() => {
    const quiz = document.getElementById('quiz');
    const width = quiz?.style.getPropertyValue('--exam-media-width');
    return Boolean(width && parseFloat(width) > 8);
  });
}

module.exports = {
  goToCategories,
  enablePracticeExam,
  recentCategoryIds,
  cycleLanguage,
  cycleSkin,
  learnCatalogLabel,
  waitForExamMediaAlign,
};
