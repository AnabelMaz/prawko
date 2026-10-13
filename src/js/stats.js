// stats.js — Exam history & learning progress persistence in localStorage

import { fetchCategory } from './data.js';
import { profileGet, profileSet, profileRemove, getProfileEpoch } from './profiles.js';

const STORAGE_KEY = 'prawko_stats';
const LEARN_KEY = 'prawko_learn';
const DAY_MS = 24 * 60 * 60 * 1000;

const LAST_RESULT_KEY = 'prawko_last_result';

/** Two correct answers in a row — a miss resets the streak. */
export const LEARN_KNOWN_STREAK = 2;

/** Lifetime wrong answers in learn before a question counts as hard. */
export const LEARN_HARD_MISSES = 2;

export function saveLastResult(result) {
  try {
    profileSet(LAST_RESULT_KEY, JSON.stringify(result));
    return true;
  } catch (e) {
    if (e?.name === 'QuotaExceededError' || e?.code === 22) {
      console.warn('localStorage quota exceeded while saving last exam result:', e);
    }
    return false;
  }
}

export function loadLastResult() {
  try {
    const parsed = JSON.parse(profileGet(LAST_RESULT_KEY));
    if (!parsed || typeof parsed !== 'object' || typeof parsed.score !== 'number') return null;
    if (!Array.isArray(parsed.answers)) parsed.answers = [];
    return parsed;
  } catch {
    return null;
  }
}

export function saveResult(result) {
  const history = loadHistory();
  history.push({
    date: new Date().toISOString(),
    category: result.category,
    score: result.score,
    maxPoints: result.maxPoints,
    passed: result.passed,
    basicScore: result.basicScore,
    specialistScore: result.specialistScore,
  });
  // Keep last 50 results
  if (history.length > 50) history.splice(0, history.length - 50);
  try {
    profileSet(STORAGE_KEY, JSON.stringify(history));
    return true;
  } catch (e) {
    if (e?.name === 'QuotaExceededError' || e?.code === 22) {
      console.warn('localStorage quota exceeded while saving exam result:', e);
    }
    return false;
  }
}

export function loadHistory() {
  try {
    const parsed = JSON.parse(profileGet(STORAGE_KEY));
    if (!Array.isArray(parsed)) return [];
    return parsed.filter(r =>
      typeof r === 'object' && r !== null &&
      typeof r.score === 'number' &&
      typeof r.category === 'string'
    );
  } catch {
    return [];
  }
}

export function getCategoryStats(category) {
  const history = loadHistory().filter(r => r.category === category);
  if (!history.length) return null;
  const passed = history.filter(r => r.passed).length;
  const lastScore = history[history.length - 1].score;
  const maxPoints = history[history.length - 1].maxPoints;
  return {
    attempts: history.length,
    passed,
    lastScore,
    maxPoints,
    lastPassed: history[history.length - 1].passed === true,
  };
}

export function getLearnKnownCount(category, questions) {
  if (!Array.isArray(questions) || !questions.length) return 0;
  const data = loadLearnData();
  let n = 0;
  for (const q of questions) {
    if (statusFromEntry(entryFromData(data, category, q.id), q) === 'known') n += 1;
  }
  return n;
}

function normalizeLearnEntry(raw) {
  if (typeof raw === 'object' && raw !== null && !Array.isArray(raw)) {
    const answer = typeof raw.answer === 'string' ? raw.answer : null;
    const streak = Number.isFinite(raw.streak) && raw.streak > 0
      ? Math.floor(raw.streak)
      : 0;
    const answeredAt = Number.isFinite(raw.answeredAt) ? raw.answeredAt : null;
    const misses = Number.isFinite(raw.misses) && raw.misses > 0
      ? Math.floor(raw.misses)
      : 0;
    return { answer, streak, answeredAt, misses };
  }
  return {
    answer: typeof raw === 'string' ? raw : null,
    streak: 0,
    answeredAt: null,
    misses: 0,
  };
}

