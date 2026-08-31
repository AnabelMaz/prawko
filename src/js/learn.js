// learn.js — Learning mode (sequential browsing, no timer, immediate feedback)

import { renderQuestion, highlightAnswer, preloadMedia } from './ui.js';
import {
  saveLearnAnswer,
  getLearnAnswerForQuestion,
  getLearnMetaForQuestion,
} from './stats.js';
import { getLang } from './i18n.js';

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
      position: fixed;
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

function showResumeToast(currentIndex, total) {
  // Remove any existing toast
  const existing = document.querySelector('.learn-toast');
  if (existing) existing.remove();

  const msg = getLang() === 'en'
    ? `Resuming from question ${currentIndex + 1} of ${total}`
    : `Wznowienie od pytania ${currentIndex + 1} z ${total}`;

  const toast = document.createElement('div');
  toast.className = 'learn-toast';
  toast.textContent = msg;
  toast.setAttribute('role', 'status');
  toast.setAttribute('aria-live', 'polite');
  document.body.appendChild(toast);

  // Trigger visible class on next frame so transition runs
  requestAnimationFrame(() => {
    toast.classList.add('visible');
  });

  setTimeout(() => {
    toast.classList.remove('visible');
    setTimeout(() => toast.remove(), 300);
  }, 3000);
}

function showQueueToast(isWrongOnly) {
  const existing = document.querySelector('.learn-toast');
  if (existing) existing.remove();

  const msg = getLang() === 'en'
    ? (isWrongOnly ? 'Wrong-only mode enabled' : 'All questions mode enabled')
    : (isWrongOnly ? 'Włączono tryb tylko błędne' : 'Włączono tryb wszystkie pytania');

  const toast = document.createElement('div');
  toast.className = 'learn-toast';
  toast.textContent = msg;
  toast.setAttribute('role', 'status');
  toast.setAttribute('aria-live', 'polite');
  document.body.appendChild(toast);

  requestAnimationFrame(() => {
    toast.classList.add('visible');
  });

  setTimeout(() => {
    toast.classList.remove('visible');
    setTimeout(() => toast.remove(), 300);
  }, 1800);
}

function showNoWrongQuestionsToast() {
  const existing = document.querySelector('.learn-toast');
  if (existing) existing.remove();

  const msg = getLang() === 'en' ? 'No wrong answers yet' : 'Brak błędnych odpowiedzi';
  const toast = document.createElement('div');
  toast.className = 'learn-toast';
  toast.textContent = msg;
  toast.setAttribute('role', 'status');
  toast.setAttribute('aria-live', 'polite');
  document.body.appendChild(toast);

  requestAnimationFrame(() => {
    toast.classList.add('visible');
  });

  setTimeout(() => {
    toast.classList.remove('visible');
    setTimeout(() => toast.remove(), 300);
  }, 1800);
}

function orderAdaptiveQuestions(category, questions) {
  const now = Date.now();
  const due = [];
  const incorrect = [];
  const unseen = [];
  const rest = [];

  questions.forEach((q) => {
    const answer = getLearnAnswerForQuestion(category, q.id);
    const meta = getLearnMetaForQuestion(category, q.id);
    const isDue = Number.isFinite(meta?.dueAt) && meta.dueAt <= now;
    const isIncorrect = answer !== null && answer !== q.correct;
    const isUnseen = answer === null;

    if (isDue) due.push(q);
    if (isIncorrect) {
      incorrect.push(q);
      return;
    }
    if (isUnseen) {
      unseen.push(q);
      return;
    }
    rest.push(q);
  });

  const seenIds = new Set();
  const ordered = [];
  [due, incorrect, unseen, rest].forEach((group) => {
    group.forEach((q) => {
      if (seenIds.has(q.id)) return;
      seenIds.add(q.id);
      ordered.push(q);
    });
  });

  return ordered.length ? ordered : [...questions];
}

function getCurrentQuestionId() {
  return state?.questions?.[state.currentIndex]?.id ?? null;
}

function getKnownAnswer(question) {
  if (!state || !question) return null;
  if (state.sessionAnswers.has(question.id)) return state.sessionAnswers.get(question.id);
  return getLearnAnswerForQuestion(state.category, question.id);
}

