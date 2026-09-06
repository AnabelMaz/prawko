// learn.js — Learning mode (no timer, immediate feedback).
// Sequential and random are two lists of the current filter.
// Random is shuffled once: on enter if already selected, or the first time it is chosen.
// Switching order keeps the same question. The counter is always the catalog
// number of that question, so next/prev on random jumps 2022 → 1500, not 2023.

import { renderQuestion, highlightAnswer, markSelectedAnswer, showLearnMediaMark, preloadMedia } from './ui.js';
import {
  saveLearnAnswer,
  getLearnKnownCount,
  getLearnQuestionStatus,
} from './stats.js';
import { getLang, t } from './i18n.js';
import { profileGet, profileSet } from './profiles.js';

let state = null;
let keydownHandler = null;
const QUEUE_MODE_KEY = 'prawko_learn_queue_mode';

// Inject toast styles once
(function injectToastStyles() {
  if (document.getElementById('learn-toast-styles')) return;
  const style = document.createElement('style');
  style.id = 'learn-toast-styles';
  style.textContent = `
    .learn-toast {
      position: absolute;
      bottom: 24px;
      left: 50%;
      transform: translateX(-50%) translateY(20px);
      background: var(--bg-card);
      color: var(--text);
      border: 1px solid var(--border);
      border-radius: var(--radius-sm);
      padding: 10px 20px;
      font-size: 0.9rem;
      font-weight: 500;
      box-shadow: var(--shadow-lg);
      opacity: 0;
      pointer-events: none;
      transition: opacity 0.3s ease, transform 0.3s ease;
      z-index: 150;
    }
    .learn-toast.visible {
      opacity: 1;
      transform: translateX(-50%) translateY(0);
    }
    .learn-queue-toggle {
      margin-left: 10px;
      padding: 3px 10px;
      border-radius: var(--radius-sm);
      border: 1px solid var(--border);
      background: transparent;
      color: var(--text);
      font-size: 0.75rem;
      cursor: pointer;
    }
    .learn-queue-toggle.active {
      border-color: var(--accent);
      color: var(--accent);
    }
  `;
  document.head.appendChild(style);
})();

function toastHost() {
  return document.getElementById('ui-stage') || document.getElementById('app') || document.body;
}

function showToast(msg) {
  const existing = document.querySelector('.learn-toast');
  if (existing) existing.remove();

  const toast = document.createElement('div');
  toast.className = 'learn-toast';
  toast.textContent = msg;
  toast.setAttribute('role', 'status');
  toast.setAttribute('aria-live', 'polite');
  toastHost().appendChild(toast);

  requestAnimationFrame(() => {
    toast.classList.add('visible');
  });

  setTimeout(() => {
    toast.classList.remove('visible');
    setTimeout(() => toast.remove(), 300);
  }, 1800);
}

function showResumeToast(currentIndex, total) {
  const msg = getLang() === 'en'
    ? `Resuming from question ${currentIndex + 1} of ${total}`
    : `Wznowienie od pytania ${currentIndex + 1} z ${total}`;
  showToast(msg);
}

function emptyFilterMessage(filter) {
  if (filter === 'new') return t('learnFilterEmptyNew');
  if (filter === 'wrong') return t('learnFilterEmptyWrong');
  if (filter === 'known') return t('learnFilterEmptyKnown');
  if (filter === 'unknown') return t('learnFilterEmptyUnknown');
  return t('learnFilterEmptyWrong');
}

function shuffleList(list) {
  const arr = [...list];
  for (let i = arr.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [arr[i], arr[j]] = [arr[j], arr[i]];
  }
  return arr;
}

function questionMatchesFilter(q, filter, category) {
  const cat = category || state?.category;
  if (!cat || !q) return filter === 'all';
  const override = state?.sessionAnswers?.has(q.id) ? state.sessionAnswers.get(q.id) : undefined;
  const status = getLearnQuestionStatus(cat, q, override);
  if (filter === 'unknown') return status !== 'known';
  if (filter === 'new') return status === 'new';
  if (filter === 'wrong') return status === 'wrong';
  if (filter === 'known') return status === 'known';
  return true;
}

