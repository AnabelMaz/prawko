// scale.js — Quiz and categories layout at 1280px and transform-scale down
// on narrower windows. Scale never exceeds 1: on wider screens fonts/chrome
// stop growing while design height tracks the viewport (film + category
// grid use leftover space). Home and other screens keep scroll layout.
// Portrait home wraps at the window width.

export const UI_DESIGN_WIDTH = 1280;
export const UI_MAX_SCALE = 1;
export const UI_BOTTOM_INSET_RATIO = 0.05;

function shouldWrapScrollLayout(vw, vh) {
  return vw < vh;
}

let started = false;
let raf = 0;
let applying = false;
let lastDesignW = 0;
let lastDesignH = 0;
let lastScale = 0;
let lastMode = '';
let lastChromeH = -1;

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

function isQuizScreen() {
  return document.getElementById('quiz')?.classList.contains('active') === true;
}

function isCategoriesScreen() {
  return document.getElementById('categories')?.classList.contains('active') === true;
}

function isFitScreen() {
  return isQuizScreen() || isCategoriesScreen();
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

  let designW;
  let scale;
  let designH;
  let mode;
  let heightSlack;

  if (isQuizScreen()) {
    designW = Math.max(1, Math.round(vw));
    scale = 1;
    designH = Math.max(1, Math.round(vhAvail));
    mode = 'fit';
    heightSlack = 2;
    root.setAttribute('data-ui-orient', vw < vh ? 'portrait' : 'landscape');
  } else if (isCategoriesScreen()) {
    designW = UI_DESIGN_WIDTH;
    scale = Math.min(UI_MAX_SCALE, vw / Math.max(1, designW));
    designH = Math.max(1, Math.round(vhAvail / Math.max(scale, 0.001)));
    mode = 'fit';
    heightSlack = 2;
    root.setAttribute('data-ui-orient', vw < vh ? 'portrait' : 'landscape');
  } else {
    mode = 'scroll';
    heightSlack = 24;
    if (shouldWrapScrollLayout(vw, vhAvail)) {
      designW = Math.max(1, Math.round(vw));
      scale = 1;
    } else {
      designW = UI_DESIGN_WIDTH;
      scale = Math.min(UI_MAX_SCALE, vw / Math.max(1, designW));
    }
    const inset = Math.max(24, Math.round(designW * UI_BOTTOM_INSET_RATIO));
    const contentH = Math.max(1, Math.ceil(app.scrollHeight));
    designH = contentH + inset;
  }

  if (
    mode === lastMode
    && Math.abs(designW - lastDesignW) < 2
    && Math.abs(designH - lastDesignH) < heightSlack
    && Math.abs(scale - lastScale) < 0.001
    && chromeH === lastChromeH
  ) {
    applying = false;
    requestAnimationFrame(() => {
      if (isCategoriesScreen()) layoutCategoryGrid();
      syncExamMediaAlign();
    });
    return;
  }

  lastMode = mode;
  lastDesignW = designW;
  lastDesignH = designH;
  lastScale = scale;
  lastChromeH = chromeH;
  root.style.setProperty('--ui-design-width', `${designW}px`);
  root.style.setProperty('--ui-design-height', `${designH}px`);
  root.style.setProperty('--ui-scale', String(scale));
  root.setAttribute('data-ui-fit', '1');
  root.setAttribute('data-ui-mode', mode);
  requestAnimationFrame(() => {
    applying = false;
    if (isCategoriesScreen()) layoutCategoryGrid();
    syncExamMediaAlign();
  });
}

function syncExamMediaAlign() {
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
  if (mediaBox.width < 8 || dockBox.width < 8) return;
  const left = Math.max(0, Math.round(mediaBox.left - dockBox.left));
  quiz.style.setProperty('--exam-media-left', `${left}px`);
  quiz.style.setProperty('--exam-media-width', `${Math.round(mediaBox.width)}px`);
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
      if (isQuizScreen()) return;
      clearTimeout(appTimer);
      appTimer = setTimeout(() => {
        if (isCategoriesScreen()) {
          layoutCategoryGrid();
          return;
        }
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
