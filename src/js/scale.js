// scale.js — Compact screens (home, categories, learn, exam) layout at a
// fixed design size and transform-scale to the viewport, down toward 0.
// Landscape vs portrait comes from aspect ratio (vw < vh), not pixel width.
// Long-list screens (results, history, learn-progress) keep scroll.

import { scheduleFitQuizDockText } from './fit-text.js';
import './category-pack.js';

const { packCategoryGrid } = globalThis.PrawkoCategoryPack;

export const UI_DESIGN_WIDTH = 1280;
export const UI_LANDSCAPE_HEIGHT = 800;
export const UI_PORTRAIT_WIDTH = 720;
export const UI_PORTRAIT_HEIGHT = 1280;
export const UI_MAX_SCALE = 1;
export const UI_MIN_SCALE = 0.01;
export const UI_BOTTOM_INSET_RATIO = 0.05;
const UI_SCALE_EPS = 0.01;
/** One rAF = one compositor tick. Home↔categories hide the stage, pin a
 *  concrete `scale()`, then let CSS `var(--ui-scale)` take over before show.
 *  6 ticks to drop the pin, 6 more so the used transform matches the var
 *  (~200 ms at 60 Hz; a slow VM needs the ticks, not a wall-clock sleep). */
const UI_SWAP_PIN_FRAMES = 6;
const UI_SWAP_SETTLE_FRAMES = 6;

const SCROLL_SCREEN_IDS = ['results', 'history', 'learn-progress'];

function isPortraitAspect(vw, vh) {
  return vw < vh;
}

function clampScale(value) {
  if (!Number.isFinite(value) || value <= 0) return UI_MIN_SCALE;
  return Math.min(UI_MAX_SCALE, Math.max(UI_MIN_SCALE, value));
}

let started = false;
let raf = 0;
let applying = false;
let unpinScale = 0;
let lastDesignW = 0;
let lastDesignH = 0;
let lastScale = 0;
let lastMode = '';
let lastStation = '';
let lastChromeH = -1;
let lastOrient = '';
let categoryLayoutTries = 0;

function viewportSize() {
  return {
    vw: window.visualViewport?.width || window.innerWidth,
    vh: window.visualViewport?.height || window.innerHeight,
  };
}

function chromeTopHeight() {
  const chrome = document.querySelector('.app-chrome');
  if (!chrome) return 0;
  let height = 0;
  chrome.querySelectorAll('.offline-banner, .update-banner').forEach((el) => {
    if (el.hidden) return;
    height += el.offsetHeight;
  });
  return height;
}

function isScrollScreen() {
  return SCROLL_SCREEN_IDS.some((id) => document.getElementById(id)?.classList.contains('active'));
}

function isQuizScreen() {
  return document.getElementById('quiz')?.classList.contains('active') === true;
}

function isCategoriesScreen() {
  return document.getElementById('categories')?.classList.contains('active') === true;
}

function isHomeScreen() {
  return document.getElementById('home')?.classList.contains('active') === true;
}

function isFillStation() {
  return isQuizScreen() || isCategoriesScreen();
}

function measurePageHeight() {
  const screen = document.querySelector('#app .screen.active');
  if (!screen) return UI_LANDSCAPE_HEIGHT;
  return Math.max(1, Math.ceil(screen.scrollHeight));
}

function rememberCurrentScale(root) {
  lastDesignW = parseFloat(root.style.getPropertyValue('--ui-design-width')) || lastDesignW;
  lastDesignH = parseFloat(root.style.getPropertyValue('--ui-design-height')) || lastDesignH;
  lastScale = Number(getComputedStyle(root).getPropertyValue('--ui-scale')) || lastScale;
  lastMode = root.getAttribute('data-ui-mode') || lastMode;
  lastStation = root.getAttribute('data-ui-station') || lastStation;
  lastOrient = root.getAttribute('data-ui-orient') || lastOrient;
  lastChromeH = parseFloat(root.style.getPropertyValue('--ui-chrome-top')) || 0;
}

