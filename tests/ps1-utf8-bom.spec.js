const { test, expect } = require('@playwright/test');
const fs = require('fs');
const path = require('path');

function listPs1Files(dir, acc = []) {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    if (entry.name === 'node_modules' || entry.name === '.git') continue;
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) listPs1Files(full, acc);
    else if (entry.name.endsWith('.ps1')) acc.push(full);
  }
  return acc;
}

test('PowerShell scripts keep a UTF-8 BOM so Windows PowerShell 5.1 can parse them', () => {
  const root = path.resolve(__dirname, '..');
  const files = listPs1Files(root);
  expect(files.length).toBeGreaterThan(0);
  const missing = files
    .filter((file) => {
      const buf = fs.readFileSync(file);
      return !(buf.length >= 3 && buf[0] === 0xef && buf[1] === 0xbb && buf[2] === 0xbf);
    })
    .map((file) => path.relative(root, file).replace(/\\/g, '/'));
  expect(missing).toEqual([]);
});
