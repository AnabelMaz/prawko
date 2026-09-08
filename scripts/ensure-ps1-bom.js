#!/usr/bin/env node
'use strict';

const fs = require('fs');
const path = require('path');

const BOM = Buffer.from([0xef, 0xbb, 0xbf]);
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

function rel(file) {
  return path.relative(ROOT, file).replace(/\\/g, '/');
}

function missingBom(files = listPs1Files()) {
  return files.filter((file) => !hasBom(fs.readFileSync(file)));
}

function ensureBom(files = listPs1Files()) {
  const fixed = [];
  for (const file of files) {
    const buf = fs.readFileSync(file);
    if (hasBom(buf)) continue;
    fs.writeFileSync(file, Buffer.concat([BOM, buf]));
    fixed.push(file);
  }
  return fixed;
}

module.exports = { ROOT, listPs1Files, hasBom, missingBom, ensureBom, rel };

if (require.main === module) {
  const check = process.argv.includes('--check');
  const files = listPs1Files();
  if (!files.length) {
    console.error('No .ps1 files found');
    process.exit(1);
  }
  if (check) {
    const missing = missingBom(files);
    if (missing.length) {
      console.error('UTF-8 BOM missing (Windows PowerShell 5.1):');
      for (const file of missing) console.error('  ' + rel(file));
      console.error('Run: node scripts/ensure-ps1-bom.js');
      process.exit(1);
    }
    process.exit(0);
  }
  for (const file of ensureBom(files)) console.log('BOM ' + rel(file));
}