export function saveLearnAnswer(category, questionId, answer, isCorrect = null) {
  const data = loadLearnData();
  if (typeof data[category] !== 'object' || Array.isArray(data[category])) {
    // Migrate from old array format
    const oldArr = Array.isArray(data[category]) ? data[category] : [];
    data[category] = {};
    oldArr.forEach(id => { data[category][id] = null; });
  }

  const prevEntry = normalizeLearnEntry(data[category][questionId]);
  const nextEntry = {
    answer: answer || null,
    streak: prevEntry.streak,
    answeredAt: Date.now(),
    misses: prevEntry.misses,
  };

  if (isCorrect === true) {
    nextEntry.streak = prevEntry.streak + 1;
  } else if (isCorrect === false) {
    nextEntry.streak = 0;
    nextEntry.misses = prevEntry.misses + 1;
  }

  data[category][questionId] = nextEntry;
  try {
    const written = profileSet(LEARN_KEY, JSON.stringify(data));
    if (!written) forgetLearnDataCache();
    else rememberLearnData(data);
    return true;
  } catch (e) {
    forgetLearnDataCache();
    if (e?.name === 'QuotaExceededError' || e?.code === 22) {
      console.warn('localStorage quota exceeded while saving learn progress:', e);
    }
    return false;
  }
}

let learnDataCache = null;
let learnDataCacheEpoch = -1;

function forgetLearnDataCache() {
  learnDataCache = null;
  learnDataCacheEpoch = -1;
}

function rememberLearnData(data) {
  learnDataCache = data;
  learnDataCacheEpoch = getProfileEpoch();
}

function loadLearnData() {
  const epoch = getProfileEpoch();
  if (learnDataCache && learnDataCacheEpoch === epoch) return learnDataCache;
  try {
    const parsed = JSON.parse(profileGet(LEARN_KEY));
    if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) {
      rememberLearnData({});
      return learnDataCache;
    }
    rememberLearnData(parsed);
    return learnDataCache;
  } catch {
    rememberLearnData({});
    return learnDataCache;
  }
}

function emptyLearnEntry() {
  return { answer: null, streak: 0, answeredAt: null, misses: 0 };
}

function entryFromData(data, category, questionId) {
  const catData = data?.[category];
  if (!catData || Array.isArray(catData)) return emptyLearnEntry();
  return normalizeLearnEntry(catData[questionId]);
}

function learnEntry(category, questionId) {
  return entryFromData(loadLearnData(), category, questionId);
}

function statusFromEntry(entry, question, answerOverride) {
  const answer = answerOverride !== undefined ? answerOverride : entry.answer;
  const streak = entry.streak || 0;
  if (answer !== null && answer !== question.correct) return 'wrong';
  if (answer === question.correct && streak >= LEARN_KNOWN_STREAK) return 'known';
  if (answer === null) return 'new';
  return 'learning';
}

function hardFromEntry(entry, question, answerOverride) {
  if ((entry.misses || 0) < LEARN_HARD_MISSES) return false;
  return statusFromEntry(entry, question, answerOverride) !== 'known';
}

export function getProfileSummary() {
  const history = loadHistory();
  const learn = loadLearnData();
  const ids = new Set();
  let learnKnown = 0;
  Object.values(learn).forEach((cat) => {
    if (!cat) return;
    if (Array.isArray(cat)) {
      cat.forEach((id) => ids.add(String(id)));
      return;
    }
    if (typeof cat === 'object') {
      Object.entries(cat).forEach(([id, raw]) => {
        ids.add(id);
        if (normalizeLearnEntry(raw).streak >= LEARN_KNOWN_STREAK) learnKnown += 1;
      });
    }
  });
  return {
    learnAnswered: ids.size,
    learnKnown,
    exams: history.length,
    examsPassed: history.filter((r) => r.passed).length,
  };
}

export function getLearnTouchedCategories() {
  const data = loadLearnData();
  return Object.keys(data).filter((id) => {
    const cat = data[id];
    if (!cat) return false;
    if (Array.isArray(cat)) return cat.length > 0;
    return typeof cat === 'object' && Object.keys(cat).length > 0;
  });
}

export function getLearnCategoryBreakdown(category, questions) {
  const list = Array.isArray(questions) ? questions : [];
  const data = loadLearnData();
  const counts = { total: list.length, known: 0, wrong: 0, hard: 0, learning: 0, neu: 0, answered: 0 };
  list.forEach((q) => {
    const entry = entryFromData(data, category, q.id);
    const status = statusFromEntry(entry, q);
    if (status === 'known') counts.known += 1;
    else if (status === 'wrong') counts.wrong += 1;
    else if (status === 'learning') counts.learning += 1;
    else counts.neu += 1;
    if (status !== 'new') counts.answered += 1;
    if (hardFromEntry(entry, q)) counts.hard += 1;
  });
  return counts;
}

