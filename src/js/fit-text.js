// fit-text.js — Panel: fit question and ABC copy into the dock slots.
// Wrap to slot width, then shrink so the lines fit the slot height.
// Question is independent; A/B/C share the smallest size that fits all three.
// Write inline font-size (CSS vars on reused nodes paint a frame late).

const MIN_PX = 7;
const MAX_PX = 32;
const PRECISION = 0.25;
const ABC_Q_FRAC = 0.36;
const ABC_A_FRAC = 0.64;

let measureCtx = null;
let fitGen = 0;
let layoutTries = 0;
let lastFitKey = '';
const LAYOUT_TRIES = 6;

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

function padding(el) {
  const cs = getComputedStyle(el);
  return {
    x: parseFloat(cs.paddingLeft) + parseFloat(cs.paddingRight),
    y: parseFloat(cs.paddingTop) + parseFloat(cs.paddingBottom),
  };
}

/** Landscape dock row from the design canvas (800×35% Panel, 28% Station).
 *  Live clientHeight follows media paint on a slow VM; design height does not. */
function dockRowHeight(dock) {
  const root = document.documentElement;
  if (root.getAttribute('data-ui-orient') === 'portrait') {
    return Math.max(dock.clientHeight, 40);
  }
  const frac = root.getAttribute('data-exam-skin') === 'station' ? 0.28 : 0.35;
  const designH = parseFloat(root.style.getPropertyValue('--ui-design-height'))
    || parseFloat(getComputedStyle(root).getPropertyValue('--ui-design-height'))
    || 800;
  return designH * frac;
}

function currentFitKey(dock) {
  const id = document.querySelector('#quiz .question-card')?.dataset.questionId || '';
  const q = dock.querySelector('.question-text')?.textContent || '';
  const a = [...dock.querySelectorAll('.answer-text')].map((el) => el.textContent).join('\0');
  const scale = getComputedStyle(document.documentElement).getPropertyValue('--ui-scale').trim();
  return `${id}|${Math.round(window.innerWidth)}x${Math.round(window.innerHeight)}|${scale}|${q}|${a}`;
}

function questionBox(el, asAbc) {
  const dock = el.closest('.quiz-dock');
  const pad = padding(el);
  const abc = asAbc || dock?.querySelector('.abc-answers');
  return {
    ...fontMetrics(el),
    width: Math.max(0, el.clientWidth - pad.x),
    height: abc && dock
      ? Math.max(0, dockRowHeight(dock) * ABC_Q_FRAC - pad.y)
      : Math.max(0, el.clientHeight - pad.y),
  };
}

function abcAnswerBox(dock, sampleEl) {
  const root = document.documentElement;
  const designW = parseFloat(root.style.getPropertyValue('--ui-design-width')) || 1280;
  const designH = parseFloat(root.style.getPropertyValue('--ui-design-height')) || 800;
  const padY = (6 / 620) * designH;
  const labelW = (50 / 960) * designW;
  const btnGap = (10 / 960) * designW;
  return {
    ...fontMetrics(sampleEl),
    width: Math.max(0, dock.clientWidth - labelW - btnGap),
    height: Math.max(0, (dockRowHeight(dock) * ABC_A_FRAC) / 3 - padY),
  };
}

function applyDockFont(dock, slot, px) {
  if (px == null) return;
  const css = `${px}px`;
  if (slot === 'a') dock.style.setProperty('--dock-a-size', css);
  const els = slot === 'a'
    ? [...dock.querySelectorAll('.answer-text')]
    : [dock.querySelector('.question-text')].filter(Boolean);
  for (const el of els) el.style.fontSize = css;
}

function labelReserve(btn) {
  const label = btn.querySelector('.answer-label');
  if (!label) return 0;
  const cs = getComputedStyle(label);
  const specified = parseFloat(cs.minWidth) || parseFloat(cs.width) || 0;
  return Math.max(label.offsetWidth, specified);
}

