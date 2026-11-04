const { test, expect } = require('@playwright/test');
const { goToCategories, waitForQuestionBank } = require('./helpers');

test.describe('Question bank warm', () => {
  test('source warms questions.json and translations_pl before category entry', () => {
    const fs = require('fs');
    const path = require('path');
    const data = fs.readFileSync(path.join(__dirname, '../src/js/data.js'), 'utf8');
    const app = fs.readFileSync(path.join(__dirname, '../src/js/app.js'), 'utf8');
    expect(data).toMatch(/export function warmQuestionBank/);
    expect(data).toMatch(/export function isQuestionBankWarm/);
    expect(data).toMatch(/translations_pl\.json/);
    expect(app).toMatch(/warmQuestionBankForUi/);
    expect(app).toMatch(/setCategoryCardsBankPending/);
    expect(app).toMatch(/bankPending/);
  });

  test('category cards stay pending until the question bank is warm', async ({ page }) => {
    let releasePl;
    const plGate = new Promise((resolve) => { releasePl = resolve; });
    await page.route('**/data/translations_pl.json', async (route) => {
      await plGate;
      await route.continue();
    });
    await page.goto('/');
    await page.waitForSelector('#home.active');
    await page.click('#home [data-navigate="categories"]');
    await page.waitForSelector('#categories.active');
    const card = page.locator('.category-grid .category-card[data-category="B"]');
    await expect(card).toHaveClass(/bank-pending/);
    await expect.poll(async () => page.evaluate(async () => {
      const { isQuestionBankWarm } = await import(new URL('./js/data.js', location.href).href);
      return isQuestionBankWarm();
    })).toBe(false);
    await card.click({ force: true });
    await expect(page.locator('#categories.active')).toBeVisible();
    await expect(page.locator('#quiz.active')).toHaveCount(0);
    releasePl();
    await waitForQuestionBank(page);
    await expect(card).not.toHaveClass(/bank-pending/);
    await card.click();
    await page.waitForSelector('#quiz.active');
  });

  test('goToCategories waits for warm before returning', async ({ page }) => {
    await page.goto('/');
    await goToCategories(page);
    const warm = await page.evaluate(async () => {
      const { isQuestionBankWarm } = await import(new URL('./js/data.js', location.href).href);
      return isQuestionBankWarm();
    });
    expect(warm).toBe(true);
    await expect(page.locator('.category-card.bank-pending')).toHaveCount(0);
  });
});
