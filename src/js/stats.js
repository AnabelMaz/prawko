// stats.js — Exam history & learning progress persistence in localStorage

import { fetchCategory } from './data.js';
import { profileGet, profileSet, profileRemove, getProfileEpoch, getLearnForgetEnabled } from './profiles.js';

const STORAGE_KEY = 'prawko_stats';
const LEARN_KEY = 'prawko_learn';
const DAY_MS = 24 * 60 * 60 * 1000;
/** With forget on: known answers older than this act like a single correct streak. */
const LEARN_FORGET_HALF_DAYS = 30;
/** With forget on: known answers older than this act like never answered. */
const LEARN_FORGET_FULL_DAYS = 60;

/** Parallel to prawko_stats: compact answers[] per exam index (list stays summary-only). */
const HISTORY_ANSWERS_KEY = 'prawko_stats_answers';
/** Drop leftover duplicate of the latest history row (pre-split storage). */
const LEGACY_LAST_RESULT_KEY = 'prawko_last_result';

/** Two correct answers in a row — a miss resets the streak. */
const LEARN_KNOWN_STREAK = 2;

/** Lifetime wrong answers in learn before a question counts as hard. */
const LEARN_HARD_MISSES = 2;

/** Compact one scored exam item for profile storage (id + given + ok). */
export function compactExamAnswers(items) {
  if (!Array.isArray(items)) return [];
  const out = [];
  for (const item of items) {
    const id = item?.question?.id != null
      ? String(item.question.id)
      : (item?.id != null ? String(item.id) : '');
    if (!id) continue;
    const given = typeof item.given === 'string' && item.given ? item.given : null;
    const ok = given != null && (item.isCorrect === true || item.ok === true);
    out.push({ id, given, ok });
  }
  return out;
}

function normalizeCompactAnswer(raw) {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return null;
  const id = raw.id != null ? String(raw.id) : '';
  const given = typeof raw.given === 'string' && raw.given ? raw.given : null;
  const ok = given != null && raw.ok === true;
  return { id, given, ok };
}

function compactAnswersFromResult(result) {
  const answers = result?.answers;
  if (!Array.isArray(answers) || !answers.length) return null;
  if (answers[0]?.question || ('isCorrect' in answers[0] && !('ok' in answers[0]))) {
    const packed = compactExamAnswers(answers);
    return packed.length ? packed : null;
  }
  const packed = [];
  for (const raw of answers) {
    const entry = normalizeCompactAnswer(raw);
    if (entry) packed.push(entry);
  }
  return packed.length ? packed : null;
}

function examQuestionPoints(q) {
  const n = Number(q?.points);
  return n === 1 || n === 2 || n === 3 ? n : 1;
}

export function historyRowHasReview(row) {
  if (!row || typeof row !== 'object') return false;
  if (row.review === true) return true;
  return Array.isArray(row.answers) && row.answers.length > 0;
}

/**
 * Rebuild review rows from compact {id,given,ok} + current category bank.
 * Missing IDs keep status only (missing: true). Full in-memory exam answers pass through.
 */
export async function hydrateExamResult(row) {
  if (!row || typeof row !== 'object') return null;
  const rawAnswers = Array.isArray(row.answers) ? row.answers : [];
  if (!rawAnswers.length) return { ...row, answers: [] };
  if (rawAnswers[0]?.question || rawAnswers[0]?.missing === true) {
    return { ...row, answers: rawAnswers };
  }
  if ('isCorrect' in rawAnswers[0] && !('ok' in rawAnswers[0]) && rawAnswers[0]?.question) {
    return { ...row, answers: rawAnswers };
  }

  const byId = new Map();
  if (row.category) {
    try {
      const bank = await fetchCategory(row.category);
      for (const q of bank?.questions || []) {
        if (q?.id != null) byId.set(String(q.id), q);
      }
    } catch { /* all missing */ }
  }

  const answers = rawAnswers.map((raw) => {
    const entry = normalizeCompactAnswer(raw) || { id: '', given: null, ok: false };
    const given = entry.given;
    const isCorrect = entry.ok === true;
    const q = entry.id ? byId.get(entry.id) : null;
    if (!q) {
      return { question: null, given, isCorrect, points: 0, missing: true };
    }
    return {
      question: q,
      given,
      isCorrect,
      points: examQuestionPoints(q),
      missing: false,
    };
  });
  return { ...row, answers };
}