function filterQuestions(questions, filter, category) {
  if (filter === 'all') return [...questions];
  return questions.filter(q => questionMatchesFilter(q, filter, category));
}

function getCurrentQuestionId() {
  return state?.questions?.[state.currentIndex]?.id ?? null;
}

function getCurrentQuestion() {
  return state?.questions?.[state.currentIndex] ?? null;
}

function activeList() {
  return state.order === 'random' ? state.randomList : state.seqList;
}

function refreshSeqList() {
  state.seqList = filterQuestions(state.baseQuestions, state.filter);
  state.seqIndexById = new Map(state.seqList.map((q, i) => [q.id, i]));
}

function ensureRandomList() {
  if (!state.shuffledAll) {
    state.shuffledAll = shuffleList(state.baseQuestions);
  }
  state.randomList = filterQuestions(state.shuffledAll, state.filter);
}

function refreshListsForFilter() {
  refreshSeqList();
  if (state.shuffledAll || state.order === 'random') ensureRandomList();
}

function adoptActiveList({ keepId = false } = {}) {
  const savedIndex = state.currentIndex;
  const currentId = keepId ? getCurrentQuestionId() : null;
  state.questions = activeList();
  if (!state.questions.length) return false;
  if (keepId && currentId != null) {
    const idx = state.questions.findIndex(q => q.id === currentId);
    state.currentIndex = idx >= 0 ? idx : 0;
  } else {
    state.currentIndex = Math.min(Math.max(0, savedIndex), state.questions.length - 1);
  }
  return true;
}

function catalogIndex() {
  const id = getCurrentQuestionId();
  if (id == null || !state?.seqIndexById) return state?.currentIndex ?? 0;
  const idx = state.seqIndexById.get(id);
  return idx == null ? state.currentIndex : idx;
}

function updateProgress() {
  if (!state?.questions?.length) return;
  const pos = catalogIndex() + 1;
  const total = state.seqList.length || state.questions.length;
  const qnum = document.querySelector('.learn-qnum');
  if (qnum) qnum.textContent = `${pos} / ${total}`;
  const catEl = document.querySelector('.learn-category-value');
  if (catEl) catEl.textContent = state.category || '';
  const next = state.questions[state.currentIndex + 1];
  if (next) preloadMedia(next);
}

function syncListView(previousId) {
  if (getCurrentQuestionId() !== previousId) showLearnQuestion();
  else {
    updateProgress();
    updateNavButtons();
  }
  updateLearnStats();
}

const FILTERS = ['all', 'unknown', 'new', 'wrong', 'known'];
const QUEUE_PREF_DEFAULT = { filter: 'unknown', order: 'random' };

function normalizeQueuePref(raw) {
  if (raw === 'wrongOnly') return { filter: 'wrong', order: 'sequential' };
  if (raw === 'adaptive') return { filter: 'all', order: 'sequential' };
  if (typeof raw === 'object' && raw !== null && !Array.isArray(raw)) {
    const filter = FILTERS.includes(raw.filter) ? raw.filter : 'unknown';
    const order = raw.order === 'random' ? 'random' : 'sequential';
    return { filter, order };
  }
  return { ...QUEUE_PREF_DEFAULT };
}

function loadQueuePreference(category) {
  try {
    const raw = JSON.parse(profileGet(QUEUE_MODE_KEY) || '{}');
    if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) return { ...QUEUE_PREF_DEFAULT };
    return normalizeQueuePref(raw[category]);
  } catch {
    return { ...QUEUE_PREF_DEFAULT };
  }
}

function saveQueuePreference(category, pref) {
  try {
    const raw = JSON.parse(profileGet(QUEUE_MODE_KEY) || '{}');
    const next = (typeof raw === 'object' && raw && !Array.isArray(raw)) ? raw : {};
    next[category] = { filter: pref.filter, order: pref.order };
    profileSet(QUEUE_MODE_KEY, JSON.stringify(next));
  } catch {}
}

function rebuildFilter(filter, { keepPlace = true } = {}) {
  if (!state) return false;
  const previousId = keepPlace ? getCurrentQuestionId() : null;
  const filtered = filterQuestions(state.baseQuestions, filter);
  if (!filtered.length) return false;
  state.filter = filter;
  refreshListsForFilter();
  if (!adoptActiveList({ keepId: keepPlace })) return false;
  saveQueuePreference(state.category, { filter, order: state.order });
  syncListView(previousId);
  return true;
}