/** Flex leftover for the grid: section height minus header/search/recent, not the grid's own box. */
function categoryGridLeftover(section, grid) {
  const sectionCs = getComputedStyle(section);
  const sectionPadY = (parseFloat(sectionCs.paddingTop) || 0)
    + (parseFloat(sectionCs.paddingBottom) || 0);
  let used = 0;
  for (const child of section.children) {
    if (child === grid) continue;
    const style = getComputedStyle(child);
    if (child.hidden || style.display === 'none') continue;
    used += child.offsetHeight;
    used += parseFloat(style.marginTop) || 0;
    used += parseFloat(style.marginBottom) || 0;
  }
  const gridCs = getComputedStyle(grid);
  const padX = (parseFloat(gridCs.paddingLeft) || 0) + (parseFloat(gridCs.paddingRight) || 0);
  const padY = (parseFloat(gridCs.paddingTop) || 0) + (parseFloat(gridCs.paddingBottom) || 0);
  const gap = parseFloat(gridCs.rowGap || gridCs.columnGap || gridCs.gap) || 10;
  return {
    innerW: grid.clientWidth - padX,
    innerH: section.clientHeight - sectionPadY - used - padY - 2,
    gap,
  };
}

/** Pack the full category set after the fill stage has a real leftover.
 *  Search hides cards (`display`) but must not grow the remaining tiles. */
export function layoutCategoryGrid() {
  const section = document.getElementById('categories');
  const grid = document.querySelector('.category-grid');
  if (!section?.classList.contains('active') || !grid) return;
  if (document.documentElement.getAttribute('data-ui-station') !== 'fill') return;

  const designHNow = Number.parseFloat(
    getComputedStyle(document.documentElement).getPropertyValue('--ui-design-height')
  ) || 0;
  if (designHNow > 0 && section.clientHeight > designHNow + 24) {
    if (categoryLayoutTries < 4) {
      categoryLayoutTries += 1;
      requestAnimationFrame(() => layoutCategoryGrid());
    }
    return;
  }

  const cards = [...grid.querySelectorAll('.category-card')].filter((c) => !c.hidden);
  const n = Math.max(1, cards.length);
  const { innerW, innerH, gap } = categoryGridLeftover(section, grid);
  if (innerW < 32 || innerH < 32) {
    if (categoryLayoutTries < 4) {
      categoryLayoutTries += 1;
      requestAnimationFrame(() => layoutCategoryGrid());
    }
    return;
  }
  categoryLayoutTries = 0;

  const { cols, rows, cardW, cardH } = packCategoryGrid(n, innerW, innerH, gap);
  grid.style.setProperty('--cat-cols', String(cols));
  grid.style.setProperty('--cat-rows', String(rows));
  grid.style.setProperty('--cat-card-w', `${cardW}px`);
  grid.style.setProperty('--cat-card-h', `${cardH}px`);
  grid.style.setProperty('--cat-cell', `${cardW}px`);
  grid.style.gridTemplateColumns = `repeat(${cols}, minmax(0, ${cardW}px))`;
  grid.style.gridTemplateRows = `repeat(${rows}, minmax(0, ${cardH}px))`;
  void grid.offsetHeight;

  const designH = Number.parseFloat(
    getComputedStyle(document.documentElement).getPropertyValue('--ui-design-height')
  ) || 0;
  const compact = designH > 0 && designH < 760;
  const compactChanged = section.classList.contains('categories-compact') !== compact;
  section.classList.toggle('categories-compact', compact);
  if (compactChanged) {
    void section.offsetHeight;
    layoutCategoryGrid();
  }
}

let pinOutstanding = false;

function clearStageScalePin() {
  unpinScale += 1;
  pinOutstanding = false;
  const root = document.documentElement;
  const slot = document.querySelector('.ui-slot');
  const stage = document.querySelector('.ui-stage');
  root.style.removeProperty('--ui-scale');
  slot?.style.removeProperty('width');
  slot?.style.removeProperty('height');
  stage?.style.removeProperty('transform');
}

function afterUiPaints(fn, frames = 4) {
  const tick = () => {
    if (frames <= 1) {
      fn();
      return;
    }
    frames -= 1;
    requestAnimationFrame(tick);
  };
  requestAnimationFrame(tick);
}

/** Pin a real `transform: scale(n)` — `scale(var(--ui-scale))` paints late. */
function commitStageBox(designW, designH, scale, pinScale, holdPin) {
  const root = document.documentElement;
  const slot = document.querySelector('.ui-slot');
  const stage = document.querySelector('.ui-stage');
  if (stage) {
    stage.style.width = `${designW}px`;
    stage.style.height = `${designH}px`;
  }
  if (pinScale && scale > 0) {
    pinOutstanding = true;
    root.style.setProperty('--ui-scale', String(scale));
    if (stage) stage.style.transform = `scale(${scale})`;
    if (slot) {
      slot.style.width = `${Math.round(designW * scale)}px`;
      slot.style.height = `${Math.round(designH * scale)}px`;
    }
    void stage?.offsetHeight;
    unpinScale += 1;
    if (holdPin) return;
    const gen = unpinScale;
    afterUiPaints(() => {
      if (gen !== unpinScale) return;
      clearStageScalePin();
    });
    return;
  }
  if (!pinOutstanding) {
    root.style.removeProperty('--ui-scale');
    stage?.style.removeProperty('transform');
  }
}

