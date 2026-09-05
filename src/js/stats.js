// stats.js — Exam history & learning progress persistence in localStorage

import { profileGet, profileSet, profileRemove } from './profiles.js';

const STORAGE_KEY = 'prawko_stats';
const LEARN_KEY = 'prawko_learn';
const DAY_MS = 24 * 60 * 60 * 1000;

const LAST_RESULT_KEY = 'prawko_last_result';

/** Two correct answers in a row — a miss resets the streak. */
export const LEARN_KNOWN_STREAK = 2;

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
  return questions.filter((q) => getLearnQuestionStatus(category, q) === 'known').length;
}

function normalizeLearnEntry(raw) {
  if (typeof raw === 'object' && raw !== null && !Array.isArray(raw)) {
    const answer = typeof raw.answer === 'string' ? raw.answer : null;
    const streak = Number.isFinite(raw.streak) && raw.streak > 0
      ? Math.floor(raw.streak)
      : 0;
    const dueAt = Number.isFinite(raw.dueAt) ? raw.dueAt : null;
    return { answer, streak, dueAt };
  }
  return {
    answer: typeof raw === 'string' ? raw : null,
    streak: 0,
    dueAt: null,
  };
}

function getNextDueAt(streak) {
  const intervalDays = Math.min(30, 2 ** Math.max(0, streak - 1));
  return Date.now() + intervalDays * DAY_MS;
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
    dueAt: prevEntry.dueAt,
  };

  if (isCorrect === true) {
    nextEntry.streak = prevEntry.streak + 1;
    nextEntry.dueAt = getNextDueAt(nextEntry.streak);
  } else if (isCorrect === false) {
    nextEntry.streak = 0;
    nextEntry.dueAt = Date.now();
  }

  data[category][questionId] = nextEntry;
  try {
    profileSet(LEARN_KEY, JSON.stringify(data));
    return true;
  } catch (e) {
    if (e?.name === 'QuotaExceededError' || e?.code === 22) {
      console.warn('localStorage quota exceeded while saving learn progress:', e);
    }
    return false;
  }
}

function loadLearnData() {
  try {
    const parsed = JSON.parse(profileGet(LEARN_KEY));
    if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) return {};
    return parsed;
  } catch {
    return {};
  }
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
  const counts = { total: list.length, known: 0, wrong: 0, learning: 0, neu: 0, answered: 0 };
  list.forEach((q) => {
    const status = getLearnQuestionStatus(category, q);
    if (status === 'known') counts.known += 1;
    else if (status === 'wrong') counts.wrong += 1;
    else if (status === 'learning') counts.learning += 1;
    else counts.neu += 1;
    if (status !== 'new') counts.answered += 1;
  });
  return counts;
}

export function clearHistory() {
  try { profileRemove(STORAGE_KEY); } catch {}
}

export function clearLearnProgress() {
  try { profileRemove(LEARN_KEY); } catch {}
}

export function getLearnProgress(category) {
  const data = loadLearnData();
  const catData = data[category];
  if (!catData) return 0;
  if (Array.isArray(catData)) return catData.length;
  return Object.keys(catData).length;
}

export function getLearnAnswered(category) {
  const data = loadLearnData();
  const catData = data[category];
  if (!catData) return new Set();
  if (Array.isArray(catData)) return new Set(catData);
  return new Set(Object.keys(catData));
}

export function getLearnAnswerForQuestion(category, questionId) {
  const data = loadLearnData();
  const catData = data[category];
  if (!catData || Array.isArray(catData)) return null;
  return normalizeLearnEntry(catData[questionId]).answer;
}

export function getLearnMetaForQuestion(category, questionId) {
  const data = loadLearnData();
  const catData = data[category];
  if (!catData || Array.isArray(catData)) return null;
  const entry = normalizeLearnEntry(catData[questionId]);
  if (entry.answer === null && entry.streak === 0 && entry.dueAt === null) return null;
  return { streak: entry.streak, dueAt: entry.dueAt };
}

export function getLearnQuestionStatus(category, question, answerOverride) {
  const answer = answerOverride !== undefined
    ? answerOverride
    : getLearnAnswerForQuestion(category, question.id);
  const meta = getLearnMetaForQuestion(category, question.id);
  const streak = meta?.streak || 0;
  if (answer !== null && answer !== question.correct) return 'wrong';
  if (answer === question.correct && streak >= LEARN_KNOWN_STREAK) return 'known';
  if (answer === null) return 'new';
  return 'learning';
}
