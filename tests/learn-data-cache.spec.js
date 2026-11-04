const { test, expect } = require('@playwright/test');

test.describe('Learn data cache', () => {
  test('status, profile switch, and clear stay consistent', async ({ page }) => {
    await page.goto('/');
    await page.waitForSelector('#home.active');
    const result = await page.evaluate(async () => {
      const stats = await import(new URL('./js/stats.js', location.href).href);
      const profiles = await import(new URL('./js/profiles.js', location.href).href);
      const q = { id: 42, correct: 'T' };
      const q2 = { id: 43, correct: 'N' };
      const original = profiles.getActiveProfileId();
      stats.clearLearnProgress();
      stats.saveLearnAnswer('B', 42, 'T', true);
      const learning = stats.getLearnQuestionStatus('B', q);
      stats.saveLearnAnswer('B', 42, 'T', true);
      const known = stats.getLearnQuestionStatus('B', q);
      stats.saveLearnAnswer('B', 43, 'T', false);
      stats.saveLearnAnswer('B', 43, 'T', false);
      const hard = stats.isLearnQuestionHard('B', q2);
      const breakdown = stats.getLearnCategoryBreakdown('B', [q, q2]);
      const chips = stats.getLearnUniqueFilterCounts([{ category: 'B', questions: [q, q2] }]);
      const created = profiles.createProfile('CacheCheck');
      const switched = stats.getLearnQuestionStatus('B', q);
      profiles.setActiveProfile(original);
      const back = stats.getLearnQuestionStatus('B', q);
      stats.clearLearnProgress();
      const cleared = stats.getLearnQuestionStatus('B', q);
      if (created) profiles.deleteProfile(created);
      return { learning, known, hard, breakdown, chips, switched, back, cleared };
    });
    expect(result.learning).toBe('learning');
    expect(result.known).toBe('known');
    expect(result.hard).toBe(true);
    expect(result.breakdown.known).toBe(1);
    expect(result.breakdown.hard).toBe(1);
    expect(result.chips.known).toBe(1);
    expect(result.chips.hard).toBe(1);
    expect(result.switched).toBe('new');
    expect(result.back).toBe('known');
    expect(result.cleared).toBe('new');
  });

  test('forget ages known answers after 30 and 60 days without rewriting storage', async ({ page }) => {
    await page.goto('/');
    await page.waitForSelector('#home.active');
    const result = await page.evaluate(async () => {
      const stats = await import(new URL('./js/stats.js', location.href).href);
      const profiles = await import(new URL('./js/profiles.js', location.href).href);
      const q = { id: 42, correct: 'T' };
      const day = 24 * 60 * 60 * 1000;
      const pid = profiles.getActiveProfileId();
      const key = `prawko_p_${pid}_learn`;
      stats.clearLearnProgress();
      profiles.setLearnForgetEnabled(false);
      stats.saveLearnAnswer('B', 42, 'T', true);
      stats.saveLearnAnswer('B', 42, 'T', true);
      const fresh = stats.getLearnQuestionStatus('B', q);
      const raw = JSON.parse(localStorage.getItem(key));
      raw.B[42].answeredAt = Date.now() - 31 * day;
      localStorage.setItem(key, JSON.stringify(raw));
      profiles.setActiveProfile(pid); // drop the in-memory learn cache
      profiles.setLearnForgetEnabled(true);
      const half = stats.getLearnQuestionStatus('B', q);
      const summaryHalf = stats.getProfileSummary().learnKnown;
      raw.B[42].answeredAt = Date.now() - 61 * day;
      localStorage.setItem(key, JSON.stringify(raw));
      profiles.setActiveProfile(pid);
      const full = stats.getLearnQuestionStatus('B', q);
      const summaryFull = stats.getProfileSummary().learnKnown;
      const stored = JSON.parse(localStorage.getItem(key)).B[42];
      profiles.setLearnForgetEnabled(false);
      const off = stats.getLearnQuestionStatus('B', q);
      stats.clearLearnProgress();
      profiles.setLearnForgetEnabled(false);
      return {
        fresh,
        half,
        full,
        off,
        summaryHalf,
        summaryFull,
        storedStreak: stored.streak,
        storedAnswer: stored.answer,
      };
    });
    expect(result.fresh).toBe('known');
    expect(result.half).toBe('learning');
    expect(result.full).toBe('new');
    expect(result.off).toBe('known');
    expect(result.summaryHalf).toBe(0);
    expect(result.summaryFull).toBe(0);
    expect(result.storedStreak).toBe(2);
    expect(result.storedAnswer).toBe('T');
  });
});