export function applyUiFitScale(opts = {}) {
  if (applying) return;
  const root = document.documentElement;
  const app = document.getElementById('app');
  if (!app) return;

  applying = true;
  const chromeH = chromeTopHeight();
  root.style.setProperty('--ui-chrome-top', `${chromeH}px`);
  const { vw, vh } = viewportSize();
  const vhAvail = Math.max(1, vh - chromeH);
  const home = isHomeScreen();
  const portrait = isPortraitAspect(vw, vhAvail);
  const orient = portrait ? 'portrait' : 'landscape';
  const station = isScrollScreen() ? 'scroll' : (isFillStation() ? 'fill' : 'page');
  root.setAttribute('data-ui-orient', orient);

  let designW;
  let scale;
  let designH;
  let mode;
  let heightSlack;

  if (station === 'scroll') {
    mode = 'scroll';
    heightSlack = 24;
    if (portrait) {
      designW = Math.max(1, Math.round(vw));
      scale = 1;
    } else {
      designW = UI_DESIGN_WIDTH;
      scale = clampScale(vw / Math.max(1, designW));
    }
    const inset = Math.max(24, Math.round(designW * UI_BOTTOM_INSET_RATIO));
    const contentH = Math.max(1, Math.ceil(app.scrollHeight));
    designH = contentH + inset;
  } else if (station === 'fill') {
    designW = portrait ? UI_PORTRAIT_WIDTH : UI_DESIGN_WIDTH;
    designH = portrait ? UI_PORTRAIT_HEIGHT : UI_LANDSCAPE_HEIGHT;
    scale = clampScale(Math.min(vw / designW, vhAvail / designH));
    mode = 'fit';
    heightSlack = 2;
  } else {
    designW = portrait ? UI_PORTRAIT_WIDTH : UI_DESIGN_WIDTH;
    mode = 'fit';
    const minH = portrait ? UI_PORTRAIT_HEIGHT : UI_LANDSCAPE_HEIGHT;
    designH = Math.max(minH, measurePageHeight());
    heightSlack = home ? 4 : 8;
    scale = clampScale(Math.min(vw / designW, vhAvail / designH));
  }

  if (
    mode === lastMode
    && station === lastStation
    && orient === lastOrient
    && Math.abs(designW - lastDesignW) < 2
    && Math.abs(designH - lastDesignH) < heightSlack
    && Math.abs(scale - lastScale) < UI_SCALE_EPS
    && chromeH === lastChromeH
  ) {
    applying = false;
    root.style.setProperty('--ui-design-width', `${lastDesignW}px`);
    root.style.setProperty('--ui-design-height', `${lastDesignH}px`);
    root.setAttribute('data-ui-station', lastStation || station);
    root.setAttribute('data-ui-mode', lastMode || mode);
    commitStageBox(lastDesignW, lastDesignH, lastScale, false, opts.holdPin);
    void app.offsetHeight;
    syncExamMediaAlign();
    if (isCategoriesScreen()) layoutCategoryGrid();
    return;
  }

  const geometryChanged = station !== lastStation
    || orient !== lastOrient
    || Math.abs(designW - lastDesignW) >= 2
    || Math.abs(designH - lastDesignH) >= heightSlack;
  lastMode = mode;
  lastStation = station;
  lastOrient = orient;
  lastDesignW = designW;
  lastDesignH = designH;
  lastScale = scale;
  lastChromeH = chromeH;
  root.style.setProperty('--ui-design-width', `${designW}px`);
  root.style.setProperty('--ui-design-height', `${designH}px`);
  root.setAttribute('data-ui-fit', '1');
  root.setAttribute('data-ui-mode', mode);
  root.setAttribute('data-ui-station', station);
  commitStageBox(designW, designH, scale, geometryChanged, opts.holdPin);
  void app.offsetHeight;
  applying = false;
  syncExamMediaAlign();
  scheduleFitQuizDockText();
  if (isCategoriesScreen()) layoutCategoryGrid();
}

