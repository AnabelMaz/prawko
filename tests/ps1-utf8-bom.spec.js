const { test, expect } = require('@playwright/test');
const { listPs1Files, missingBom, rel } = require('../scripts/ensure-ps1-bom.js');

test('PowerShell scripts keep a UTF-8 BOM so Windows PowerShell 5.1 can parse them', () => {
  const files = listPs1Files();
  expect(files.length).toBeGreaterThan(0);
  expect(missingBom(files).map(rel)).toEqual([]);
});