function setFilter(filter) {
  if (!state) return false;
  if (filter === state.filter) return true;
  const didSwitch = rebuildFilter(filter);
  if (!didSwitch) {
    showToast(emptyFilterMessage(filter));
    return false;
  }
  return true;
}

function setOrder(order) {
  if (!state) return false;
  if (order !== 'random' && order !== 'sequential') return false;
  if (order === state.order) return true;
  const previousId = getCurrentQuestionId();
  if (order === 'random') ensureRandomList();
  state.order = order;
  if (!adoptActiveList({ keepId: true })) return false;
  saveQueuePreference(state.category, { filter: state.filter, order });
  syncListView(previousId);
  return true;
}

function cycleFilter() {
  if (!state) return;
  const start = FILTERS.indexOf(state.filter);
  for (let i = 1; i <= FILTERS.length; i++) {
    const next = FILTERS[(start + i) % FILTERS.length];
    if (setFilter(next)) return;
  }
}

export function startLearn(categoryData) {
  const pref = loadQueuePreference(categoryData.category);
  const baseQuestions = [...categoryData.questions];
  let filter = pref.filter;
  let order = pref.order;
  if (!filterQuestions(baseQuestions, filter, categoryData.category).length) {
    filter = 'all';
    saveQueuePreference(categoryData.category, { filter, order });
  }

  state = {
    category: categoryData.category,
    baseQuestions,
    shuffledAll: null,
    seqList: [],
    seqIndexById: new Map(),
    randomList: [],
    questions: [],
    currentIndex: 0,
    answered: false,
    correctCount: 0,
    incorrectCount: 0,
    filter,
    order,
    sessionAnswers: new Map(),
  };
  refreshSeqList();
  if (order === 'random') ensureRandomList();
  adoptActiveList();

  // Show learn nav and back button, hide exam controls
  document.getElementById('quiz')?.classList.add('learn-active');
  document.querySelector('.learn-top')?.removeAttribute('hidden');
  document.querySelector('.learn-nav').classList.add('visible');
  document.querySelector('.quiz-back').classList.add('visible');
  document.querySelector('.btn-end-exam').classList.remove('visible');

  // Hide timers in learn mode
  document.querySelectorAll('.timer-display').forEach((el) => {
    el.style.display = 'none';
  });

  // Show learn stats counter
  const learnStatsEl = document.querySelector('.learn-stats');
  if (learnStatsEl) learnStatsEl.classList.add('visible');
  updateLearnStats();

  // Keyboard shortcuts
  if (keydownHandler) document.removeEventListener('keydown', keydownHandler);
  keydownHandler = (e) => {
    if (document.getElementById('confirm-modal')?.classList.contains('active')) return;
    if (!state) return;
    if (e.target.closest('select, input, textarea, .learn-queue-dropdown')) return;
    const key = e.key.toLowerCase();
    const answersDiv = document.querySelector('.answers');
    const isBasic = answersDiv?.classList.contains('yn-answers');

    if (!state.answered) {
      if (isBasic) {
        if (key === 't' || key === '1') { e.preventDefault(); handleLearnAnswer('T'); return; }
        if (key === 'n' || key === '2') { e.preventDefault(); handleLearnAnswer('N'); return; }
      } else {
        if (key === '1') { e.preventDefault(); handleLearnAnswer('A'); return; }
        if (key === '2') { e.preventDefault(); handleLearnAnswer('B'); return; }
        if (key === '3') { e.preventDefault(); handleLearnAnswer('C'); return; }
      }
    }

    if (key === 'w') {
      e.preventDefault();
      cycleFilter();
      return;
    }

    if (key === 'arrowleft' && state.currentIndex > 0) {
      e.preventDefault();
      state.currentIndex--;
      showLearnQuestion();
      updateNavButtons();
    } else if (key === 'arrowright' && state.currentIndex < state.questions.length - 1) {
      e.preventDefault();
      state.currentIndex++;
      showLearnQuestion();
      updateNavButtons();
    }
  };
  document.addEventListener('keydown', keydownHandler);

  showLearnQuestion();
  updateNavButtons();

  if (state.currentIndex > 0) {
    showResumeToast(state.currentIndex, categoryData.questions.length);
  }
}

