// scale.js — Compact screens (home, categories, learn, exam) layout at a
// fixed design size and transform-scale to the viewport, down toward 0.
// Landscape vs portrait comes from aspect ratio (vw < vh), not pixel width.
// Long-list screens (results, history, learn-progress) keep scroll.

import { scheduleFitQuizDockText } from './fit-text.js';

export const UI_DESIGN_WIDTH = 1280;
export const UI_LANDSCAPE_HEIGHT = 800;
export const UI_PORTRAIT_WIDTH = 720;
export const UI_PORTRAIT_HEIGHT = 1280;
export const UI_MAX_SCALE = 1;
export const UI_MIN_SCALE = 0.01;
export const UI_BOTTOM_INSET_RATIO = 0.05;

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
let lastDesignW = 0;
let lastDesignH = 0;
let lastScale = 0;
let lastMode = '';
let lastStation = '';
let lastChromeH = -1;
let lastOrient = '';

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

function isFillStation() {
  return isQuizScreen() || isCategoriesScreen();
}

function measurePageHeight() {
  const screen = document.querySelector('#app .screen.active');
  if (!screen) return UI_LANDSCAPE_HEIGHT;
  return Math.max(1, Math.ceil(screen.scrollHeight));
}

/** Pick columns/rows so every visible category card fits the grid box. */
export function layoutCategoryGrid() {
  const section = document.getElementById('categories');
  const grid = document.querySelector('.category-grid');
  if (!section?.classList.contains('active') || !grid) return;

  const cards = [...grid.querySelectorAll('.category-card')].filter(
    (c) => !c.hidden && c.style.display !== 'none'
  );
  const n = Math.max(1, cards.length);
  const w = grid.clientWidth;
  const h = grid.clientHeight;
  if (w < 32 || h < 32) return;

  let bestCols = Math.min(4, n);
  let bestScore = -Infinity;
  for (let cols = 1; cols <= n; cols++) {
    const rows = Math.ceil(n / cols);
    const cellW = w / cols;
    const cellH = h / rows;
    if (cellW < 64 || cellH < 44) continue;
    const aspect = cellW / cellH;
    const aspectScore = 1 - Math.min(1, Math.abs(Math.log(aspect / 1.45)));
    const empty = cols * rows - n;
    const fillScore = 1 - empty / Math.max(cols * rows, 1);
    const sizeScore = Math.min(cellH, 110) / 110 + Math.min(cellW, 220) / 220;
    const score = aspectScore * 2 + fillScore + sizeScore;
    if (score > bestScore) {
      bestScore = score;
      bestCols = cols;
    }
  }

  const bestRows = Math.ceil(n / bestCols);
  grid.style.setProperty('--cat-cols', String(bestCols));
  grid.style.setProperty('--cat-rows', String(bestRows));

  const designH = Number.parseFloat(
    getComputedStyle(document.documentElement).getPropertyValue('--ui-design-height')
  ) || 0;
  section.classList.toggle('categories-compact', designH > 0 && designH < 760);
}

function applyUiFitScale() {
  if (applying) return;
  const root = document.documentElement;
  const app = document.getElementById('app');
  if (!app) return;

  applying = true;
  const chromeH = chromeTopHeight();
  root.style.setProperty('--ui-chrome-top', `${chromeH}px`);
  const { vw, vh } = viewportSize();
  const vhAvail = Math.max(1, vh - chromeH);
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
    heightSlack = 8;
    const minH = portrait ? UI_PORTRAIT_HEIGHT : UI_LANDSCAPE_HEIGHT;
    root.setAttribute('data-ui-mode', 'fit');
    root.setAttribute('data-ui-station', 'page');
    root.setAttribute('data-ui-measuring', '1');
    void app.offsetHeight;
    const contentH = measurePageHeight();
    root.removeAttribute('data-ui-measuring');
    designH = Math.max(minH, contentH);
    scale = clampScale(Math.min(vw / designW, vhAvail / designH));
  }

  if (
    mode === lastMode
    && station === lastStation
    && orient === lastOrient
    && Math.abs(designW - lastDesignW) < 2
    && Math.abs(designH - lastDesignH) < heightSlack
    && Math.abs(scale - lastScale) < 0.001
    && chromeH === lastChromeH
  ) {
    applying = false;
    root.style.setProperty('--ui-design-width', `${lastDesignW}px`);
    root.style.setProperty('--ui-design-height', `${lastDesignH}px`);
    root.style.setProperty('--ui-scale', String(lastScale));
    root.setAttribute('data-ui-station', lastStation || station);
    root.setAttribute('data-ui-mode', lastMode || mode);
    requestAnimationFrame(() => {
      if (isCategoriesScreen()) layoutCategoryGrid();
      syncExamMediaAlign();
    });
    return;
  }

  lastMode = mode;
  lastStation = station;
  lastOrient = orient;
  lastDesignW = designW;
  lastDesignH = designH;
  lastScale = scale;
  lastChromeH = chromeH;
  root.style.setProperty('--ui-design-width', `${designW}px`);
  root.style.setProperty('--ui-design-height', `${designH}px`);
  root.style.setProperty('--ui-scale', String(scale));
  root.setAttribute('data-ui-fit', '1');
  root.setAttribute('data-ui-mode', mode);
  root.setAttribute('data-ui-station', station);
  requestAnimationFrame(() => {
    applying = false;
    if (isCategoriesScreen()) layoutCategoryGrid();
    syncExamMediaAlign();
  });
}

export function syncExamMediaAlign() {
  const quiz = document.getElementById('quiz');
  const session = quiz?.classList.contains('exam-active') || quiz?.classList.contains('learn-active');
  if (!quiz?.classList.contains('active') || !session) {
    quiz?.style.removeProperty('--exam-media-left');
    quiz?.style.removeProperty('--exam-media-width');
    return;
  }
  const media = quiz.querySelector('.media-area');
  const dock = quiz.querySelector('.quiz-dock');
  if (!media || !dock) return;
  const mediaBox = media.getBoundingClientRect();
  const dockBox = dock.getBoundingClientRect();
  if (mediaBox.width < 8 || dockBox.width < 8) {
    quiz.style.removeProperty('--exam-media-left');
    quiz.style.removeProperty('--exam-media-width');
    scheduleFitQuizDockText();
    return;
  }
  const scaleRaw = getComputedStyle(document.documentElement).getPropertyValue('--ui-scale');
  const scale = Number(scaleRaw);
  const safeScale = Number.isFinite(scale) && scale > 0 ? scale : 1;
  const left = Math.max(0, Math.round((mediaBox.left - dockBox.left) / safeScale));
  quiz.style.setProperty('--exam-media-left', `${left}px`);
  quiz.style.setProperty('--exam-media-width', `${Math.round(mediaBox.width / safeScale)}px`);
  scheduleFitQuizDockText();
}

export function refitUiScale() {
  if (raf) cancelAnimationFrame(raf);
  raf = requestAnimationFrame(() => {
    raf = 0;
    applyUiFitScale();
  });
}

export function setupUiFitScale() {
  if (started) {
    refitUiScale();
    return;
  }
  started = true;
  applyUiFitScale();
  window.addEventListener('resize', refitUiScale);
  window.visualViewport?.addEventListener('resize', refitUiScale);
  window.addEventListener('orientationchange', refitUiScale);
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
      if (isQuizScreen() || isCategoriesScreen()) return;
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
      requestAnimationFrame(() => syncExamMediaAlign());
    }).observe(mediaSlot);
  }
}