/** Top summary chips: one count per question id across touched category banks. */
export function getLearnUniqueFilterCounts(categoryBanks) {
  const data = loadLearnData();
  const byId = new Map();
  for (const bank of categoryBanks || []) {
    const category = bank?.category;
    const list = Array.isArray(bank?.questions) ? bank.questions : [];
    for (const q of list) {
      if (!q || q.id == null || !category) continue;
      const id = String(q.id);
      const entry = entryFromData(data, category, q.id);
      const known = statusFromEntry(entry, q) === 'known';
      const hard = hardFromEntry(entry, q);
      const prev = byId.get(id);
      if (!prev) {
        byId.set(id, { known, hard });
        continue;
      }
      if (known) prev.known = true;
      if (hard) prev.hard = true;
    }
  }
  let known = 0;
  let hard = 0;
  for (const entry of byId.values()) {
    if (entry.known) known += 1;
    else if (entry.hard) hard += 1;
  }
  const total = byId.size;
  return { total, known, hard, unknown: total - known };
}

export function clearHistory() {
  try { profileRemove(STORAGE_KEY); } catch {}
}

export function clearLearnProgress() {
  try { profileRemove(LEARN_KEY); } catch {}
  rememberLearnData({});
}

export function getLearnProgress(category) {
  const data = loadLearnData();
  const catData = data[category];
  if (!catData) return 0;
  if (Array.isArray(catData)) return catData.length;
  return Object.keys(catData).length;
}

export function getLearnAnswerForQuestion(category, questionId) {
  return learnEntry(category, questionId).answer;
}

export function getLearnQuestionStatus(category, question, answerOverride) {
  return statusFromEntry(learnEntry(category, question.id), question, answerOverride);
}

export function isLearnQuestionHard(category, question, answerOverride) {
  return hardFromEntry(learnEntry(category, question.id), question, answerOverride);
}

// One byte per question, index = id order in that category.
// Low 3 bits: status. High 5 bits: whole local days from the answer to the export.
// 0 = today, 1–30 = that many days earlier, 31 = 31 or older.
// 000 none
// 001 learning, no misses
// 010 known, no misses
// 011 wrong, one miss
// 100 wrong and hard
// 101 learning and hard
// 110 learning, one miss
// 111 known, at least one miss
const LEARN_WRONG_MARK = '!';
const LEARN_DAY_CAP = 31;

function compareQuestionId(a, b) {
  const na = Number(a);
  const nb = Number(b);
  if (Number.isFinite(na) && Number.isFinite(nb) && na !== nb) return na - nb;
  return String(a).localeCompare(String(b), 'en');
}

function orderedQuestions(questions) {
  const sorted = (Array.isArray(questions) ? questions : [])
    .filter((q) => q && q.id != null)
    .slice()
    .sort((a, b) => compareQuestionId(a.id, b.id));
  const out = [];
  const seen = new Set();
  for (const q of sorted) {
    const id = String(q.id);
    if (seen.has(id)) continue;
    seen.add(id);
    out.push(q);
  }
  return out;
}

function codeFromEntry(entry, question) {
  const status = statusFromEntry(entry, question);
  const misses = entry.misses || 0;
  if (status === 'new') return 0;
  if (status === 'known') return misses >= 1 ? 7 : 2;
  if (status === 'learning') {
    if (misses >= LEARN_HARD_MISSES) return 5;
    if (misses >= 1) return 6;
    return 1;
  }
  if (status === 'wrong') return misses >= LEARN_HARD_MISSES ? 4 : 3;
  return 0;
}

function entryFromCode(code, question) {
  const correct = question.correct;
  if (code === 1) return { answer: correct, streak: 1, misses: 0 };
  if (code === 2) return { answer: correct, streak: 2, misses: 0 };
  if (code === 3) return { answer: LEARN_WRONG_MARK, streak: 0, misses: 1 };
  if (code === 4) return { answer: LEARN_WRONG_MARK, streak: 0, misses: 2 };
  if (code === 5) return { answer: correct, streak: 1, misses: 2 };
  if (code === 6) return { answer: correct, streak: 1, misses: 1 };
  if (code === 7) return { answer: correct, streak: 2, misses: 1 };
  return null;
}

function localDayIndex(ms) {
  const d = new Date(ms);
  return Math.floor(Date.UTC(d.getFullYear(), d.getMonth(), d.getDate()) / DAY_MS);
}

