// fit-text.js — Panel dock: grow or shrink question and ABC copy so each
// slot holds its text. Question scales alone; A/B/C share the smallest size
// that still fits the longest option on that question.

const MIN_PX = 7;
const MAX_PX = 32;
const PRECISION = 0.25;

let probe = null;
let observer = null;
let fitGen = 0;
let observingDock = null;

function isPanelFit() {
  const root = document.documentElement;
  return root.getAttribute('data-exam-skin') === 'panel'
    && root.getAttribute('data-ui-mode') === 'fit';
}

function quizDock() {
  return document.querySelector('#quiz.active:is(.exam-active, .learn-active) .quiz-dock');
}

function getProbe() {
  if (probe?.isConnected) return probe;
  probe = document.createElement('div');
  probe.setAttribute('aria-hidden', 'true');
  probe.style.cssText = [
    'position:absolute',
    'left:-99999px',
    'top:0',
    'visibility:hidden',
    'pointer-events:none',
    'z-index:-1',
    'margin:0',
    'padding:0',
    'border:0',
    'overflow:visible',
    'white-space:normal',
    'overflow-wrap:break-word',
  ].join(';');
  document.body.appendChild(probe);
  return probe;
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
  const ratio = lineHeightRatio(cs);
  return {
    fontFamily: cs.fontFamily,
    fontWeight: cs.fontWeight,
    fontStyle: cs.fontStyle,
    lineHeight: String(ratio),
    letterSpacing: cs.letterSpacing,
    wordSpacing: cs.wordSpacing,
    whiteSpace: cs.whiteSpace,
    overflowWrap: cs.overflowWrap,
    wordBreak: cs.wordBreak,
    ratio,
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

function cssMaxPx(el) {
  const prev = el.style.fontSize;
  el.style.fontSize = '';
  const maxPx = parseFloat(getComputedStyle(el).fontSize);
  el.style.fontSize = prev;
  return Number.isFinite(maxPx) && maxPx > 0 ? maxPx : 16;
}

function slotMaxPx(box, cssMax) {
  const fill = box.height / (box.ratio || 1.25);
  return Math.min(MAX_PX, Math.max(cssMax, fill));
}

function largestFit(text, box, maxPx) {
  const raw = String(text ?? '');
  if (!raw || box.width < 4 || box.height < 4) return maxPx;
  const node = getProbe();
  node.textContent = raw;
  node.style.width = `${box.width}px`;
  node.style.fontFamily = box.fontFamily;
  node.style.fontWeight = box.fontWeight;
  node.style.fontStyle = box.fontStyle;
  node.style.lineHeight = box.lineHeight;
  node.style.letterSpacing = box.letterSpacing;
  node.style.wordSpacing = box.wordSpacing;
  node.style.whiteSpace = box.whiteSpace || 'normal';
  node.style.overflowWrap = box.overflowWrap || 'break-word';
  node.style.wordBreak = box.wordBreak || 'normal';
  const hiStart = Math.max(MIN_PX, maxPx);
  node.style.fontSize = `${hiStart}px`;
  if (node.scrollHeight <= box.height + 0.75 && node.scrollWidth <= box.width + 0.75) {
    return hiStart;
  }
  let lo = MIN_PX;
  let hi = hiStart;
  let best = MIN_PX;
  for (let i = 0; i < 18 && hi - lo > PRECISION; i++) {
    const mid = (lo + hi) / 2;
    node.style.fontSize = `${mid}px`;
    const fits = node.scrollHeight <= box.height + 0.75
      && node.scrollWidth <= box.width + 0.75;
    if (fits) {
      best = mid;
      lo = mid;
    } else {
      hi = mid;
    }
  }
  node.style.fontSize = `${best}px`;
  if (node.scrollHeight > box.height + 0.75 || node.scrollWidth > box.width + 0.75) {
    return MIN_PX;
  }
  return best;
}

function applySize(el, px) {
  el.style.fontSize = `${px}px`;
}

function fitQuestion(dock) {
  const el = dock.querySelector('.question-text');
  if (!el) return;
  const box = questionBox(el);
  applySize(el, largestFit(el.textContent, box, slotMaxPx(box, cssMaxPx(el))));
}

function fitAnswers(dock) {
  const texts = [...dock.querySelectorAll('.abc-answers .answer-text')];
  if (!texts.length) return;
  const cssMax = Math.min(...texts.map(cssMaxPx));
  let shared = MAX_PX;
  for (const el of texts) {
    const box = answerBox(el);
    const need = largestFit(el.textContent, box, slotMaxPx(box, cssMax));
    if (need < shared) shared = need;
  }
  for (const el of texts) applySize(el, shared);
}

function clearInlineSizes(dock) {
  dock.querySelector('.question-text')?.style.removeProperty('font-size');
  dock.querySelectorAll('.answer-text').forEach((el) => {
    el.style.removeProperty('font-size');
  });
}

function ensureObserver(dock) {
  if (typeof ResizeObserver === 'undefined') return;
  if (!observer) {
    let timer = 0;
    observer = new ResizeObserver(() => {
      clearTimeout(timer);
      timer = setTimeout(() => scheduleFitQuizDockText(), 40);
    });
  }
  if (observingDock === dock) return;
  if (observingDock) observer.unobserve(observingDock);
  observer.observe(dock);
  observingDock = dock;
}

export function fitQuizDockText() {
  const dock = quizDock();
  if (!dock || !isPanelFit()) {
    if (dock) {
      dock.classList.remove('is-fitting');
      clearInlineSizes(dock);
    }
    return;
  }
  ensureObserver(dock);
  fitQuestion(dock);
  if (dock.querySelector('.abc-answers')) fitAnswers(dock);
  dock.classList.remove('is-fitting');
}

export function scheduleFitQuizDockText() {
  const dock = quizDock();
  if (dock && isPanelFit()) dock.classList.add('is-fitting');
  const gen = ++fitGen;
  requestAnimationFrame(() => {
    if (gen !== fitGen) return;
    requestAnimationFrame(() => {
      if (gen !== fitGen) return;
      fitQuizDockText();
    });
  });
}