/** Hydrate compact storage rows; leave live/full exam answers alone. */
export async function ensureHydratedResult(result) {
  if (!result) return null;
  const answers = result.answers;
  if (!Array.isArray(answers) || !answers.length) return { ...result, answers: [] };
  if (answers[0]?.question || answers[0]?.missing === true) return result;
  if ('isCorrect' in answers[0] && !('ok' in answers[0])) return result;
  return hydrateExamResult(result);
}

function resultSummaryFields(result, date = new Date().toISOString()) {
  const answers = compactAnswersFromResult(result);
  return {
    date,
    category: result.category,
    score: result.score,
    maxPoints: result.maxPoints,
    passed: result.passed,
    basicScore: result.basicScore,
    specialistScore: result.specialistScore,
    review: Boolean(answers && answers.length),
  };
}

function isHistorySummaryRow(r) {
  return r
    && typeof r === 'object'
    && !Array.isArray(r)
    && typeof r.score === 'number'
    && typeof r.category === 'string';
}

function summaryFromStoredRow(r) {
  const answers = compactAnswersFromResult(r);
  const row = {
    date: r.date,
    category: r.category,
    score: r.score,
    maxPoints: r.maxPoints,
    passed: r.passed,
    basicScore: r.basicScore,
    specialistScore: r.specialistScore,
    review: r.review === true || Boolean(answers && answers.length),
  };
  return { row, answers: answers || [] };
}

function readHistoryAnswersList(expectedLen) {
  try {
    const parsed = JSON.parse(profileGet(HISTORY_ANSWERS_KEY) || '[]');
    if (!Array.isArray(parsed)) return Array.from({ length: expectedLen }, () => []);
    const out = parsed.map((item) => {
      if (!Array.isArray(item)) return [];
      return item.map(normalizeCompactAnswer).filter(Boolean);
    });
    while (out.length < expectedLen) out.push([]);
    if (out.length > expectedLen) out.length = expectedLen;
    return out;
  } catch {
    return Array.from({ length: expectedLen }, () => []);
  }
}

function persistHistory(summaries, answersList) {
  const okSummaries = profileSet(STORAGE_KEY, JSON.stringify(summaries));
  const okAnswers = profileSet(HISTORY_ANSWERS_KEY, JSON.stringify(answersList));
  try { profileRemove(LEGACY_LAST_RESULT_KEY); } catch { /* ignore */ }
  return okSummaries && okAnswers;
}

/**
 * Summaries in prawko_stats; compact answers in prawko_stats_answers (same index).
 * Migrates older rows that still embed answers[] (and drops legacy last_result).
 */
function loadHistoryParts() {
  try { profileRemove(LEGACY_LAST_RESULT_KEY); } catch { /* ignore */ }
  let parsed;
  try {
    parsed = JSON.parse(profileGet(STORAGE_KEY) || '[]');
  } catch {
    return { summaries: [], answersList: [] };
  }
  if (!Array.isArray(parsed)) return { summaries: [], answersList: [] };

  const raw = parsed.filter(isHistorySummaryRow);
  let dirty = false;
  const summaries = [];
  const embedded = [];
  for (const r of raw) {
    const { row, answers } = summaryFromStoredRow(r);
    if (Array.isArray(r.answers) && r.answers.length) dirty = true;
    if (r.review !== true && row.review) dirty = true;
    summaries.push(row);
    embedded.push(answers);
  }

  let answersList = readHistoryAnswersList(summaries.length);
  for (let i = 0; i < summaries.length; i++) {
    if (embedded[i].length) {
      if (!answersList[i].length) {
        answersList[i] = embedded[i];
        dirty = true;
      }
      if (!summaries[i].review) {
        summaries[i] = { ...summaries[i], review: true };
        dirty = true;
      }
    } else if (answersList[i].length && !summaries[i].review) {
      summaries[i] = { ...summaries[i], review: true };
      dirty = true;
    }
  }

  if (dirty && !persistHistory(summaries, answersList)) {
    console.warn('localStorage quota exceeded while migrating exam history');
  }
  return { summaries, answersList };
}