function daysSinceAnswer(stamp, now) {
  if (!Number.isFinite(stamp)) return 0;
  const days = localDayIndex(now) - localDayIndex(stamp);
  if (days <= 0) return 0;
  if (days > 30) return LEARN_DAY_CAP;
  return days;
}

function answeredAtFromDays(days, now) {
  const d = new Date(now);
  d.setHours(0, 0, 0, 0);
  d.setDate(d.getDate() - days);
  return d.getTime();
}

function answerStamp(entry, now) {
  if (Number.isFinite(entry.answeredAt)) return entry.answeredAt;
  return now;
}

function packLearnByte(code, days) {
  return ((days & 31) << 3) | (code & 7);
}

function bytesToBase64(bytes) {
  let bin = '';
  for (let i = 0; i < bytes.length; i++) bin += String.fromCharCode(bytes[i]);
  return btoa(bin);
}

function base64ToBytes(text) {
  const bin = atob(text);
  const bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
  return bytes;
}

/** Learn JSON from the profile, as a base64 strip per category that has any answer. */
export async function packLearnForExport(raw) {
  let data;
  try {
    data = raw ? JSON.parse(raw) : {};
  } catch {
    return null;
  }
  if (!data || typeof data !== 'object' || Array.isArray(data)) return null;
  const packed = {};
  for (const cat of Object.keys(data).sort()) {
    const entries = data[cat];
    if (!entries || typeof entries !== 'object') continue;
    if (Array.isArray(entries)) return null;
    if (!Object.keys(entries).length) continue;
    let bank;
    try {
      bank = await fetchCategory(cat);
    } catch {
      return null;
    }
    const questions = orderedQuestions(bank?.questions);
    const now = Date.now();
    const bytes = new Uint8Array(questions.length);
    let any = false;
    questions.forEach((q, index) => {
      const rawEntry = entries[String(q.id)];
      if (rawEntry == null) return;
      const entry = normalizeLearnEntry(rawEntry);
      const code = codeFromEntry(entry, q);
      if (!code) return;
      bytes[index] = packLearnByte(code, daysSinceAnswer(answerStamp(entry, now), now));
      any = true;
    });
    if (!any) continue;
    packed[cat] = bytesToBase64(bytes);
  }
  return JSON.stringify(packed);
}

/** Packed learn string back into the stored per-question records. */
export async function unpackLearnFromImport(raw) {
  let packed;
  try {
    packed = JSON.parse(raw);
  } catch {
    return null;
  }
  if (!packed || typeof packed !== 'object' || Array.isArray(packed)) return null;
  const out = {};
  for (const [cat, b64] of Object.entries(packed)) {
    if (!/^[A-Z][A-Z0-9]{0,3}$/.test(cat) || typeof b64 !== 'string' || !b64) return null;
    let bytes;
    try {
      bytes = base64ToBytes(b64);
    } catch {
      return null;
    }
    let bank;
    try {
      bank = await fetchCategory(cat);
    } catch {
      return null;
    }
    const questions = orderedQuestions(bank?.questions);
    if (!questions.length || bytes.length !== questions.length) return null;
    const now = Date.now();
    const catOut = {};
    questions.forEach((q, index) => {
      const byte = bytes[index];
      const entry = entryFromCode(byte & 7, q);
      if (!entry) return;
      entry.answeredAt = answeredAtFromDays(byte >> 3, now);
      catOut[String(q.id)] = entry;
    });
    if (Object.keys(catOut).length) out[cat] = catOut;
  }
  return JSON.stringify(out);
}

// One exam is 7 bytes, low bits first. Passed is derived from the points.
// 4 category, 6 basic, 5 specialist, 7 max points, 32 minute since 1970, 1 parts flag, 1 spare.
const EXAM_CATEGORIES = ['A', 'A1', 'A2', 'AM', 'B', 'B1', 'C', 'C1', 'D', 'D1', 'PT', 'T'];
const EXAM_PASS_AT_FULL = 68;
const EXAM_FULL_POINTS = 74;
const EXAM_RECORD_BYTES = 7;

function examPassed(score, maxPoints) {
  const threshold = maxPoints === EXAM_FULL_POINTS
    ? EXAM_PASS_AT_FULL
    : Math.round(EXAM_PASS_AT_FULL * (maxPoints / EXAM_FULL_POINTS));
  return score >= threshold;
}