function answerBox(el) {
  const fonts = fontMetrics(el);
  const btn = el.closest('.answer-btn');
  const dock = el.closest('.quiz-dock');
  if (!btn || !dock) {
    const pad = padding(el);
    return {
      ...fonts,
      width: Math.max(0, el.clientWidth - pad.x),
      height: Math.max(0, el.clientHeight - pad.y),
    };
  }
  const answers = dock.querySelector('.abc-answers');
  const n = Math.max(1, answers?.querySelectorAll('.answer-btn').length || 3);
  const gap = parseFloat(getComputedStyle(answers).rowGap || getComputedStyle(answers).gap) || 0;
  const pad = padding(btn);
  const btnGap = parseFloat(getComputedStyle(btn).gap) || 0;
  return {
    ...fonts,
    width: Math.max(0, dock.clientWidth - labelReserve(btn) - btnGap - pad.x),
    height: Math.max(0, (dockRowHeight(dock) * ABC_A_FRAC - gap * (n - 1)) / n - pad.y),
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

function stripInlineFonts(dock) {
  dock.querySelectorAll('.abc-answers .answer-btn').forEach((el) => {
    el.style.removeProperty('font-size');
  });
}

function fitQuestion(dock) {
  const el = dock.querySelector('.question-text');
  if (!el) return true;
  const px = largestFit(el.textContent, questionBox(el));
  if (px == null) return false;
  applyDockFont(dock, 'q', px);
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
  applyDockFont(dock, 'a', shared);
  return true;
}

function clearInlineSizes(dock) {
  stripInlineFonts(dock);
  dock.style.removeProperty('--dock-a-size');
  dock.querySelector('.question-text')?.style.removeProperty('font-size');
  dock.querySelectorAll('.answer-text').forEach((el) => {
    el.style.removeProperty('font-size');
  });
}

/** New <p> for the question (reused nodes keep the previous used font-size). */
export function prepareDockFit(dock, q) {
  const old = dock?.querySelector('.question-text');
  if (!dock || !q || !old) return;
  if (!isPanelFit()) {
    old.textContent = q.q || '';
    return;
  }
  const asAbc = q.type !== 'basic';
  const px = q.q ? largestFit(q.q, questionBox(old, asAbc)) : null;
  const p = document.createElement('p');
  p.className = 'question-text';
  p.setAttribute('aria-live', 'polite');
  p.textContent = q.q || '';
  if (px != null) p.style.fontSize = `${px}px`;
  old.replaceWith(p);
  if (asAbc) {
    const box = abcAnswerBox(dock, p);
    let shared = null;
    for (const raw of [q.a, q.b, q.c]) {
      const answerPx = largestFit(raw, box);
      if (answerPx == null) {
        shared = null;
        break;
      }
      if (shared == null || answerPx < shared) shared = answerPx;
    }
    if (shared != null) applyDockFont(dock, 'a', shared);
  } else {
    dock.style.removeProperty('--dock-a-size');
  }
}

function dockReady(dock) {
  if (dock.clientWidth < 8 || dock.clientHeight < 40) return false;
  const abc = dock.querySelector('.abc-answers');
  if (abc && abc.querySelectorAll('.answer-btn').length < 3) return false;
  return true;
}

function retryFit() {
  if (layoutTries >= LAYOUT_TRIES) {
    layoutTries = 0;
    return;
  }
  layoutTries += 1;
  const gen = fitGen;
  requestAnimationFrame(() => {
    if (gen !== fitGen) return;
    fitQuizDockText();
  });
}

export function fitQuizDockText() {
  const dock = quizDock();
  if (!dock || !isPanelFit()) {
    if (dock) clearInlineSizes(dock);
    layoutTries = 0;
    lastFitKey = '';
    return;
  }
  void dock.offsetHeight;
  if (!dockReady(dock)) {
    retryFit();
    return;
  }
  const key = currentFitKey(dock);
  if (key && key === lastFitKey) {
    layoutTries = 0;
    return;
  }
  const ready = fitQuestion(dock)
    && (!dock.querySelector('.abc-answers') || fitAnswers(dock));
  if (!ready) {
    retryFit();
    return;
  }
  lastFitKey = key;
  layoutTries = 0;
}

export function scheduleFitQuizDockText() {
  fitGen += 1;
  layoutTries = 0;
  const dock = quizDock();
  if (dock && isPanelFit()) {
    void dock.offsetHeight;
    if (dockReady(dock)) {
      fitQuizDockText();
      return;
    }
  }
  const gen = fitGen;
  requestAnimationFrame(() => {
    if (gen !== fitGen) return;
    fitQuizDockText();
  });
}
