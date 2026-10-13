const { test, expect } = require('@playwright/test');

test('category file lists ids and fetchCategory still returns Polish text', async ({ page }) => {
  await page.goto('/');
  const result = await page.evaluate(async () => {
    const bank = await fetch('data/B.json').then((res) => res.json());
    const facts = await fetch('data/questions.json').then((res) => res.json());
    const polish = await fetch('data/translations_pl.json').then((res) => res.json());
    const id = bank.questionIds && bank.questionIds[0];
    const { fetchCategory } = await import(new URL('./js/data.js', location.href).href);
    const joined = await fetchCategory('B');
    const first = joined.questions[0];
    return {
      hasIds: Array.isArray(bank.questionIds) && !bank.questions,
      noQuestionText: !JSON.stringify(bank).includes('"q"'),
      hasFact: Boolean(facts[String(id)] && facts[String(id)].type),
      hasText: Boolean(polish[String(id)] && polish[String(id)].q),
      count: joined.questions.length,
      q: first && first.q,
      type: first && first.type,
      id: first && first.id,
    };
  });
  expect(result.hasIds).toBe(true);
  expect(result.noQuestionText).toBe(true);
  expect(result.hasFact).toBe(true);
  expect(result.hasText).toBe(true);
  expect(result.count).toBeGreaterThan(1000);
  expect(String(result.q || '').length).toBeGreaterThan(5);
  expect(result.type).toBeTruthy();
  expect(result.id).toBeTruthy();
});
