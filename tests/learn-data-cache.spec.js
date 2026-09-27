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
      const count = stats.getLearnKnownCount('B', [q, q2]);
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
      return { learning, known, count, hard, breakdown, chips, switched, back, cleared };
    });
    expect(result.learning).toBe('learning');
    expect(result.known).toBe('known');
    expect(result.count).toBe(1);
    expect(result.hard).toBe(true);
    expect(result.breakdown.known).toBe(1);
    expect(result.breakdown.hard).toBe(1);
    expect(result.chips.known).toBe(1);
    expect(result.chips.hard).toBe(1);
    expect(result.switched).toBe('new');
    expect(result.back).toBe('known');
    expect(result.cleared).toBe('new');
  });
});
