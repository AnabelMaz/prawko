// exam.js — WORD-style exam: 20s read, then 15s held while the film plays, then 15s ticks

import { QuestionTimer, ExamTimer, formatTime, formatQuestionSeconds } from './timer.js';
import {
  renderQuestion,
  markSelectedAnswer,
  setAnswerButtonsEnabled,
  playExamVideo,
  renderResults,
  showConfirmModal,
  confirmModalAction,
  hideModal,
  preloadMedia,
} from './ui.js';
import { saveLastResult, saveResult } from './stats.js';
import { t, getLang } from './i18n.js';
import { refitUiScale } from './scale.js';
import { getPracticeExamEnabled } from './profiles.js';

let state = null;
let lastExamCategory = null;
const LAST_EXAM_CATEGORY_KEY = 'prawko_last_exam_category';
let answerDelegateHandler = null;
let keydownHandler = null;
let beforeUnloadHandler = null;
let watchVideo = null;
let watchRaf = 0;
let watchGen = 0;
let watchEndedHandler = null;
const NEXT_GUARD_MS = 1000;
let nextGuardUntil = 0;
let nextGuardTimer = 0;

export function getLastExamCategory() {
  if (lastExamCategory) return lastExamCategory;
  try {
    return sessionStorage.getItem(LAST_EXAM_CATEGORY_KEY) || null;
  } catch {
    return null;
  }
}

const PRACTICE_BASIC_COUNT = 3;
const PRACTICE_SPECIALIST_COUNT = 2;
const BASIC_POINT_DRAW = [[3, 10], [2, 6], [1, 4]];
const SPECIALIST_POINT_DRAW = [[3, 6], [2, 4], [1, 2]];

function pickPractice(leftover, fallback, count) {
  if (count <= 0) return [];
  const out = [];
  const seen = new Set();
  for (const q of leftover) {
    if (seen.has(q.id)) continue;
    seen.add(q.id);
    out.push(q);
    if (out.length >= count) return out;
  }
  for (const q of fallback) {
    if (seen.has(q.id)) continue;
    seen.add(q.id);
    out.push(q);
    if (out.length >= count) return out;
  }
  return out;
}

function questionPoints(q) {
  const n = Number(q?.points);
  return n === 1 || n === 2 || n === 3 ? n : 1;
}

function pickByPointRecipe(pool, recipe) {
  const shuffled = shuffle(pool);
  const buckets = { 1: [], 2: [], 3: [] };
  for (const q of shuffled) {
    buckets[questionPoints(q)].push(q);
  }
  const picked = [];
  const used = new Set();
  for (const [pts, need] of recipe) {
    let got = 0;
    const bucket = buckets[pts] || [];
    while (got < need && bucket.length) {
      const q = bucket.shift();
      if (used.has(q.id)) continue;
      used.add(q.id);
      picked.push(q);
      got += 1;
    }
    if (got < need) {
      for (const q of shuffled) {
        if (got >= need) break;
        if (used.has(q.id)) continue;
        used.add(q.id);
        picked.push(q);
        got += 1;
      }
    }
  }
  return { picked, used };
}