function getWrongOnlyQuestions() {
  if (!state) return [];
  return state.baseQuestions.filter(q => {
    const answer = getKnownAnswer(q);
    return answer !== null && answer !== q.correct;
  });
}

function loadQueueModePreference(category) {
  try {
    const raw = JSON.parse(localStorage.getItem(QUEUE_MODE_KEY) || '{}');
    if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) return 'adaptive';
    return raw[category] === 'wrongOnly' ? 'wrongOnly' : 'adaptive';
  } catch {
    return 'adaptive';
  }
}

function saveQueueModePreference(category, mode) {
  try {
    const raw = JSON.parse(localStorage.getItem(QUEUE_MODE_KEY) || '{}');
    const next = (typeof raw === 'object' && raw && !Array.isArray(raw)) ? raw : {};
    next[category] = mode === 'wrongOnly' ? 'wrongOnly' : 'adaptive';
    localStorage.setItem(QUEUE_MODE_KEY, JSON.stringify(next));
  } catch {}
}

function setQueueMode(mode) {
  if (!state) return false;
  const currentQuestionId = getCurrentQuestionId();

  if (mode === 'wrongOnly') {
    const wrongQuestions = getWrongOnlyQuestions();
    if (!wrongQuestions.length) return false;
    state.questions = wrongQuestions;
  } else {
    state.questions = [...state.baseQuestions];
  }

  state.queueMode = mode;
  saveQueueModePreference(state.category, mode);
  const idx = state.questions.findIndex(q => q.id === currentQuestionId);
  state.currentIndex = idx >= 0 ? idx : 0;
  showLearnQuestion();
  updateNavButtons();
  updateLearnStats();
  return true;
}

function toggleQueueMode() {
  if (!state) return;
  const nextMode = state.queueMode === 'adaptive' ? 'wrongOnly' : 'adaptive';
  const didSwitch = setQueueMode(nextMode);
  if (!didSwitch) {
    if (nextMode === 'wrongOnly') showNoWrongQuestionsToast();
    return;
  }
  showQueueToast(nextMode === 'wrongOnly');
}

