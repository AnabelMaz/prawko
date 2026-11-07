// Largest equal category cards of a fixed aspect (home-entry ~199×146; taller on handset).
(function (root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  root.PrawkoCategoryPack = api;
})(typeof self !== 'undefined' ? self : globalThis, function () {
  const CAT_CARD_ASPECT = 199 / 146;
  const CAT_CARD_ASPECT_HANDSET = 199 / 170;

  function catCardAspect() {
    if (typeof document !== 'undefined'
      && document.documentElement?.hasAttribute?.('data-handset')) {
      return CAT_CARD_ASPECT_HANDSET;
    }
    return CAT_CARD_ASPECT;
  }

  function packCategoryGrid(n, innerW, innerH, gap, aspect = catCardAspect()) {
    let bestCols = 1;
    let bestW = -Infinity;
    let bestEmpty = Infinity;
    for (let cols = 1; cols <= n; cols++) {
      const rows = Math.ceil(n / cols);
      const cellW = (innerW - gap * Math.max(0, cols - 1)) / cols;
      const cellH = (innerH - gap * Math.max(0, rows - 1)) / rows;
      if (!(cellW > 0) || !(cellH > 0)) continue;
      const cardW = Math.min(cellW, cellH * aspect);
      const cardH = cardW / aspect;
      if (!(cardW > 0) || cardH > cellH + 0.5 || cardW > cellW + 0.5) continue;
      const empty = cols * rows - n;
      const bigger = cardW > bestW + 0.5;
      const tighter = Math.abs(cardW - bestW) <= 0.5 && empty < bestEmpty;
      if (bigger || tighter) {
        bestW = cardW;
        bestEmpty = empty;
        bestCols = cols;
      }
    }
    const width = Math.max(1, Math.floor(bestW > 0 ? bestW : 1));
    return {
      cols: bestCols,
      rows: Math.ceil(n / bestCols),
      cardW: width,
      cardH: Math.max(1, Math.floor(width / aspect)),
    };
  }

  return { CAT_CARD_ASPECT, CAT_CARD_ASPECT_HANDSET, catCardAspect, packCategoryGrid };
});