function updateLearnStats() {
  const el = document.querySelector('.learn-stats');
  if (!el || !state) return;
  const knownCount = getLearnKnownCount(state.category, state.baseQuestions);
  const filterOptions = [
    ['all', t('learnFilterAll')],
    ['unknown', t('learnFilterUnknown')],
    ['new', t('learnFilterNew')],
    ['wrong', t('learnFilterWrong')],
    ['known', t('learnFilterKnown')],
  ];
  const orderOptions = [
    ['sequential', t('learnOrderSeq')],
    ['random', t('learnOrderRandom')],
  ];

  let known = el.querySelector('.learn-stats-known');
  let correct = el.querySelector('.learn-stats-correct');
  let incorrect = el.querySelector('.learn-stats-incorrect');
  let filterSelect = el.querySelector('.learn-filter-select');
  let orderSelect = el.querySelector('.learn-order-select');
  let summary = el.querySelector('.learn-stats-summary');

  if (!filterSelect || !orderSelect || !known || !correct || !incorrect || !summary) {
    el.textContent = '';
    known = document.createElement('span');
    known.className = 'learn-stats-known';
    correct = document.createElement('span');
    correct.className = 'learn-stats-correct';
    incorrect = document.createElement('span');
    incorrect.className = 'learn-stats-incorrect';
    summary = document.createElement('span');
    summary.className = 'learn-stats-summary';
    filterSelect = createQueueDropdown('learn-filter-select', (next) => {
      if (!setFilter(next)) syncQueueDropdown(filterSelect, filterOptions, state.filter);
    });
    orderSelect = createQueueDropdown('learn-order-select', (next) => {
      if (!setOrder(next)) syncQueueDropdown(orderSelect, orderOptions, state.order);
    });
    summary.append(known, correct, incorrect);
    el.append(filterSelect, orderSelect, summary);
  }

  known.textContent = `\u{1F9E0} ${knownCount}`;
  known.setAttribute('aria-label', t('learnStatsKnown').replace('{n}', String(knownCount)));
  correct.textContent = `\u2713 ${state.correctCount}`;
  incorrect.textContent = `\u2717 ${state.incorrectCount}`;
  filterSelect.querySelector('.learn-queue-select').setAttribute('aria-label', t('learnFilterLabel'));
  orderSelect.querySelector('.learn-queue-select').setAttribute('aria-label', t('learnOrderLabel'));
  syncQueueDropdown(filterSelect, filterOptions, state.filter);
  syncQueueDropdown(orderSelect, orderOptions, state.order);
}

function closeQueueMenus() {
  document.querySelectorAll('.learn-queue-dropdown.is-open').forEach((el) => {
    el.classList.remove('is-open');
    el.querySelector('.learn-queue-select')?.setAttribute('aria-expanded', 'false');
  });
}

document.addEventListener('click', closeQueueMenus);
document.addEventListener('keydown', (e) => {
  if (e.key === 'Escape') closeQueueMenus();
});

function createQueueDropdown(extraClass, onPick) {
  const root = document.createElement('div');
  root.className = `learn-queue-dropdown ${extraClass}`;
  const btn = document.createElement('button');
  btn.type = 'button';
  btn.className = 'learn-queue-select';
  btn.setAttribute('aria-haspopup', 'listbox');
  btn.setAttribute('aria-expanded', 'false');
  const menu = document.createElement('ul');
  menu.className = 'learn-queue-menu';
  menu.setAttribute('role', 'listbox');
  btn.addEventListener('click', (e) => {
    e.stopPropagation();
    const willOpen = !root.classList.contains('is-open');
    closeQueueMenus();
    if (willOpen) {
      root.classList.add('is-open');
      btn.setAttribute('aria-expanded', 'true');
    }
  });
  root.append(btn, menu);
  root._onPick = onPick;
  return root;
}