/** After Home↔categories already hid the stage (`data-ui-swap`): pin, unpin, show. */
export function fitAfterShowScreen(swap) {
  applyUiFitScale({ holdPin: Boolean(swap) });
  if (!swap) return;
  afterUiPaints(() => {
    clearStageScalePin();
    afterUiPaints(() => {
      document.documentElement.removeAttribute('data-ui-swap');
    }, UI_SWAP_SETTLE_FRAMES);
  }, UI_SWAP_PIN_FRAMES);
}

/** Align dock copy to the film slot. Does not run fit-text — ABC size is
 *  from the design dock row, not from media paint. */
export function syncExamMediaAlign() {
  const quiz = document.getElementById('quiz');
  const session = quiz?.classList.contains('exam-active') || quiz?.classList.contains('learn-active');
  if (!quiz?.classList.contains('active') || !session) {
    quiz?.style.removeProperty('--exam-media-left');
    quiz?.style.removeProperty('--exam-media-width');
    return false;
  }
  const film = quiz.querySelector('.media-slot') || quiz.querySelector('.media-area');
  const dock = quiz.querySelector('.quiz-dock');
  if (!film || !dock) return false;
  const filmBox = film.getBoundingClientRect();
  const dockBox = dock.getBoundingClientRect();
  if (filmBox.width < 8 || dockBox.width < 8) return false;
  const scaleRaw = getComputedStyle(document.documentElement).getPropertyValue('--ui-scale');
  const scale = Number(scaleRaw);
  const safeScale = Number.isFinite(scale) && scale > 0 ? scale : 1;
  const left = Math.max(0, Math.round((filmBox.left - dockBox.left) / safeScale));
  const width = Math.round(filmBox.width / safeScale);
  const prevL = parseFloat(quiz.style.getPropertyValue('--exam-media-left'));
  const prevW = parseFloat(quiz.style.getPropertyValue('--exam-media-width'));
  const had = quiz.style.getPropertyValue('--exam-media-width') !== '';
  const changed = !had || Math.abs(left - prevL) >= 2 || Math.abs(width - prevW) >= 2;
  quiz.style.setProperty('--exam-media-left', `${left}px`);
  quiz.style.setProperty('--exam-media-width', `${width}px`);
  return changed;
}

export function alignAndFitExamDock() {
  syncExamMediaAlign();
  scheduleFitQuizDockText();
}

export function refitUiScale() {
  if (raf) cancelAnimationFrame(raf);
  raf = requestAnimationFrame(() => {
    raf = 0;
    applyUiFitScale();
  });
}

function waitForHomeFonts() {
  if (!document.fonts?.ready) return Promise.resolve();
  const loadTitle = document.fonts.load('800 3.5rem "DM Sans"').catch(() => {});
  return Promise.race([
    Promise.all([document.fonts.ready, loadTitle]),
    new Promise((resolve) => setTimeout(resolve, 800)),
  ]);
}

/** First visible home frame uses the fitted scale (exam rules included). */
export async function revealUiScale() {
  await waitForHomeFonts();
  applyUiFitScale();
  await new Promise((resolve) => setTimeout(resolve, 90));
  applyUiFitScale();
  document.documentElement.removeAttribute('data-ui-pending');
}

export function setupUiFitScale() {
  if (started) {
    refitUiScale();
    return;
  }
  started = true;
  rememberCurrentScale(document.documentElement);
  applyUiFitScale();
  const onViewportResize = () => refitUiScale();
  window.addEventListener('resize', onViewportResize);
  window.visualViewport?.addEventListener('resize', onViewportResize);
  window.addEventListener('orientationchange', onViewportResize);
  const chrome = document.querySelector('.app-chrome');
  if (chrome && typeof ResizeObserver !== 'undefined') {
    let chromeTimer = 0;
    new ResizeObserver(() => {
      clearTimeout(chromeTimer);
      chromeTimer = setTimeout(() => refitUiScale(), 80);
    }).observe(chrome);
  }
  const appEl = document.getElementById('app');
  if (appEl && typeof ResizeObserver !== 'undefined') {
    let appTimer = 0;
    new ResizeObserver(() => {
      if (isQuizScreen() || isCategoriesScreen() || isHomeScreen()) return;
      clearTimeout(appTimer);
      appTimer = setTimeout(() => {
        refitUiScale();
      }, 40);
    }).observe(appEl);
  }
  const mediaSlot = document.querySelector('#quiz .media-slot');
  if (mediaSlot && typeof ResizeObserver !== 'undefined') {
    new ResizeObserver(() => {
      if (!isQuizScreen()) return;
      requestAnimationFrame(() => {
        syncExamMediaAlign();
      });
    }).observe(mediaSlot);
  }
}
