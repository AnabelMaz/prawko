// Help: desktop = delayed hover/focus tip; handset = small "i" after the label.

import { t } from './i18n.js';

const HELP_HOVER_DELAY_MS = 500;

let popoverEl = null;
let openAnchor = null;
let outsideBound = false;
let escapeBound = false;
let hoverTimer = null;

function isHandset() {
  return document.documentElement.hasAttribute('data-handset');
}

function resolveText(text) {
  return typeof text === 'function' ? text() : text;
}

function clearHoverTimer() {
  if (hoverTimer != null) {
    clearTimeout(hoverTimer);
    hoverTimer = null;
  }
}

function ensurePopover() {
  if (popoverEl) return popoverEl;
  popoverEl = document.createElement('div');
  popoverEl.className = 'ui-help-popover';
  popoverEl.hidden = true;
  popoverEl.setAttribute('role', 'tooltip');
  document.body.appendChild(popoverEl);
  return popoverEl;
}

export function hideHelp() {
  clearHoverTimer();
  if (!popoverEl) return;
  popoverEl.hidden = true;
  popoverEl.textContent = '';
  if (openAnchor) {
    openAnchor.removeAttribute('aria-expanded');
    openAnchor = null;
  }
}

function placePopover(anchor) {
  const tip = ensurePopover();
  tip.style.left = '0px';
  tip.style.top = '0px';
  const rect = anchor.getBoundingClientRect();
  const tipW = tip.offsetWidth;
  const tipH = tip.offsetHeight;
  let left = rect.left;
  let top = rect.bottom + 6;
  if (left + tipW > window.innerWidth - 8) {
    left = Math.max(8, window.innerWidth - tipW - 8);
  }
  if (left < 8) left = 8;
  if (top + tipH > window.innerHeight - 8) {
    top = Math.max(8, rect.top - tipH - 6);
  }
  tip.style.left = `${Math.round(left)}px`;
  tip.style.top = `${Math.round(top)}px`;
}

export function showHelp(anchor, text) {
  if (!text || !anchor) return;
  clearHoverTimer();
  const tip = ensurePopover();
  tip.textContent = text;
  tip.hidden = false;
  if (openAnchor && openAnchor !== anchor) openAnchor.removeAttribute('aria-expanded');
  openAnchor = anchor;
  if (anchor.classList?.contains('ui-help-btn')) {
    anchor.setAttribute('aria-expanded', 'true');
  }
  placePopover(anchor);
  bindDismiss();
}

function bindDismiss() {
  if (!outsideBound) {
    outsideBound = true;
    document.addEventListener('pointerdown', (e) => {
      if (!openAnchor || !popoverEl || popoverEl.hidden) return;
      const target = e.target;
      if (openAnchor.contains?.(target) || openAnchor === target) return;
      if (popoverEl.contains(target)) return;
      hideHelp();
    }, true);
  }
  if (!escapeBound) {
    escapeBound = true;
    document.addEventListener('keydown', (e) => {
      if (e.key === 'Escape') hideHelp();
    });
  }
}

function bindHelpButton(btn) {
  btn.addEventListener('click', (e) => {
    e.preventDefault();
    e.stopPropagation();
    if (!isHandset()) return;
    const body = resolveText(btn._helpText);
    if (!body) return;
    if (openAnchor === btn && popoverEl && !popoverEl.hidden) {
      hideHelp();
      return;
    }
    showHelp(btn, body);
  });
  btn.addEventListener('pointerdown', (e) => e.stopPropagation());
}

function makeHelpButton() {
  const btn = document.createElement('button');
  btn.type = 'button';
  btn.className = 'ui-help-btn';
  btn.setAttribute('aria-expanded', 'false');
  btn.innerHTML = '<span aria-hidden="true">i</span>';
  bindHelpButton(btn);
  return btn;
}

function bindDesktopHover(host, text) {
  if (!host || host._helpHoverBound) {
    if (host) host._helpText = text;
    return;
  }
  host._helpHoverBound = true;
  host._helpText = text;
  const scheduleOpen = () => {
    if (isHandset()) return;
    clearHoverTimer();
    hoverTimer = setTimeout(() => {
      hoverTimer = null;
      if (isHandset()) return;
      const body = resolveText(host._helpText);
      if (body) showHelp(host, body);
    }, HELP_HOVER_DELAY_MS);
  };
  const close = () => {
    if (isHandset()) return;
    clearHoverTimer();
    hideHelp();
  };
  host.addEventListener('mouseenter', scheduleOpen);
  host.addEventListener('mouseleave', close);
  host.addEventListener('focusin', scheduleOpen);
  host.addEventListener('focusout', (e) => {
    if (host.contains(e.relatedTarget)) return;
    close();
  });
}

function syncHelpButton(btn, text) {
  btn._helpText = text;
  btn.setAttribute('aria-label', t('helpHint'));
  btn.removeAttribute('title');
}

/**
 * Place a help button after `host` content (append when inside).
 * Desktop: hover/focus on host. Handset: tap the "i".
 */
export function attachHelp(host, text, opts = {}) {
  if (!host) return null;
  const inside = opts.inside === true;
  let btn = inside
    ? host.querySelector(':scope > .ui-help-btn')
    : (host.nextElementSibling?.classList?.contains('ui-help-btn')
      ? host.nextElementSibling
      : null);
  // Migrate a leftover "i" that was inserted before the host.
  if (!btn && !inside && host.previousElementSibling?.classList?.contains('ui-help-btn')) {
    btn = host.previousElementSibling;
    host.insertAdjacentElement('afterend', btn);
  }
  if (!btn) {
    btn = makeHelpButton();
    if (inside) host.appendChild(btn);
    else host.insertAdjacentElement('afterend', btn);
  }
  syncHelpButton(btn, text);
  bindDesktopHover(host, text);
  return btn;
}

/**
 * Keep host + help as one grid/flex cell. Order: control, then "i".
 */
export function attachHelpBeside(host, text) {
  if (!host) return null;
  let wrap = host.parentElement;
  if (!wrap?.classList.contains('ui-help-host')) {
    wrap = document.createElement('span');
    wrap.className = 'ui-help-host';
    host.replaceWith(wrap);
    wrap.appendChild(host);
  }
  let btn = wrap.querySelector(':scope > .ui-help-btn');
  if (!btn) {
    btn = makeHelpButton();
    wrap.appendChild(btn);
  } else if (btn.nextElementSibling === host) {
    // Old order was i then host — flip to host then i.
    wrap.appendChild(btn);
  }
  syncHelpButton(btn, text);
  bindDesktopHover(host, text);
  bindDesktopHover(wrap, text);
  return btn;
}

/**
 * Desktop hover/focus tip only — no "i" button (icon controls).
 */
export function attachHoverHelp(host, text) {
  if (!host) return null;
  bindDesktopHover(host, text);
  return host;
}

export function refreshHelpLabels() {
  document.querySelectorAll('.ui-help-btn').forEach((btn) => {
    btn.setAttribute('aria-label', t('helpHint'));
  });
  if (openAnchor && popoverEl && !popoverEl.hidden) {
    const body = resolveText(openAnchor._helpText);
    if (body) {
      popoverEl.textContent = body;
      placePopover(openAnchor);
    } else hideHelp();
  }
}