function syncQueueDropdown(root, options, value) {
  const btn = root.querySelector('.learn-queue-select');
  const menu = root.querySelector('.learn-queue-menu');
  menu.replaceChildren(...options.map(([optValue, label]) => {
    const li = document.createElement('li');
    li.setAttribute('role', 'option');
    li.dataset.value = optValue;
    li.textContent = label;
    if (optValue === value) li.setAttribute('aria-selected', 'true');
    li.addEventListener('click', (e) => {
      e.stopPropagation();
      closeQueueMenus();
      root._onPick(optValue);
    });
    return li;
  }));
  const selected = options.find(([optValue]) => optValue === value);
  btn.textContent = selected ? selected[1] : '';
  root.dataset.value = value;
}

function showLearnQuestion() {
  if (!state) return;
  if (!state.questions.length) return;
  if (document.documentElement.getAttribute('data-ui-mode') !== 'fit') {
    window.scrollTo({ top: 0, behavior: 'auto' });
  }
  state.answered = false;
  state.givenAnswer = null;
  const q = getCurrentQuestion();
  if (!q) return;

  updateProgress();
  renderQuestion(q, document.querySelector('.question-card'));

  // Answer handlers — stored progress never pre-locks; the filter only chooses the queue
  document.querySelector('.answers').querySelectorAll('.answer-btn').forEach(btn => {
    btn.addEventListener('click', () => handleLearnAnswer(btn.dataset.answer));
  });
}

function handleLearnAnswer(answer) {
  if (!state || state.answered) return;
  state.answered = true;
  state.givenAnswer = answer;
  const q = getCurrentQuestion();
  const answersDiv = document.querySelector('.answers');
  markSelectedAnswer(answersDiv, answer);
  highlightAnswer(answersDiv, answer, q.correct);
  const isCorrect = answer === q.correct;
  showLearnMediaMark(isCorrect);
  saveLearnAnswer(state.category, q.id, answer, isCorrect);
  state.sessionAnswers.set(q.id, answer);

  if (isCorrect) {
    state.correctCount++;
  } else {
    state.incorrectCount++;
  }
  updateLearnStats();
}

export function setupLearnListeners() {
  document.querySelector('.btn-prev').addEventListener('click', () => {
    if (!state || state.currentIndex <= 0) return;
    state.currentIndex--;
    showLearnQuestion();
    updateNavButtons();
  });

  document.querySelector('.btn-next').addEventListener('click', () => {
    if (!state) return;
    if (state.currentIndex < state.questions.length - 1) {
      state.currentIndex++;
      showLearnQuestion();
      updateNavButtons();
    }
  });
}

function updateNavButtons() {
  if (!state) return;
  document.querySelector('.btn-prev').disabled = state.currentIndex <= 0;
  document.querySelector('.btn-next').disabled = state.currentIndex >= state.questions.length - 1;
}

export function refreshLearnQuestion() {
  if (!state) return;
  const q = getCurrentQuestion();
  if (!q) return;
  renderQuestion(q, document.querySelector('.question-card'));
  if (state.answered && state.givenAnswer) {
    const answersDiv = document.querySelector('.answers');
    markSelectedAnswer(answersDiv, state.givenAnswer);
    highlightAnswer(answersDiv, state.givenAnswer, q.correct);
    showLearnMediaMark(state.givenAnswer === q.correct);
  } else {
    document.querySelector('.answers').querySelectorAll('.answer-btn').forEach(btn => {
      btn.addEventListener('click', () => handleLearnAnswer(btn.dataset.answer));
    });
  }
  updateLearnStats();
}

export function cleanupLearn() {
  if (keydownHandler) {
    document.removeEventListener('keydown', keydownHandler);
    keydownHandler = null;
  }
  // Stop any playing video
  const video = document.querySelector('.media-area video');
  if (video) { video.pause(); video.removeAttribute('src'); video.load(); }
  document.querySelectorAll('.timer-display').forEach((el) => {
    el.style.display = '';
  });
  document.getElementById('quiz')?.classList.remove('learn-active');
  document.querySelector('.learn-top')?.setAttribute('hidden', '');
  document.querySelector('.learn-nav').classList.remove('visible');
  document.querySelector('.quiz-back').classList.remove('visible');
  const learnStatsEl = document.querySelector('.learn-stats');
  if (learnStatsEl) learnStatsEl.classList.remove('visible');
  state = null;
}
