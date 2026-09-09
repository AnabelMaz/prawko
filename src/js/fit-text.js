// fit-text.js — Panel: scale question and ABC copy to the slot.
// Runs only when a question is shown and when the window scale/layout
// updates. Does not hide text and does not watch the dock for its own
// font-size writes (that looped 7px ↔ 32px and blanked the copy).
//
// Fit rule: wrap at the slot width, then check that the resulting 1–n
// lines fit in the slot height. Question scales alone; A/B/C share the
// smallest size that still fits the longest option.

const MIN_PX = 7;
const MAX_PX = 32;
const PRECISION = 0.25;

let measureCtx = null;
let fitGen = 0;
let retrying = false;

function isPanelFit() {
  const root = document.documentElement;
  return root.getAttribute('data-exam-skin') === 'panel'
    && root.getAttribute('data-ui-mode') === 'fit';
}

function quizDock() {
  return document.querySelector('#quiz.active:is(.exam-active, .learn-active) .quiz-dock');
}

function getCtx() {
  if (measureCtx) return measureCtx;
  const canvas = document.createElement('canvas');
  measureCtx = canvas.getContext('2d');
  return measureCtx;
}

function lineHeightRatio(cs) {
  const fs = parseFloat(cs.fontSize) || 16;
  const lh = cs.lineHeight;
  if (!lh || lh === 'normal') return 1.25;
  if (lh.endsWith('px')) {
    const px = parseFloat(lh);
    return px > 0 && fs > 0 ? px / fs : 1.25;
  }
  const n = parseFloat(lh);
  return Number.isFinite(n) && n > 0.5 && n < 8 ? n : 1.25;
}

function fontMetrics(el) {
  const cs = getComputedStyle(el);
  return {
    fontFamily: cs.fontFamily,
    fontWeight: cs.fontWeight,
    fontStyle: cs.fontStyle,
    ratio: lineHeightRatio(cs),
  };
}

function innerSize(el) {
  const cs = getComputedStyle(el);
  const padX = parseFloat(cs.paddingLeft) + parseFloat(cs.paddingRight);
  const padY = parseFloat(cs.paddingTop) + parseFloat(cs.paddingBottom);
  return {
    width: Math.max(0, el.clientWidth - padX),
    height: Math.max(0, el.clientHeight - padY),
  };
}

function questionBox(el) {
  return { ...fontMetrics(el), ...innerSize(el) };
}

function answerBox(el) {
  const fonts = fontMetrics(el);
  const btn = el.closest('.answer-btn');
  if (!btn) return { ...fonts, ...innerSize(el) };
  const size = innerSize(btn);
  const label = btn.querySelector('.answer-label');
  const gap = parseFloat(getComputedStyle(btn).gap) || 0;
  const labelW = label ? label.offsetWidth : 0;
  return {
    ...fonts,
    width: Math.max(0, size.width - labelW - gap),
    height: size.height,
  };
}

function setMeasureFont(ctx, box, px) {
  ctx.font = `${box.fontStyle || 'normal'} ${box.fontWeight || '400'} ${px}px ${box.fontFamily}`;
}

function wrappedLineCount(ctx, text, maxW) {
  const words = String(text).trim().split(/\s+/).filter(Boolean);
  if (!words.length) return 1;
  if (maxW < 1) return Infinity;
  const spaceW = ctx.measureText(' ').width;
  let lines = 1;
  let lineW = 0;

  const startLine = (width) => {
    lines += 1;
    lineW = width;
  };

  const addToLine = (width) => {
    if (lineW === 0) {
      lineW = width;
      return;
    }
    if (lineW + spaceW + width <= maxW) {
      lineW += spaceW + width;
      return;
    }
    startLine(width);
  };

  const charsThatFit = (str, budget) => {
    if (ctx.measureText(str).width <= budget) return str.length;
    let lo = 1;
    let hi = str.length;
    while (lo < hi) {
      const mid = Math.ceil((lo + hi) / 2);
      if (ctx.measureText(str.slice(0, mid)).width <= budget) lo = mid;
      else hi = mid - 1;
    }
    return Math.max(1, lo);
  };

  for (const word of words) {
    let rest = word;
    while (rest) {
      const wordW = ctx.measureText(rest).width;
      if (wordW <= maxW) {
        addToLine(wordW);
        break;
      }
      if (lineW > 0) startLine(0);
      const take = charsThatFit(rest, maxW);
      addToLine(ctx.measureText(rest.slice(0, take)).width);
      rest = rest.slice(take);
      if (rest) startLine(0);
    }
  }
  return lines;
}

function textFits(text, box, px) {
  const ctx = getCtx();
  setMeasureFont(ctx, box, px);
  const lines = wrappedLineCount(ctx, text, box.width);
  return lines * px * (box.ratio || 1.25) <= box.height + 0.75;
}

function largestFit(text, box) {
  const raw = String(text ?? '').trim();
  if (!raw) return MAX_PX;
  if (box.width < 4 || box.height < 4) return null;
  const cap = Math.min(MAX_PX, box.height / (box.ratio || 1.25));
  const hiStart = Math.max(MIN_PX, cap);
  if (textFits(raw, box, hiStart)) return hiStart;
  let lo = MIN_PX;
  let hi = hiStart;
  let best = MIN_PX;
  for (let i = 0; i < 18 && hi - lo > PRECISION; i++) {
    const mid = (lo + hi) / 2;
    if (textFits(raw, box, mid)) {
      best = mid;
      lo = mid;
    } else {
      hi = mid;
    }
  }
  return best;
}

function applySize(el, px) {
  if (px == null) return;
  el.style.fontSize = `${px}px`;
}

function fitQuestion(dock) {
  const el = dock.querySelector('.question-text');
  if (!el) return true;
  const px = largestFit(el.textContent, questionBox(el));
  if (px == null) return false;
  applySize(el, px);
  return true;
}

function fitAnswers(dock) {
  const texts = [...dock.querySelectorAll('.abc-answers .answer-text')];
  if (!texts.length) return true;
  let shared = null;
  for (const el of texts) {
    const px = largestFit(el.textContent, answerBox(el));
    if (px == null) return false;
    if (shared == null || px < shared) shared = px;
  }
  for (const el of texts) applySize(el, shared);
  return true;
}

function clearInlineSizes(dock) {
  dock.querySelector('.question-text')?.style.removeProperty('font-size');
  dock.querySelectorAll('.answer-text').forEach((el) => {
    el.style.removeProperty('font-size');
  });
}

export function fitQuizDockText() {
  const dock = quizDock();
  if (!dock || !isPanelFit()) {
    if (dock) clearInlineSizes(dock);
    return;
  }
  const ready = fitQuestion(dock)
    && (!dock.querySelector('.abc-answers') || fitAnswers(dock));
  if (ready || retrying) return;
  retrying = true;
  requestAnimationFrame(() => {
    retrying = false;
    fitQuizDockText();
  });
}

export function scheduleFitQuizDockText() {
  const gen = ++fitGen;
  requestAnimationFrame(() => {
    if (gen !== fitGen) return;
    requestAnimationFrame(() => {
      if (gen !== fitGen) return;
      fitQuizDockText();
    });
  });
}
