#!/usr/bin/env node
/**
 * Merge ministry Excel JSON into an existing src/data bank.
 * Same rules as Install_Prawko.windows.ps1 Merge-GovExcelIntoDataFiles:
 * match on question text; skip when media filename matches or (optional)
 * ffmpeg frames are ≥95% similar. New rows get id suffix -mi when taken.
 *
 *   node scripts/merge-gov.js --gov-dir DIR --out-dir DIR [--ffmpeg PATH] [--media-dir DIR]
 */

const fs = require("fs");
const path = require("path");
const { spawnSync } = require("child_process");

const CATEGORIES = ["A", "A1", "A2", "AM", "B", "B1", "C", "C1", "D", "D1", "PT", "T"];
const SIZE = 96;
const THRESHOLD = 0.95;
const EXAM = {
  totalQuestions: 32,
  basicQuestions: 20,
  specialistQuestions: 12,
  maxPoints: 74,
  passThreshold: 68,
  totalTimeSeconds: 1500,
  basicTimeSeconds: 20,
  specialistTimeSeconds: 50,
  basicPoints: [3, 3, 3, 3, 3, 3, 3, 3, 3, 3, 2, 2, 2, 2, 2, 2, 1, 1, 1, 1],
  specialistPoints: [3, 3, 3, 3, 3, 3, 2, 2, 2, 2, 1, 1],
};

function die(msg) {
  console.error(msg);
  process.exit(1);
}

function parseArgs(argv) {
  const out = { mediaDirs: [] };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    const next = () => argv[++i];
    if (a === "--gov-dir" || a === "--GovDir") out.govDir = next();
    else if (a === "--out-dir" || a === "--OutDir") out.outDir = next();
    else if (a === "--ffmpeg") out.ffmpeg = next();
    else if (a === "--ffprobe") out.ffprobe = next();
    else if (a === "--media-dir") out.mediaDirs.push(next());
    else if (a === "--help" || a === "-h") {
      console.log("merge-gov.js --gov-dir DIR --out-dir DIR [--ffmpeg PATH] [--media-dir DIR]");
      process.exit(0);
    } else die("Unknown argument: " + a);
  }
  if (!out.govDir || !out.outDir) die("Required: --gov-dir and --out-dir");
  return out;
}

function readJson(file) {
  return JSON.parse(fs.readFileSync(file, "utf8"));
}

function writeJson(file, data) {
  fs.writeFileSync(file, JSON.stringify(data, null, 2) + "\n", "utf8");
}

function textKey(text) {
  return String(text || "")
    .trim()
    .replace(/\s+/g, " ")
    .toLowerCase();
}

function mediaStem(media) {
  const name = path.basename(String(media || "").trim());
  if (!name) return "";
  return path.parse(name).name.toLowerCase();
}

function uniqueId(desired, existing) {
  let base = String(desired || "").trim() || "mi";
  if (!existing.has(base)) return base;
  let n = 1;
  let id;
  do {
    id = n === 1 ? `${base}-mi` : `${base}-mi${n}`;
    n++;
  } while (existing.has(id));
  return id;
}

function isVideoPath(p, question) {
  if (/\.(mp4|wmv|webm|mov)$/i.test(p)) return true;
  if (/\.(jpg|jpeg|webp|png)$/i.test(p)) return false;
  return String((question && question.mediaType) || "").toLowerCase() === "video";
}

function indexMedia(dirs) {
  const map = new Map();
  for (const dir of dirs) {
    if (!dir || !fs.existsSync(dir)) continue;
    for (const name of fs.readdirSync(dir)) {
      const full = path.join(dir, name);
      try {
        if (!fs.statSync(full).isFile()) continue;
      } catch {
        continue;
      }
      const stem = path.parse(name).name.toLowerCase();
      if (!map.has(stem)) map.set(stem, full);
    }
  }
  return map;
}

function resolveMediaPath(index, question) {
  const stem = mediaStem(question && question.media);
  if (!stem) return "";
  return index.get(stem) || "";
}

function durationSeconds(ffprobe, file) {
  const r = spawnSync(ffprobe, ["-v", "error", "-show_entries", "format=duration", "-of", "csv=p=0", file], {
    encoding: "utf8",
  });
  if (r.status !== 0) return 0;
  const n = parseFloat(String(r.stdout || "").trim());
  return Number.isFinite(n) ? n : 0;
}

function extractFrame(ffmpeg, file, startAt) {
  const r = spawnSync(
    ffmpeg,
    [
      "-y",
      "-hide_banner",
      "-loglevel",
      "error",
      "-ss",
      String(startAt),
      "-i",
      file,
      "-frames:v",
      "1",
      "-vf",
      `scale=${SIZE}:${SIZE}`,
      "-f",
      "rawvideo",
      "-pix_fmt",
      "rgb24",
      "pipe:1",
    ],
    { encoding: "buffer", maxBuffer: SIZE * SIZE * 3 + 1024 }
  );
  if (r.status !== 0 || !r.stdout || !r.stdout.length) return null;
  return Buffer.from(r.stdout);
}

const visualCache = new Map();

function visualSignature(ffmpeg, ffprobe, file, question) {
  const key = file;
  if (visualCache.has(key)) return visualCache.get(key);
  let buf;
  if (isVideoPath(file, question) && ffprobe) {
    const dur = durationSeconds(ffprobe, file);
    const times = dur > 0 ? [0.05, dur / 2, Math.max(0, dur - 0.05)] : [0, 0.5, 1];
    const parts = [];
    for (const t of times) {
      const frame = extractFrame(ffmpeg, file, t);
      if (frame) parts.push(frame);
    }
    buf = parts.length ? Buffer.concat(parts) : extractFrame(ffmpeg, file, 0);
  } else {
    buf = extractFrame(ffmpeg, file, 0);
  }
  visualCache.set(key, buf);
  return buf;
}

