/* scale-boot.js — set --ui-scale before first paint (kept in sync with scale.js) */
(function () {
  var DESIGN_W = 1280;
  var DESIGN_H = 800;
  var PORTRAIT_W = 720;
  var PORTRAIT_H = 1280;
  var MAX = 1;
  var MIN = 0.01;
  var vv = window.visualViewport;
  var vw = (vv && vv.width) || window.innerWidth;
  var vh = (vv && vv.height) || window.innerHeight;
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
  root.setAttribute('data-ui-pending', '1');
  if (document.head && !document.getElementById('ui-pending-css')) {
    var css = document.createElement('style');
    css.id = 'ui-pending-css';
    css.textContent = 'html[data-ui-pending] .ui-stage{visibility:hidden}';
    document.head.appendChild(css);
  }
})();
