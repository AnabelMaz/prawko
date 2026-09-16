const { test, expect } = require('@playwright/test');
const fs = require('fs');
const path = require('path');

const FONT = path.join(__dirname, '..', 'src', 'fonts', 'NotoSansSymbols-Regular.ttf');

function cmapHas(buf, codepoints) {
  const u16 = (i) => buf.readUInt16BE(i);
  const u32 = (i) => buf.readUInt32BE(i);
  const n = u16(4);
  let cmapOff;
  for (let i = 0; i < n; i++) {
    const off = 12 + i * 16;
    if (buf.toString('ascii', off, off + 4) === 'cmap') cmapOff = u32(off + 8);
  }
  expect(cmapOff, 'cmap table').toBeGreaterThan(0);
  const found = Object.fromEntries(codepoints.map((cp) => [cp, false]));
  const mark = (cp, gid) => {
    if (gid && Object.prototype.hasOwnProperty.call(found, cp)) found[cp] = true;
  };
  const num = u16(cmapOff + 2);
  for (let t = 0; t < num; t++) {
    const rec = cmapOff + 4 + t * 8;
    const sub = cmapOff + u32(rec + 4);
    const fmt = u16(sub);
    if (fmt === 4) {
      const segCount = u16(sub + 6) / 2;
      const endOff = sub + 14;
      const startOff = endOff + 2 * segCount + 2;
      const deltaOff = startOff + 2 * segCount;
      const rangeOff = deltaOff + 2 * segCount;
      for (const cp of codepoints) {
        for (let s = 0; s < segCount; s++) {
          const startC = u16(startOff + 2 * s);
          const endC = u16(endOff + 2 * s);
          if (cp < startC || cp > endC) continue;
          const idDelta = buf.readInt16BE(deltaOff + 2 * s);
          const idRange = u16(rangeOff + 2 * s);
          let gid = 0;
          if (idRange === 0) gid = (cp + idDelta) & 0xffff;
          else {
            const g = u16(rangeOff + 2 * s + idRange + 2 * (cp - startC));
            if (g) gid = (g + idDelta) & 0xffff;
          }
          mark(cp, gid);
        }
      }
    } else if (fmt === 12) {
      const nGroups = u32(sub + 12);
      for (let g = 0; g < nGroups; g++) {
        const go = sub + 16 + g * 12;
        const startC = u32(go);
        const endC = u32(go + 4);
        const startG = u32(go + 8);
        for (const cp of codepoints) {
          if (cp >= startC && cp <= endC) mark(cp, startG + (cp - startC));
        }
      }
    }
  }
  return found;
}

test('learn-mark font file contains U+2713 and U+2717 so Windows does not fall back to Segoe', () => {
  const buf = fs.readFileSync(FONT);
  expect(buf.length).toBeGreaterThan(1000);
  const found = cmapHas(buf, [0x2713, 0x2717]);
  expect(found).toEqual({ 0x2713: true, 0x2717: true });
});
