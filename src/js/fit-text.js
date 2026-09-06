// fit-text.js — Panel dock: shrink question and ABC copy until each
// dedicated slot holds its text. Question scales alone; A/B/C share the
// smallest size that still fits the longest option on that question.

const MIN_PX = 7;
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

function contentBox(el) {
  const cs = getComputedStyle(el);
  const padX = parseFloat(cs.paddingLeft) + parseFloat(cs.paddingRight);
  const padY = parseFloat(cs.paddingTop) + parseFloat(cs.paddingBottom);
  return {
    width: Math.max(0, el.clientWidth - padX),
    height: Math.max(0, el.clientHeight - padY),
    fontFamily: cs.fontFamily,
    fontWeight: cs.fontWeight,
    fontStyle: cs.fontStyle,
    lineHeight: cs.lineHeight,
    letterSpacing: cs.letterSpacing,
    wordSpacing: cs.wordSpacing,
    whiteSpace: cs.whiteSpace,
    overflowWrap: cs.overflowWrap,
    wordBreak: cs.wordBreak,
  };
}

function cssMaxPx(el) {
  const prev = el.style.fontSize;
  el.style.fontSize = '';
  const maxPx = parseFloat(getComputedStyle(el).fontSize);
  el.style.fontSize = prev;
  return Number.isFinite(maxPx) && maxPx > 0 ? maxPx : 16;
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
  const maxPx = cssMaxPx(el);
  applySize(el, largestFit(el.textContent, contentBox(el), maxPx));
}

function fitAnswers(dock) {
  const texts = [...dock.querySelectorAll('.abc-answers .answer-text')];
  if (!texts.length) return;
  const maxPx = Math.min(...texts.map(cssMaxPx));
  let shared = maxPx;
  for (const el of texts) {
    const need = largestFit(el.textContent, contentBox(el), maxPx);
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
