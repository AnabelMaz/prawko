/* scale-boot.js — design size + pending before first paint (scale is CSS vw/vh) */
(function () {
  var DESIGN_W = 1280;
  var DESIGN_H = 800;
  var PORTRAIT_W = 720;
  var PORTRAIT_H = 1280;
  var vv = window.visualViewport;
  var vw = (vv && vv.width) || window.innerWidth;
  var vh = (vv && vv.height) || window.innerHeight;
  var portrait = vw < vh;
  var w = portrait ? PORTRAIT_W : DESIGN_W;
  var h = portrait ? PORTRAIT_H : DESIGN_H;
  var root = document.documentElement;
  root.style.setProperty('--ui-design-width', w + 'px');
  root.style.setProperty('--ui-design-height', h + 'px');
  root.style.setProperty('--ui-chrome-top', '0px');
  root.style.removeProperty('--ui-scale');
  root.setAttribute('data-ui-mode', 'fit');
  root.setAttribute('data-ui-orient', portrait ? 'portrait' : 'landscape');
  root.setAttribute('data-ui-station', 'page');
  root.setAttribute('data-ui-fit', '1');
  root.setAttribute('data-ui-pending', '1');
})();