function writeBits(bytes, offset, value, width) {
  for (let b = 0; b < width; b++) {
    if (Math.floor(value / 2 ** b) % 2 === 0) continue;
    const pos = offset + b;
    bytes[pos >> 3] |= 1 << (pos & 7);
  }
}

function readBits(bytes, offset, width) {
  let value = 0;
  for (let b = 0; b < width; b++) {
    const pos = offset + b;
    if (((bytes[pos >> 3] >>> (pos & 7)) & 1) === 0) continue;
    value += 2 ** b;
  }
  return value;
}

function examMinute(date) {
  const ms = Date.parse(date);
  if (!Number.isFinite(ms) || ms < 0) return null;
  const minute = Math.floor(ms / 60000);
  if (minute > 0xFFFFFFFF) return null;
  return minute;
}

function packExamRecordBytes(raw) {
  const category = EXAM_CATEGORIES.indexOf(raw.category);
  if (category < 0) return null;
  if (!Number.isInteger(raw.maxPoints) || raw.maxPoints < 0 || raw.maxPoints > 127) return null;
  const minute = examMinute(raw.date);
  if (minute == null) return null;

  let basic = 0;
  let specialist = 0;
  let hasParts = 0;
  const parts = Number.isInteger(raw.basicScore) && Number.isInteger(raw.specialistScore);
  if (parts) {
    if (raw.basicScore < 0 || raw.basicScore > 63) return null;
    if (raw.specialistScore < 0 || raw.specialistScore > 31) return null;
    basic = raw.basicScore;
    specialist = raw.specialistScore;
    hasParts = 1;
  } else if (Number.isInteger(raw.score) && raw.score >= 0 && raw.score <= 2047) {
    basic = raw.score & 63;
    specialist = raw.score >> 6;
  } else {
    return null;
  }

  const bytes = new Uint8Array(EXAM_RECORD_BYTES);
  let bit = 0;
  const put = (value, width) => {
    writeBits(bytes, bit, value, width);
    bit += width;
  };
  put(category, 4);
  put(basic, 6);
  put(specialist, 5);
  put(raw.maxPoints, 7);
  put(minute, 32);
  put(hasParts, 1);
  return bytes;
}

function unpackExamRecord(bytes) {
  let bit = 0;
  const take = (width) => {
    const value = readBits(bytes, bit, width);
    bit += width;
    return value;
  };
  const category = EXAM_CATEGORIES[take(4)];
  const basic = take(6);
  const specialist = take(5);
  const maxPoints = take(7);
  const minute = take(32);
  const hasParts = take(1);
  if (!category) return null;
  const score = hasParts ? basic + specialist : basic + (specialist << 6);
  const row = {
    date: new Date(minute * 60000).toISOString(),
    category,
    score,
    maxPoints,
    passed: examPassed(score, maxPoints),
  };
  if (hasParts) {
    row.basicScore = basic;
    row.specialistScore = specialist;
  }
  return row;
}

/** Exam history JSON as one base64 strip. Empty history is an empty string. */
export function packExamHistoryForExport(raw) {
  let parsed;
  try {
    parsed = raw ? JSON.parse(raw) : [];
  } catch {
    return null;
  }
  if (!Array.isArray(parsed)) return null;
  const visible = parsed.filter((row) => (
    row && typeof row === 'object' && typeof row.score === 'number' && typeof row.category === 'string'
  ));
  if (!visible.length) return '';
  const all = new Uint8Array(visible.length * EXAM_RECORD_BYTES);
  for (let i = 0; i < visible.length; i++) {
    const bytes = packExamRecordBytes(visible[i]);
    if (!bytes) return null;
    all.set(bytes, i * EXAM_RECORD_BYTES);
  }
  return bytesToBase64(all);
}

/** Packed exam strip back into the stored history array. */
export function unpackExamHistoryFromImport(raw) {
  if (typeof raw !== 'string' || !raw || raw.trim().startsWith('[')) return null;
  let bytes;
  try {
    bytes = base64ToBytes(raw);
  } catch {
    return null;
  }
  if (!bytes.length || bytes.length % EXAM_RECORD_BYTES !== 0) return null;
  const rows = [];
  for (let i = 0; i < bytes.length; i += EXAM_RECORD_BYTES) {
    const row = unpackExamRecord(bytes.subarray(i, i + EXAM_RECORD_BYTES));
    if (!row) return null;
    rows.push(row);
  }
  return JSON.stringify(rows);
}