function rgbSimilarity(a, b) {
  if (!a || !b) return 0;
  const n = Math.min(a.length, b.length);
  if (!n) return 0;
  let acc = 0;
  for (let i = 0; i < n; i++) acc += Math.abs(a[i] - b[i]);
  return 1 - acc / (n * 255);
}

function visuallySame(ffmpeg, ffprobe, index, left, right) {
  const pathL = resolveMediaPath(index, left);
  const pathR = resolveMediaPath(index, right);
  if (!pathL || !pathR) return false;
  const sigL = visualSignature(ffmpeg, ffprobe, pathL, left);
  const sigR = visualSignature(ffmpeg, ffprobe, pathR, right);
  return rgbSimilarity(sigL, sigR) >= THRESHOLD;
}

function duplicateReason(q, candidates, ffmpeg, ffprobe, index) {
  if (!candidates || !candidates.length) return null;
  const newStem = mediaStem(q.media);
  for (const old of candidates) {
    const oldStem = mediaStem(old.media);
    if (newStem && oldStem && newStem === oldStem) return "filename";
    if (!newStem && !oldStem) return "text-only";
    if (ffmpeg && visuallySame(ffmpeg, ffprobe, index, q, old)) return "visual";
  }
  return null;
}

function main() {
  const args = parseArgs(process.argv.slice(2));
  const ffmpeg = args.ffmpeg && fs.existsSync(args.ffmpeg) ? args.ffmpeg : "";
  let ffprobe = args.ffprobe || "";
  if (ffmpeg && !ffprobe) {
    const sibling = path.join(path.dirname(ffmpeg), process.platform === "win32" ? "ffprobe.exe" : "ffprobe");
    if (fs.existsSync(sibling)) ffprobe = sibling;
  }
  const mediaIndex = indexMedia(args.mediaDirs);
  if (ffmpeg && !mediaIndex.size) {
    console.log("-> No local media — merge without frame comparison (filename only).");
  } else if (ffmpeg) {
    console.log(`-> Visual media comparison (FFmpeg ${SIZE}×${SIZE}, threshold ${Math.round(THRESHOLD * 100)}%).`);
  } else {
    console.log("-> No FFmpeg — merge without frame comparison (media filename only).");
  }

  let addedTotal = 0;
  const metaCategories = [];
  const useFfmpeg = ffmpeg && mediaIndex.size ? ffmpeg : "";

  for (const cat of CATEGORIES) {
    const src = path.join(args.govDir, `${cat}.json`);
    const dest = path.join(args.outDir, `${cat}.json`);
    if (!fs.existsSync(src)) die(`Missing ${src} — run parse-excel first.`);
    if (!fs.existsSync(dest)) die(`Missing ${dest} — merge needs the repo question bank.`);
    const incoming = readJson(src).questions || [];
    const data = readJson(dest);
    const existingIds = new Set();
    const byText = new Map();
    const list = [];
    for (const q of data.questions || []) {
      existingIds.add(String(q.id).trim());
      const tk = textKey(q.q);
      if (tk) {
        if (!byText.has(tk)) byText.set(tk, []);
        byText.get(tk).push(q);
      }
      list.push(q);
    }

    let added = 0;
    let skippedSame = 0;
    let skippedVisual = 0;
    let idRewritten = 0;
    for (const q of incoming) {
      const tk = textKey(q.q);
      if (!tk) continue;
      const candidates = byText.get(tk) || [];
      const why = duplicateReason(q, candidates, useFfmpeg, ffprobe, mediaIndex);
      if (why === "filename" || why === "text-only") {
        skippedSame++;
        continue;
      }
      if (why === "visual") {
        skippedVisual++;
        continue;
      }
      const newId = uniqueId(q.id, existingIds);
      const toAdd = { ...q };
      if (String(newId) !== String(q.id).trim()) {
        toAdd.id = newId;
        idRewritten++;
      }
      existingIds.add(String(toAdd.id).trim());
      if (!byText.has(tk)) byText.set(tk, []);
      byText.get(tk).push(toAdd);
      list.push(toAdd);
      added++;
    }

    const payload = { category: cat, questions: list };
    writeJson(dest, payload);
    const basic = list.filter((q) => q.type === "basic").length;
    const specialist = list.filter((q) => q.type === "specialist").length;
    metaCategories.push({
      id: cat,
      name: `Kategoria ${cat}`,
      questionCount: list.length,
      basicCount: basic,
      specialistCount: specialist,
    });
    addedTotal += added;
    const skipBits = [];
    if (skippedSame) skipBits.push(`same text+media: ${skippedSame}`);
    if (skippedVisual) skipBits.push(`same text+frames ≥95%: ${skippedVisual}`);
    if (idRewritten) skipBits.push(`new id (number taken): ${idRewritten}`);
    const skipNote = skipBits.length ? `, skipped ${skipBits.join(", ")}` : "";
    console.log(`  ${String(cat).padStart(3)}: +${String(added).padStart(4)} from ministry (total ${list.length}${skipNote})`);
  }

  const metaPath = path.join(args.outDir, "meta.json");
  let exam = EXAM;
  if (fs.existsSync(metaPath)) {
    const old = readJson(metaPath);
    if (old.exam) exam = old.exam;
    for (const cat of metaCategories) {
      const prev = (old.categories || []).find((c) => c.id === cat.id);
      if (prev && prev.name) cat.name = prev.name;
    }
  }
  writeJson(metaPath, { categories: metaCategories, exam });
  console.log(`-> Merge: added ${addedTotal} ministry questions that were not in the repo.`);
}

main();
