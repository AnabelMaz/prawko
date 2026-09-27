const { test, expect } = require('@playwright/test');
const { CAT_CARD_ASPECT, packCategoryGrid } = require('../src/js/category-pack.js');

test.describe('category card packing', () => {
  test('keeps the home-entry aspect for every grid', () => {
    const wide = packCategoryGrid(12, 1068, 458, 10);
    const short = packCategoryGrid(12, 1068, 320, 10);
    const tall = packCategoryGrid(12, 680, 900, 10);
    for (const pack of [wide, short, tall]) {
      expect(pack.cardW / pack.cardH).toBeCloseTo(CAT_CARD_ASPECT, 1);
    }
  });

  test('picks 4×3 when that yields the largest cards', () => {
    const pack = packCategoryGrid(12, 1068, 458, 10);
    expect(pack.cols).toBe(4);
    expect(pack.rows).toBe(3);
  });

  test('picks 6×2 on a short leftover instead of overflowing 4×3', () => {
    const pack = packCategoryGrid(12, 1068, 320, 10);
    expect(pack.cols).toBe(6);
    expect(pack.rows).toBe(2);
  });

  test('picks more rows than columns in a tall leftover', () => {
    const pack = packCategoryGrid(12, 680, 900, 10);
    expect(pack.rows).toBeGreaterThanOrEqual(pack.cols);
  });
});
