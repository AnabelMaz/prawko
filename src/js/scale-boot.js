/* scale-boot.js — set --ui-scale before first paint (kept in sync with scale.js) */
(function () {
  var DESIGN_W = 1280;
  var DESIGN_H = 800;
  var PORTRAIT_W = 720;
  var PORTRAIT_H = 1280;
  var MAX = 1;
  var MIN = 0.01;
  var vw = window.innerWidth;
  var vh = window.innerHeight;
  var portrait = vw < vh;
  var w = portrait ? PORTRAIT_W : DESIGN_W;
  var h = portrait ? PORTRAIT_H : DESIGN_H;
  var s = Math.min(MAX, vw / w, vh / h);
  if (!(s > MIN)) s = MIN;
  var root = document.documentElement;
  root.style.setProperty('--ui-scale', String(s));
  root.style.setProperty('--ui-design-width', w + 'px');
  root.style.setProperty('--ui-design-height', h + 'px');
  root.style.setProperty('--ui-chrome-top', '0px');
  root.setAttribute('data-ui-mode', 'fit');
  root.setAttribute('data-ui-orient', portrait ? 'portrait' : 'landscape');
  root.setAttribute('data-ui-station', 'page');
  root.setAttribute('data-ui-fit', '1');
})();