export function saveResult(result) {
  const { summaries, answersList } = loadHistoryParts();
  const summary = resultSummaryFields(result);
  const answers = compactAnswersFromResult(result) || [];
  summaries.push(summary);
  answersList.push(answers);
  if (!persistHistory(summaries, answersList)) {
    console.warn('localStorage quota exceeded while saving exam result');
    return false;
  }
  return true;
}

/** Summary rows only (no answers) — history list / stats chips. */
export function loadHistory() {
  return loadHistoryParts().summaries;
}

/** One exam with compact answers attached (hydrate on demand for #results). */
export function loadHistoryEntry(index) {
  const { summaries, answersList } = loadHistoryParts();
  const i = Number(index);
  if (!Number.isInteger(i) || i < 0 || i >= summaries.length) return null;
  const row = { ...summaries[i] };
  const answers = answersList[i] || [];
  if (answers.length) row.answers = answers;
  else delete row.answers;
  return row;
}

/** Newest exam in history (replaces legacy last_result). */
export function loadLatestHistoryEntry() {
  const { summaries } = loadHistoryParts();
  if (!summaries.length) return null;
  return loadHistoryEntry(summaries.length - 1);
}

/** Full history JSON (summaries + answers) for profile export packing. */
export function historyJsonForExport() {
  const { summaries, answersList } = loadHistoryParts();
  const merged = summaries.map((row, i) => {
    const out = { ...row };
    delete out.review;
    const answers = answersList[i] || [];
    if (answers.length) out.answers = answers;
    return out;
  });
  return JSON.stringify(merged);
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

/**
 * When forget is on, a known streak ages out: after 30 days like streak 1,
 * after 60 days like no answer. Storage is unchanged; only the effective view.
 */
function effectiveLearnEntry(entry, now = Date.now()) {
  if (!getLearnForgetEnabled()) return entry;
  const streak = entry.streak || 0;
  if (streak < LEARN_KNOWN_STREAK) return entry;
  if (!Number.isFinite(entry.answeredAt)) return entry;
  const ageMs = now - entry.answeredAt;
  if (ageMs >= LEARN_FORGET_FULL_DAYS * DAY_MS) {
    return { ...entry, answer: null, streak: 0 };
  }
  if (ageMs >= LEARN_FORGET_HALF_DAYS * DAY_MS) {
    return { ...entry, streak: 1 };
  }
  return entry;
}

function statusFromEntry(entry, question, answerOverride) {
  const view = effectiveLearnEntry(entry);
  const answer = answerOverride !== undefined ? answerOverride : view.answer;
  const streak = view.streak || 0;
  if (answer !== null && answer !== question.correct) return 'wrong';
  if (answer === question.correct && streak >= LEARN_KNOWN_STREAK) return 'known';
  if (answer === null) return 'new';
  return 'learning';
}

function hardFromEntry(entry, question, answerOverride) {
  const view = effectiveLearnEntry(entry);
  if ((view.misses || 0) < LEARN_HARD_MISSES) return false;
  return statusFromEntry(entry, question, answerOverride) !== 'known';
}

function isKnownStreak(entry, now = Date.now()) {
  const view = effectiveLearnEntry(entry, now);
  return (view.streak || 0) >= LEARN_KNOWN_STREAK;
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
        if (isKnownStreak(normalizeLearnEntry(raw))) learnKnown += 1;
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
  try { profileRemove(HISTORY_ANSWERS_KEY); } catch {}
  try { profileRemove(LEGACY_LAST_RESULT_KEY); } catch {}
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

// Draw order is independent of the learn filter.
// 0 (not stored) no saved answer. 1 saved answer, no answeredAt.
// Then oldest answeredAt first: >30, 16–30, 9–15, 5–8, 3–4, exactly 2, today and yesterday.
export const LEARN_DRAW_BAND_COUNT = 9;

function drawBand(days) {
  if (days > 30) return 2;
  if (days >= 16) return 3;
  if (days >= 9) return 4;
  if (days >= 5) return 5;
  if (days >= 3) return 6;
  if (days >= 2) return 7;
  return 8;
}

function savedAnswerText(raw) {
  if (typeof raw === 'string') return raw;
  if (raw && typeof raw === 'object' && typeof raw.answer === 'string') return raw.answer;
  return '';
}

export function getLearnDrawBands(category, now = Date.now()) {
  const map = new Map();
  const catData = loadLearnData()?.[category];
  if (!catData || Array.isArray(catData)) return map;
  const today = localDayIndex(now);
  for (const id of Object.keys(catData)) {
    const raw = catData[id];
    const stamp = raw && typeof raw === 'object' ? raw.answeredAt : null;
    if (Number.isFinite(stamp)) {
      let days = today - localDayIndex(stamp);
      if (days < 0) days = 0;
      map.set(id, drawBand(days));
      continue;
    }
    if (savedAnswerText(raw) !== '') map.set(id, 1);
  }
  return map;
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
// v2: "PXH2" + per exam (7B summary + uint8 n + n×(uint16 bankIndex + uint8 flags)).
// flags: low 3 bits given (0 skip, 1–5 T/N/A/B/C), bit 3 = ok. Index 0xFFFF = id gone from bank.
const EXAM_PACK_MAGIC = new Uint8Array([0x50, 0x58, 0x48, 0x32]); // PXH2
const EXAM_ANSWER_TOMBSTONE = 0xffff;
const EXAM_GIVEN_CODES = [null, 'T', 'N', 'A', 'B', 'C'];

function examGivenToCode(given) {
  if (!given) return 0;
  const i = EXAM_GIVEN_CODES.indexOf(given);
  return i > 0 ? i : 0;
}

function examCodeToGiven(code) {
  return EXAM_GIVEN_CODES[code & 7] || null;
}

function packExamAnswerFlags(given, ok) {
  return (examGivenToCode(given) & 7) | (ok ? 0x08 : 0);
}

function writeU16LE(bytes, offset, value) {
  bytes[offset] = value & 0xff;
  bytes[offset + 1] = (value >> 8) & 0xff;
}

function readU16LE(bytes, offset) {
  return bytes[offset] | (bytes[offset + 1] << 8);
}

function isExamPackV2(bytes) {
  if (!bytes || bytes.length < EXAM_PACK_MAGIC.length) return false;
  for (let i = 0; i < EXAM_PACK_MAGIC.length; i++) {
    if (bytes[i] !== EXAM_PACK_MAGIC[i]) return false;
  }
  return true;
}

async function bankIndexById(category, cache) {
  if (cache.has(category)) return cache.get(category);
  let map = new Map();
  let list = [];
  try {
    const bank = await fetchCategory(category);
    list = orderedQuestions(bank?.questions);
    list.forEach((q, index) => map.set(String(q.id), index));
  } catch {
    map = new Map();
    list = [];
  }
  const entry = { map, list };
  cache.set(category, entry);
  return entry;
}

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

/** Exam history JSON as one base64 strip. Empty history is an empty string. v1 if no answers; PXH2 when any row has review answers. */
export async function packExamHistoryForExport(raw) {
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

  const anyAnswers = visible.some((row) => historyRowHasReview(row));
  if (!anyAnswers) {
    const all = new Uint8Array(visible.length * EXAM_RECORD_BYTES);
    for (let i = 0; i < visible.length; i++) {
      const bytes = packExamRecordBytes(visible[i]);
      if (!bytes) return null;
      all.set(bytes, i * EXAM_RECORD_BYTES);
    }
    return bytesToBase64(all);
  }

  const bankCache = new Map();
  let size = EXAM_PACK_MAGIC.length;
  const prepared = [];
  for (const row of visible) {
    const header = packExamRecordBytes(row);
    if (!header) return null;
    const compact = Array.isArray(row.answers)
      ? row.answers.map(normalizeCompactAnswer).filter(Boolean)
      : [];
    const n = Math.min(compact.length, 255);
    size += EXAM_RECORD_BYTES + 1 + n * 3;
    prepared.push({ header, compact: compact.slice(0, n), category: row.category });
  }

  const out = new Uint8Array(size);
  out.set(EXAM_PACK_MAGIC, 0);
  let offset = EXAM_PACK_MAGIC.length;
  for (const item of prepared) {
    out.set(item.header, offset);
    offset += EXAM_RECORD_BYTES;
    out[offset] = item.compact.length;
    offset += 1;
    if (!item.compact.length) continue;
    const { map } = await bankIndexById(item.category, bankCache);
    for (const ans of item.compact) {
      const idx = map.has(ans.id) ? map.get(ans.id) : EXAM_ANSWER_TOMBSTONE;
      writeU16LE(out, offset, idx > 0xffff ? EXAM_ANSWER_TOMBSTONE : idx);
      out[offset + 2] = packExamAnswerFlags(ans.given, ans.ok);
      offset += 3;
    }
  }
  return bytesToBase64(out);
}

async function unpackExamHistoryV2(bytes) {
  const bankCache = new Map();
  const rows = [];
  let offset = EXAM_PACK_MAGIC.length;
  while (offset < bytes.length) {
    if (offset + EXAM_RECORD_BYTES + 1 > bytes.length) return null;
    const row = unpackExamRecord(bytes.subarray(offset, offset + EXAM_RECORD_BYTES));
    offset += EXAM_RECORD_BYTES;
    if (!row) return null;
    const n = bytes[offset];
    offset += 1;
    if (offset + n * 3 > bytes.length) return null;
    if (n > 0) {
      const { list } = await bankIndexById(row.category, bankCache);
      const answers = [];
      for (let i = 0; i < n; i++) {
        const index = readU16LE(bytes, offset);
        const flags = bytes[offset + 2];
        offset += 3;
        const given = examCodeToGiven(flags);
        const ok = (flags & 0x08) !== 0 && given != null;
        let id = '';
        if (index !== EXAM_ANSWER_TOMBSTONE && index < list.length) {
          id = String(list[index].id);
        }
        answers.push({ id, given, ok });
      }
      row.answers = answers;
    }
    rows.push(row);
  }
  return JSON.stringify(rows);
}

/** Packed exam strip back into the stored history array. */
export async function unpackExamHistoryFromImport(raw) {
  if (typeof raw !== 'string' || !raw || raw.trim().startsWith('[')) return null;
  let bytes;
  try {
    bytes = base64ToBytes(raw);
  } catch {
    return null;
  }
  if (!bytes.length) return null;
  if (isExamPackV2(bytes)) return unpackExamHistoryV2(bytes);
  if (bytes.length % EXAM_RECORD_BYTES !== 0) return null;
  const rows = [];
  for (let i = 0; i < bytes.length; i += EXAM_RECORD_BYTES) {
    const row = unpackExamRecord(bytes.subarray(i, i + EXAM_RECORD_BYTES));
    if (!row) return null;
    rows.push(row);
  }
  return JSON.stringify(rows);
}