function shuffle(arr) {
  const a = [...arr];
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

function quizCard() {
  return document.querySelector('.question-card');
}

function setExamLayout(active) {
  document.getElementById('quiz')?.classList.toggle('exam-active', active);
  const fields = document.querySelector('.exam-top-fields');
  const counters = document.querySelector('.exam-counters');
  if (fields) fields.hidden = !active;
  if (counters) counters.hidden = !active;
  if (active) {
    document.querySelectorAll('.timer-display').forEach((el) => {
      el.style.display = '';
    });
  } else {
    document.querySelector('.exam-film-start')?.setAttribute('hidden', '');
    document.querySelectorAll('.exam-counter').forEach((el) => el.classList.remove('active'));
  }
}

function isBasicFilm(item) {
  return item?.question.type === 'basic' && item.question.mediaType === 'video';
}

function setExamPhase(phase) {
  if (state) state.phase = phase;
  const quiz = document.getElementById('quiz');
  if (!quiz) return;
  if (phase) quiz.setAttribute('data-exam-phase', phase);
  else quiz.removeAttribute('data-exam-phase');
}

function updateFilmStartButton() {
  const btn = document.querySelector('.exam-film-start');
  if (!btn) return;
  const item = currentItem();
  const show = Boolean(
    state?.started &&
    !state?.finished &&
    state.phase === 'read' &&
    isBasicFilm(item)
  );
  btn.hidden = !show;
  btn.textContent = t('examStartMedia');
}

function updateExamChrome() {
  if (!state) return;
  const item = currentItem();
  const pointsEl = document.querySelector('.exam-points-value');
  const catEl = document.querySelector('.exam-category-value');
  if (pointsEl) pointsEl.textContent = item?.practice ? '—' : String(item?.points ?? '');
  if (catEl) catEl.textContent = state.category || '';
  const qnumEl = document.querySelector('.exam-qnum');
  if (qnumEl) {
    if (item?.practice) {
      const practice = state.questions.filter((x) => x.practice);
      qnumEl.textContent = String(Math.max(1, practice.indexOf(item) + 1));
    } else {
      const scored = scoredQuestions();
      const scoredIndex = scored.indexOf(item);
      qnumEl.textContent = String(Math.max(1, scoredIndex + 1));
    }
  }

  const basicEl = document.querySelector('.exam-counter-basic');
  const specEl = document.querySelector('.exam-counter-specialist');
  const basicCounter = document.querySelector('.exam-counter[data-part="basic"]');
  const specCounter = document.querySelector('.exam-counter[data-part="specialist"]');

  const of = (n, total) => t('examCounterOf').replace('{n}', String(n)).replace('{total}', String(total));
  const isBasic = item?.question.type === 'basic';

  if (item?.practice) {
    const practice = state.questions.filter((x) => x.practice);
    const basicTotal = practice.filter((x) => x.question.type === 'basic').length;
    const specTotal = practice.filter((x) => x.question.type === 'specialist').length;
    const practiceIndex = practice.indexOf(item);
    if (isBasic) {
      const n = practice.slice(0, practiceIndex + 1).filter((x) => x.question.type === 'basic').length;
      if (basicEl) basicEl.textContent = of(n, basicTotal);
      if (specEl) specEl.textContent = of(0, specTotal);
    } else {
      const n = practice.slice(0, practiceIndex + 1).filter((x) => x.question.type === 'specialist').length;
      if (basicEl) basicEl.textContent = of(basicTotal, basicTotal);
      if (specEl) specEl.textContent = of(n, specTotal);
    }
    basicCounter?.classList.toggle('active', isBasic);
    specCounter?.classList.toggle('active', !isBasic);
    return;
  }

  const basicTotal = state.rules.basicQuestions;
  const specTotal = state.rules.specialistQuestions;

  const scored = scoredQuestions();
  const scoredIndex = scored.indexOf(item);
  if (isBasic) {
    const n = scored.slice(0, scoredIndex + 1).filter((x) => x.question.type === 'basic').length;
    if (basicEl) basicEl.textContent = of(n, basicTotal);
    if (specEl) specEl.textContent = of(0, specTotal);
  } else {
    const basicCount = scored.filter((x) => x.question.type === 'basic').length;
    const n = scored.slice(0, scoredIndex + 1).filter((x) => x.question.type === 'specialist').length;
    if (basicEl) basicEl.textContent = of(basicCount, basicTotal);
    if (specEl) specEl.textContent = of(n, specTotal);
  }
  basicCounter?.classList.toggle('active', isBasic);
  specCounter?.classList.toggle('active', !isBasic);
}

function removeAnswerDelegate() {
  if (answerDelegateHandler) {
    const answersContainer = document.querySelector('.answers');
    if (answersContainer) {
      answersContainer.removeEventListener('click', answerDelegateHandler);
    }
    answerDelegateHandler = null;
  }
}

function isActiveExam() {
  return Boolean(state && state.started && !state.finished);
}

function setupBeforeUnloadWarning() {
  if (beforeUnloadHandler) return;
  beforeUnloadHandler = (event) => {
    if (!isActiveExam()) return;
    event.preventDefault();
    event.returnValue = '';
  };
  window.addEventListener('beforeunload', beforeUnloadHandler);
}

function teardownBeforeUnloadWarning() {
  if (!beforeUnloadHandler) return;
  window.removeEventListener('beforeunload', beforeUnloadHandler);
  beforeUnloadHandler = null;
}

function scoredQuestions() {
  return state.questions.filter((item) => !item.practice);
}

function currentItem() {
  return state?.questions[state.currentIndex] ?? null;
}

function updatePracticeBanner() {
  const quiz = document.getElementById('quiz');
  const banner = document.querySelector('.exam-practice-banner');
  const topic = document.querySelector('.word-topic-text');
  if (topic) {
    topic.textContent = '';
    topic.hidden = true;
  }
  const practice = Boolean(currentItem()?.practice);
  quiz?.classList.toggle('exam-practice', practice);
  if (!banner) return;
  banner.hidden = !practice;
  banner.textContent = t('examPracticeBanner');
}

function isOnLastQuestion() {
  return Boolean(state && state.currentIndex >= state.questions.length - 1);
}

function isPracticeItem(item = currentItem()) {
  return Boolean(item?.practice);
}

function secondUnit(n) {
  if (getLang() !== 'pl') {
    return n === 1 ? t('examSecondOne') : t('examSecondMany');
  }
  if (n === 1) return t('examSecondOne');
  const mod10 = n % 10;
  const mod100 = n % 100;
  if (mod10 >= 2 && mod10 <= 4 && (mod100 < 12 || mod100 > 14)) return t('examSecondFew');
  return t('examSecondMany');
}

function practiceHandoffHtml(seconds) {
  const text = t('examPracticeDoneDesc')
    .replace('{n}', '{n}')
    .replace('{unit}', secondUnit(seconds));
  return text.replace('{n}', `<strong class="exam-handoff-count">${seconds}</strong>`);
}

function stopPracticeHandoffTimer() {
  if (state?.handoffTimer) {
    clearInterval(state.handoffTimer);
    state.handoffTimer = null;
  }
}

function showPracticeHandoff() {
  if (!state || state.finished) return;
  stopPracticeHandoffTimer();
  stopQuestionClock();
  const timerDisplay = questionTimerDisplay();
  timerDisplay?.classList.remove('warning');
  stopWatchClock();
  const video = quizCard()?.querySelector('video');
  if (video) video.pause();
  state.practiceHandoff = true;
  let remaining = 30;
  const paint = () => {
    const el = document.getElementById('modal-desc');
    if (el) el.innerHTML = practiceHandoffHtml(remaining);
  };
  showConfirmModal(
    t('examPracticeDoneTitle'),
    practiceHandoffHtml(remaining),
    () => {
      stopPracticeHandoffTimer();
      state.practiceHandoff = false;
      const nextIndex = state.questions.findIndex((item) => !item.practice);
      if (nextIndex < 0) {
        finishExam();
        return;
      }
      state.currentIndex = nextIndex;
      showQuestion();
    },
    {
      confirmLabel: t('examPracticeDoneStart'),
      hideCancel: true,
      handoff: true,
      html: true,
      confirmVariant: 'word-yellow',
    }
  );
  paint();
  state.handoffTimer = setInterval(() => {
    if (!state?.practiceHandoff) {
      stopPracticeHandoffTimer();
      return;
    }
    remaining -= 1;
    if (remaining <= 0) {
      stopPracticeHandoffTimer();
      confirmModalAction();
      return;
    }
    paint();
  }, 1000);
}

function clearNextGuard() {
  nextGuardUntil = 0;
  if (nextGuardTimer) {
    clearTimeout(nextGuardTimer);
    nextGuardTimer = 0;
  }
}

function isNextGuarded() {
  return Date.now() < nextGuardUntil;
}

function armNextGuard() {
  clearNextGuard();
  nextGuardUntil = Date.now() + NEXT_GUARD_MS;
  nextGuardTimer = setTimeout(() => {
    nextGuardTimer = 0;
    nextGuardUntil = 0;
    if (state?.started && !state?.finished) updateExamNextButton();
  }, NEXT_GUARD_MS);
}

function updateExamNextButton() {
  const btn = document.querySelector('.btn-exam-next');
  if (!btn) return;
  const running = Boolean(state?.started && !state?.finished);
  const lastScored = running && isOnLastQuestion() && !isPracticeItem();
  btn.classList.toggle('visible', running);
  btn.disabled = !running || lastScored || isNextGuarded();
}

function setPhaseLabel(key) {
  const label = document.querySelector('.timer-label[data-i18n="questionTimer"]');
  if (label) label.textContent = t(key);
  const caption = document.querySelector('.exam-phase-caption');
  if (!caption) return;
  const captionKey = {
    examPhaseRead: 'examPhaseReadCaption',
    examPhaseAnswer: 'examPhaseAnswerCaption',
  }[key];
  caption.textContent = captionKey ? t(captionKey) : '';
}

function questionTimerDisplay() {
  return document.querySelector('.timer-display-question') || document.querySelector('.timer-display');
}

function paintQuestionClock(remaining, total) {
  const questionTimerEl = document.querySelector('.question-timer');
  const fill = document.querySelector('.exam-time-fill');
  const timerDisplay = questionTimerDisplay();
  if (questionTimerEl) questionTimerEl.textContent = formatQuestionSeconds(remaining);
  if (fill && total > 0) {
    const elapsedRatio = Math.min(1, Math.max(0, 1 - remaining / total));
    fill.style.transform = `scaleX(${elapsedRatio})`;
    if (timerDisplay?.classList.contains('paused')) {
      fill.style.backgroundColor = '#9ca3af';
    } else {
      const p = Math.max(0, Math.min(1, remaining / total));
      fill.style.backgroundColor = `hsl(${(125 * p).toFixed(1)} 80% 46%)`;
    }
  }
  timerDisplay?.classList.toggle('warning', remaining <= 5);
}

function stopQuestionClock() {
  if (state?.clockSource === 'question') state.clockSource = null;
  if (!state?.questionTimer) return;
  state.questionTimer.stop();
  state.questionTimer.onTick = () => {};
  state.questionTimer.onExpire = () => {};
}

function holdAnswerClock() {
  const seconds = state.rules.basicAnswerTimeSeconds;
  state.clockSource = 'hold';
  paintQuestionClock(seconds, seconds);
  questionTimerDisplay()?.classList.remove('warning', 'paused');
  setPhaseLabel('examPhaseAnswer');
}

function startQuestionTimer(seconds, onExpire) {
  const timerDisplay = questionTimerDisplay();
  stopWatchClock();
  stopQuestionClock();
  state.clockSource = 'question';
  state.questionTimer.reset(seconds);
  state.questionTimer.onTick = (remaining, total) => {
    if (state?.clockSource !== 'question') return;
    paintQuestionClock(remaining, total);
  };
  state.questionTimer.onExpire = () => {
    if (state?.clockSource !== 'question') return;
    onExpire();
  };
  paintQuestionClock(seconds, seconds);
  timerDisplay?.classList.remove('warning', 'paused');
  state.questionTimer.start();
}

function cancelExamIntroIfPending() {
  if (!state || state.finished || state.started || !state.introPending) return false;
  cleanupExam();
  window.location.hash = 'categories';
  return true;
}

function showExamIntroNotice() {
  if (!state || state.finished) return;
  state.introPending = true;
  const introKey = getPracticeExamEnabled() ? 'examIntroDesc' : 'examIntroDescSkipPractice';
  const introDesc = `${t(introKey)} ${t('examIntroRules')}`;
  showConfirmModal(
    t('examIntroTitle'),
    introDesc,
    () => {
      if (!state || state.finished) return;
      state.introPending = false;
      state.started = true;
      document.querySelector('.btn-end-exam').classList.add('visible');
      setupBeforeUnloadWarning();
      showQuestion();
    },
    {
      confirmLabel: t('examIntroStart'),
      cancelLabel: t('examIntroCancel'),
      confirmVariant: 'secondary',
    }
  );
}

function buildExamItems(pool, practice) {
  return pool.map((q) => ({
    question: q,
    points: practice ? 0 : questionPoints(q),
    given: null,
    isCorrect: false,
    locked: false,
    timedOut: false,
    practice,
  }));
}

export function startExam(categoryData, meta) {
  const rules = {
    ...meta.exam,
    basicPoints: [...meta.exam.basicPoints],
    specialistPoints: [...meta.exam.specialistPoints],
    basicAnswerTimeSeconds: meta.exam.basicAnswerTimeSeconds || 15,
    specialistTimeSeconds: meta.exam.specialistTimeSeconds || 50,
  };
  const basic = categoryData.questions.filter(q => q.type === 'basic');
  const specialist = categoryData.questions.filter(q => q.type === 'specialist');
  const basicPick = pickByPointRecipe(basic, BASIC_POINT_DRAW);
  const specialistPick = pickByPointRecipe(specialist, SPECIALIST_POINT_DRAW);
  const selectedBasic = basicPick.picked;
  const selectedSpecialist = specialistPick.picked;
  const leftoverBasic = shuffle(basic.filter(q => !basicPick.used.has(q.id)));
  const leftoverSpecialist = shuffle(specialist.filter(q => !specialistPick.used.has(q.id)));

  const originalMaxPoints = rules.maxPoints;
  rules.basicQuestions = selectedBasic.length;
  rules.specialistQuestions = selectedSpecialist.length;
  const newMaxPoints = selectedBasic.reduce((s, q) => s + questionPoints(q), 0)
    + selectedSpecialist.reduce((s, q) => s + questionPoints(q), 0);
  if (newMaxPoints > 0 && newMaxPoints !== originalMaxPoints) {
    rules.maxPoints = newMaxPoints;
    rules.passThreshold = Math.round(rules.passThreshold * (newMaxPoints / originalMaxPoints));
  }

  const includePractice = getPracticeExamEnabled();
  const practiceBasic = includePractice
    ? pickPractice(leftoverBasic, basic, PRACTICE_BASIC_COUNT)
    : [];
  const practiceSpecialist = includePractice
    ? pickPractice(leftoverSpecialist, specialist, PRACTICE_SPECIALIST_COUNT)
    : [];
  const practicePool = [...practiceBasic, ...practiceSpecialist];

  const questions = [
    ...buildExamItems(practicePool, true),
    ...shuffle(buildExamItems(selectedBasic, false)),
    ...shuffle(buildExamItems(selectedSpecialist, false)),
  ];

  state = {
    category: categoryData.category,
    questions,
    currentIndex: 0,
    rules,
    questionTimer: null,
    examTimer: null,
    started: false,
    introPending: false,
    finished: false,
    phase: 'read',
    examClockStarted: false,
    practiceHandoff: false,
    clockSource: null,
  };

  const questionClock = questionTimerDisplay();
  const totalClock = document.querySelector('.timer-display-total') || questionClock;
  const totalTimerEl = document.querySelector('.total-timer');

  state.questionTimer = new QuestionTimer(rules.basicTimeSeconds, () => {}, () => {});

  state.examTimer = new ExamTimer(
    rules.totalTimeSeconds,
    (remaining) => {
      totalTimerEl.textContent = formatTime(remaining);
      totalClock.classList.toggle('total-warning', remaining <= 120);
    },
    () => finishExam()
  );

  setExamLayout(true);
  document.querySelector('.learn-nav').classList.remove('visible');
  document.querySelector('.quiz-back').classList.remove('visible');
  document.querySelector('.btn-end-exam').classList.remove('visible');
  questionClock.classList.remove('warning', 'paused', 'total-warning');
  totalClock.classList.remove('total-warning');
  totalTimerEl.textContent = formatTime(rules.totalTimeSeconds);

  removeAnswerDelegate();
  const answersContainer = document.querySelector('.answers');
  answerDelegateHandler = (e) => {
    const btn = e.target.closest('.answer-btn');
    if (btn && answersContainer.contains(btn)) {
      handleAnswer(btn.dataset.answer);
    }
  };
  answersContainer.addEventListener('click', answerDelegateHandler);

  if (keydownHandler) document.removeEventListener('keydown', keydownHandler);
  keydownHandler = (e) => {
    if (document.getElementById('confirm-modal')?.classList.contains('active')) return;
    if (!state || state.finished || !state.started) return;
    const item = currentItem();
    if (!item || item.locked) return;
    const key = e.key.toLowerCase();
    const answersDiv = document.querySelector('.answers');
    const isBasic = answersDiv?.classList.contains('yn-answers');

    if (state.phase === 'read' && (key === 'enter' || key === ' ')) {
      e.preventDefault();
      beginMediaPlayback();
      return;
    }

    if (key === 'enter' && state.phase === 'answer') {
      e.preventDefault();
      if (!isNextGuarded()) confirmAndAdvance();
      return;
    }

    if (isBasic) {
      if (key === 't' || key === '1') { e.preventDefault(); handleAnswer('T'); }
      else if (key === 'n' || key === '2') { e.preventDefault(); handleAnswer('N'); }
    } else {
      if (key === '1') { e.preventDefault(); handleAnswer('A'); }
      else if (key === '2') { e.preventDefault(); handleAnswer('B'); }
      else if (key === '3') { e.preventDefault(); handleAnswer('C'); }
    }
  };
  document.addEventListener('keydown', keydownHandler);

  showExamIntroNotice();
}

function ensureExamClock() {
  const item = currentItem();
  if (!item || item.practice || state.examClockStarted) return;
  state.examClockStarted = true;
  state.examTimer.start();
}

function showQuestion() {
  if (!state || state.finished || !state.started) return;
  stopWatchClock();
  stopQuestionClock();
  window.scrollTo({ top: 0, behavior: 'smooth' });
  const item = currentItem();
  const q = item.question;
  const scored = scoredQuestions();
  const scoredIndex = scored.indexOf(item);

  if (item.practice) {
    const practiceTotal = state.questions.filter((x) => x.practice).length;
    const practiceIndex = state.questions.filter((x) => x.practice).indexOf(item);
    document.querySelector('.question-progress').textContent =
      `${t('examPracticeShort')} ${practiceIndex + 1} / ${practiceTotal}`;
    document.querySelector('.progress-fill').style.width =
      `${((practiceIndex + 1) / practiceTotal) * 100}%`;
  } else {
    document.querySelector('.question-progress').textContent =
      `${scoredIndex + 1} / ${scored.length}`;
    document.querySelector('.progress-fill').style.width =
      `${((scoredIndex + 1) / scored.length) * 100}%`;
  }

  item.given = null;
  item.locked = false;
  item.timedOut = false;
  item.isCorrect = false;
  setExamPhase('idle');

  renderQuestion(q, quizCard(), { examMedia: true, hideFilm: isBasicFilm(item) });
  setAnswerButtonsEnabled(true);
  updateExamChrome();
  updatePracticeBanner();
  updateExamNextButton();
  ensureExamClock();

  const next = state.questions[state.currentIndex + 1];
  if (next) preloadMedia(next.question);

  if (q.type === 'specialist') {
    beginAnswerPhase();
    const video = quizCard().querySelector('video');
    if (video) playExamVideo(quizCard());
    refitUiScale();
    return;
  }

  setExamPhase('read');
  setPhaseLabel('examPhaseRead');
  if (isBasicFilm(item)) {
    startQuestionTimer(state.rules.basicTimeSeconds, () => beginMediaPlayback());
  } else {
    startQuestionTimer(state.rules.basicTimeSeconds, () => beginAnswerPhase());
  }
  updateFilmStartButton();
  refitUiScale();
}

function stopWatchClock() {
  watchGen += 1;
  if (watchRaf) {
    cancelAnimationFrame(watchRaf);
    watchRaf = 0;
  }
  if (watchVideo) {
    if (watchEndedHandler) watchVideo.removeEventListener('ended', watchEndedHandler);
    watchVideo = null;
  }
  watchEndedHandler = null;
}

function bindFilmEnd(video) {
  stopWatchClock();
  if (!state) return;
  const gen = watchGen;
  watchVideo = video;
  watchEndedHandler = () => {
    if (gen !== watchGen || state?.phase !== 'watch') return;
    if (Number.isFinite(video.duration) && video.duration > 0.2 && video.currentTime < 0.1) return;
    beginAnswerPhase();
  };
  video.addEventListener('ended', watchEndedHandler);
  let armed = false;
  const tick = () => {
    if (gen !== watchGen || state?.phase !== 'watch') return;
    if (!video.paused && video.currentTime > 0.05) armed = true;
    if (armed && (video.ended || video.dataset.examEnded === '1')) {
      beginAnswerPhase();
      return;
    }
    watchRaf = requestAnimationFrame(tick);
  };
  watchRaf = requestAnimationFrame(tick);
}

function beginMediaPlayback() {
  if (!state || state.finished || state.phase !== 'read' || state.practiceHandoff) return;
  if (!isBasicFilm(currentItem())) {
    beginAnswerPhase();
    return;
  }
  const video = quizCard()?.querySelector('video');
  if (!video) {
    beginAnswerPhase();
    return;
  }
  stopQuestionClock();
  setExamPhase('watch');
  updateFilmStartButton();
  try {
    video.pause();
    if (video.currentTime !== 0) video.currentTime = 0;
  } catch {}
  delete video.dataset.examEnded;
  bindFilmEnd(video);
  holdAnswerClock();
  playExamVideo(quizCard()).then((ok) => {
    if (!ok && state?.phase === 'watch') beginAnswerPhase();
  });
}

function beginAnswerPhase() {
  if (!state || state.finished || state.phase === 'answer') return;
  stopWatchClock();
  stopQuestionClock();
  setExamPhase('answer');
  setPhaseLabel('examPhaseAnswer');
  setAnswerButtonsEnabled(true);
  const item = currentItem();
  const seconds = item?.question.type === 'basic'
    ? state.rules.basicAnswerTimeSeconds
    : state.rules.specialistTimeSeconds;
  startQuestionTimer(seconds, () => {
    const current = currentItem();
    if (!current || current.locked) return;
    current.timedOut = !current.given;
    confirmAndAdvance();
  });
  updateExamNextButton();
  updateFilmStartButton();
}

function handleAnswer(answer) {
  if (!state || state.finished || !state.started) return;
  const item = currentItem();
  if (!item || item.locked) return;
  item.given = answer;
  item.isCorrect = answer === item.question.correct;
  markSelectedAnswer(document.querySelector('.answers'), answer);
  updateExamNextButton();
}

function confirmAndAdvance() {
  if (!state || state.finished || !state.started || isNextGuarded()) return;
  const item = currentItem();
  if (!item || item.locked) return;
  const next = state.questions[state.currentIndex + 1];
  if (item.practice && (!next || !next.practice)) {
    showPracticeHandoff();
    return;
  }
  item.locked = true;
  item.isCorrect = item.given === item.question.correct;
  stopWatchClock();
  stopQuestionClock();
  setAnswerButtonsEnabled(false);
  updateExamNextButton();
  advanceQuestion();
}

function advanceQuestion() {
  if (!state || state.finished || !state.started) return;
  if (isOnLastQuestion()) {
    updateExamNextButton();
    return;
  }
  state.currentIndex++;
  armNextGuard();
  showQuestion();
}

function finishExam() {
  if (!state || state.finished) return;
  stopPracticeHandoffTimer();
  stopWatchClock();
  state.finished = true;
  state.introPending = false;
  stopQuestionClock();
  state.examTimer.stop();
  teardownBeforeUnloadWarning();
  if (keydownHandler) {
    document.removeEventListener('keydown', keydownHandler);
    keydownHandler = null;
  }
  removeAnswerDelegate();
  updateExamNextButton();
  updatePracticeBanner();
  setPhaseLabel('questionTimer');

  const scored = scoredQuestions();
  const basicAnswers = scored.filter(a => a.question.type === 'basic');
  const specialistAnswers = scored.filter(a => a.question.type === 'specialist');

  const basicScore = basicAnswers.reduce((sum, a) => sum + (a.isCorrect ? a.points : 0), 0);
  const specialistScore = specialistAnswers.reduce((sum, a) => sum + (a.isCorrect ? a.points : 0), 0);
  const score = basicScore + specialistScore;

  const result = {
    category: state.category,
    score,
    maxPoints: state.rules.maxPoints,
    passed: score >= state.rules.passThreshold,
    basicScore,
    specialistScore,
    answers: scored,
  };

  lastExamCategory = state.category;
  try {
    sessionStorage.setItem(LAST_EXAM_CATEGORY_KEY, lastExamCategory);
  } catch {}
  saveResult(result);
  saveLastResult(result);
  renderResults(result);
  window.location.hash = 'results';
}

export function refreshExamQuestion() {
  if (!state || state.finished || !state.started) return;
  const item = currentItem();
  renderQuestion(item.question, quizCard(), {
    examMedia: true,
    hideFilm: state.phase === 'read' && isBasicFilm(item),
  });
  setAnswerButtonsEnabled(!item.locked);
  if (item.given) markSelectedAnswer(document.querySelector('.answers'), item.given);
  updateExamChrome();
  updatePracticeBanner();
  updateExamNextButton();
  updateFilmStartButton();
  setExamPhase(state.phase);
  if (state.phase === 'read') setPhaseLabel('examPhaseRead');
  else if (state.phase === 'watch') {
    holdAnswerClock();
    const video = quizCard()?.querySelector('video');
    if (video) {
      bindFilmEnd(video);
      playExamVideo(quizCard());
    } else {
      beginAnswerPhase();
    }
  } else {
    setPhaseLabel('examPhaseAnswer');
  }
}

export function setupExamListeners() {
  document.querySelector('.btn-end-exam').addEventListener('click', () => {
    if (!state || state.finished) return;
    if (!state.started) {
      cancelExamIntroIfPending();
      return;
    }
    if (isPracticeItem()) {
      showPracticeHandoff();
      return;
    }
    showConfirmModal(
      t('confirmEndExam'),
      '',
      () => finishExam(),
      {
        confirmLabel: t('endExam'),
        cancelLabel: t('confirmReturnToExam'),
        confirmVariant: 'word-orange',
        cancelVariant: 'word-yellow',
        wordEnd: true,
      }
    );
  });

  document.querySelector('.btn-exam-next')?.addEventListener('click', () => {
    if (isNextGuarded()) return;
    confirmAndAdvance();
  });

  document.querySelector('.exam-film-start')?.addEventListener('click', () => {
    beginMediaPlayback();
  });

  document.querySelector('.btn-confirm-end').addEventListener('click', () => {
    confirmModalAction();
  });

  document.querySelector('.btn-cancel-end').addEventListener('click', () => {
    if (cancelExamIntroIfPending()) return;
    if (state?.practiceHandoff) return;
    hideModal();
  });

  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape' && document.getElementById('confirm-modal').classList.contains('active')) {
      if (cancelExamIntroIfPending()) return;
      if (state?.practiceHandoff) return;
      hideModal();
    }
  });

  document.getElementById('confirm-modal').addEventListener('keydown', (e) => {
    if (e.key !== 'Tab') return;
    const buttons = [...document.getElementById('confirm-modal').querySelectorAll('button')]
      .filter((btn) => !btn.hidden);
    const first = buttons[0];
    const last = buttons[buttons.length - 1];
    if (e.shiftKey && document.activeElement === first) { e.preventDefault(); last.focus(); }
    else if (!e.shiftKey && document.activeElement === last) { e.preventDefault(); first.focus(); }
  });
}

export function cleanupExam() {
  clearNextGuard();
  if (keydownHandler) {
    document.removeEventListener('keydown', keydownHandler);
    keydownHandler = null;
  }
  teardownBeforeUnloadWarning();
  removeAnswerDelegate();
  if (state) {
    stopPracticeHandoffTimer();
    stopWatchClock();
    stopQuestionClock();
    state.examTimer?.stop();
    state = null;
  }
  const video = document.querySelector('.media-area video');
  if (video) { video.pause(); video.removeAttribute('src'); video.load(); }
  setExamLayout(false);
  document.querySelector('.btn-end-exam').classList.remove('visible');
  document.querySelector('.btn-exam-next')?.classList.remove('visible');
  const banner = document.querySelector('.exam-practice-banner');
  if (banner) banner.hidden = true;
  document.getElementById('quiz')?.classList.remove('exam-practice');
  document.getElementById('quiz')?.removeAttribute('data-exam-phase');
  const topic = document.querySelector('.word-topic-text');
  if (topic) topic.hidden = false;
  questionTimerDisplay()?.classList.remove('warning', 'paused', 'total-warning');
  document.querySelector('.timer-display-total')?.classList.remove('total-warning');
  setPhaseLabel('questionTimer');
  hideModal();
}