export function startLearn(categoryData) {
  const preferredMode = loadQueueModePreference(categoryData.category);
  const orderedQuestions = orderAdaptiveQuestions(categoryData.category, categoryData.questions);
  let startIndex = 0;
  const hasDueOrIncorrect = orderedQuestions.some((q) => {
    const answer = getLearnAnswerForQuestion(categoryData.category, q.id);
    const meta = getLearnMetaForQuestion(categoryData.category, q.id);
    return (answer !== null && answer !== q.correct) || (Number.isFinite(meta?.dueAt) && meta.dueAt <= Date.now());
  });
  if (!hasDueOrIncorrect && orderedQuestions.length > 0) {
    const idx = orderedQuestions.findIndex(q =>
      getLearnAnswerForQuestion(categoryData.category, q.id) === null
    );
    if (idx !== -1) startIndex = idx;
  }

  state = {
    category: categoryData.category,
    baseQuestions: orderedQuestions,
    questions: [...orderedQuestions],
    currentIndex: startIndex,
    answered: false,
    correctCount: 0,
    incorrectCount: 0,
    queueMode: 'adaptive',
    sessionAnswers: new Map(),
  };

  if (preferredMode === 'wrongOnly') {
    const wrongOnly = getWrongOnlyQuestions();
    if (wrongOnly.length) {
      state.questions = wrongOnly;
      state.queueMode = 'wrongOnly';
      state.currentIndex = 0;
    } else {
      saveQueueModePreference(categoryData.category, 'adaptive');
    }
  }

  // Show learn nav and back button, hide exam controls
  document.querySelector('.learn-nav').classList.add('visible');
  document.querySelector('.quiz-back').classList.add('visible');
  document.querySelector('.btn-end-exam').classList.remove('visible');

  // Hide timers in learn mode
  document.querySelector('.timer-display').style.display = 'none';

  // Show learn stats counter
  const learnStatsEl = document.querySelector('.learn-stats');
  if (learnStatsEl) learnStatsEl.classList.add('visible');
  updateLearnStats();

  // Keyboard shortcuts
  if (keydownHandler) document.removeEventListener('keydown', keydownHandler);
  keydownHandler = (e) => {
    if (document.getElementById('confirm-modal')?.classList.contains('active')) return;
    if (!state) return;
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
      toggleQueueMode();
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

  // Show resume notification if resuming from a non-zero position
  if (startIndex > 0) {
    showResumeToast(startIndex, categoryData.questions.length);
  }
}

function updateLearnStats() {
  const el = document.querySelector('.learn-stats');
  if (!el || !state) return;
  el.innerHTML = '';
  const correct = document.createElement('span');
  correct.className = 'learn-stats-correct';
  correct.textContent = `\u2713 ${state.correctCount}`;
  const incorrect = document.createElement('span');
  incorrect.className = 'learn-stats-incorrect';
  incorrect.textContent = `\u2717 ${state.incorrectCount}`;
  const queueBtn = document.createElement('button');
  queueBtn.className = `learn-queue-toggle ${state.queueMode === 'wrongOnly' ? 'active' : ''}`;
  queueBtn.type = 'button';
  queueBtn.textContent = getLang() === 'en' ? 'Wrong only' : 'Tylko błędne';
  queueBtn.addEventListener('click', () => toggleQueueMode());
  el.append(correct, incorrect, queueBtn);
}

function showLearnQuestion() {
  if (!state) return;
  if (!state.questions.length) return;
  window.scrollTo({ top: 0, behavior: 'smooth' });
  state.answered = false;
  state.givenAnswer = null;
  const q = state.questions[state.currentIndex];

  // Progress
  document.querySelector('.question-progress').textContent =
    `${state.currentIndex + 1} / ${state.questions.length}`;
  document.querySelector('.progress-fill').style.width =
    `${((state.currentIndex + 1) / state.questions.length) * 100}%`;

  renderQuestion(q, document.querySelector('.question-card'));

  // Answer handlers
  document.querySelector('.answers').querySelectorAll('.answer-btn').forEach(btn => {
    btn.addEventListener('click', () => handleLearnAnswer(btn.dataset.answer));
  });

  // Lock only previously *correct* answers. Wrong ones stay at the front of
  // the queue so they can be answered again instead of forcing Next-only.
  const prevAnswer = getLearnAnswerForQuestion(state.category, q.id);
  if (prevAnswer && prevAnswer === q.correct) {
    state.answered = true;
    state.givenAnswer = prevAnswer;
    highlightAnswer(document.querySelector('.answers'), prevAnswer, q.correct);
  }

  // Preload next question's media
  const next = state.questions[state.currentIndex + 1];
  if (next) preloadMedia(next);
}

function handleLearnAnswer(answer) {
  if (!state || state.answered) return;
  state.answered = true;
  state.givenAnswer = answer;
  const q = state.questions[state.currentIndex];
  highlightAnswer(document.querySelector('.answers'), answer, q.correct);
  const isCorrect = answer === q.correct;
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
  const q = state.questions[state.currentIndex];
  renderQuestion(q, document.querySelector('.question-card'));
  if (state.answered && state.givenAnswer) {
    highlightAnswer(document.querySelector('.answers'), state.givenAnswer, q.correct);
  } else {
    document.querySelector('.answers').querySelectorAll('.answer-btn').forEach(btn => {
      btn.addEventListener('click', () => handleLearnAnswer(btn.dataset.answer));
    });
  }
}

export function cleanupLearn() {
  if (keydownHandler) {
    document.removeEventListener('keydown', keydownHandler);
    keydownHandler = null;
  }
  // Stop any playing video
  const video = document.querySelector('.media-area video');
  if (video) { video.pause(); video.removeAttribute('src'); video.load(); }
  document.querySelector('.timer-display').style.display = '';
  document.querySelector('.learn-nav').classList.remove('visible');
  document.querySelector('.quiz-back').classList.remove('visible');
  const learnStatsEl = document.querySelector('.learn-stats');
  if (learnStatsEl) learnStatsEl.classList.remove('visible');
  state = null;
}
