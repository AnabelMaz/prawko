/* scale-boot.js — set --ui-scale before first paint (kept in sync with scale.js) */
(function () {
  var DESIGN = 1280;
  var MAX = 1;
  var vw = window.innerWidth;
  var vh = window.innerHeight;
  var wrap = vw < vh;
  var w = wrap ? Math.max(1, Math.min(vw, DESIGN)) : DESIGN;
  var s = wrap ? 1 : Math.min(MAX, vw / Math.max(w, 1));
  var root = document.documentElement;
  root.style.setProperty('--ui-scale', String(s));
  root.style.setProperty('--ui-design-width', w + 'px');
  root.style.setProperty('--ui-chrome-top', '0px');
  root.setAttribute('data-ui-mode', 'scroll');
  root.setAttribute('data-ui-fit', '1');
})();
