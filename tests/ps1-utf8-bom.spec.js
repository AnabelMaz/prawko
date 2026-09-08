const { test, expect } = require('@playwright/test');
const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');

function listPs1Files(dir = ROOT, acc = []) {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    if (entry.name === 'node_modules' || entry.name === '.git') continue;
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) listPs1Files(full, acc);
    else if (entry.name.endsWith('.ps1')) acc.push(full);
  }
  return acc;
}

function hasBom(buf) {
  return buf.length >= 3 && buf[0] === 0xef && buf[1] === 0xbb && buf[2] === 0xbf;
}

test('PowerShell scripts keep a UTF-8 BOM so Windows PowerShell 5.1 can parse them', () => {
  const files = listPs1Files();
  expect(files.length).toBeGreaterThan(0);
  const missing = files
    .filter((file) => !hasBom(fs.readFileSync(file)))
    .map((file) => path.relative(ROOT, file).replace(/\\/g, '/'));
  expect(missing).toEqual([]);
});

test('macOS/Linux pipeline scripts are Python, not Node or bash twins', () => {
  const scriptsDir = path.join(ROOT, 'scripts');
  const scripts = fs.readdirSync(scriptsDir);
  const requiredPy = [
    'download-gov.py',
    'parse-excel.py',
    'convert-media.py',
    'filter-no-media.py',
    'merge-gov.py',
    'upload-media.py',
    'build-media-packs.py',
    'upload-packs.py',
  ];
  for (const name of requiredPy) {
    expect(scripts).toContain(name);
  }
  expect(scripts.filter((name) => name.endsWith('.sh'))).toEqual([]);
  expect(scripts.filter((name) => name.endsWith('.js'))).toEqual([]);

  const macos = fs.readFileSync(path.join(ROOT, 'Install_Prawko.macos.sh'), 'utf8');
  const linux = fs.readFileSync(path.join(ROOT, 'Install_Prawko.linux.sh'), 'utf8');
  const windows = fs.readFileSync(path.join(ROOT, 'Install_Prawko.windows.ps1'), 'utf8');
  for (const text of [macos, linux]) {
    expect(text).not.toMatch(/merge-gov\.js/);
    expect(text).not.toMatch(/download-gov\.sh/);
    expect(text).not.toMatch(/convert-media\.sh/);
    expect(text).toMatch(/run_pipeline download-gov\.py/);
    expect(text).toMatch(/merge-gov\.py/);
    expect(text).toMatch(/python3 "\$path"/);
  }
  expect(linux).not.toMatch(/node -p /);
  expect(windows).not.toMatch(/python3 /);
  expect(windows).not.toMatch(/merge-gov\.js/);
  expect(windows).toMatch(/merge-gov\.ps1/);
  expect(windows).not.toMatch(/function Merge-GovExcelIntoDataFiles/);
  expect(scripts).toContain('merge-gov.ps1');
});
