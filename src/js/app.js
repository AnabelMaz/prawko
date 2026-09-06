// app.js — Router, initialization, and event wiring

import { fetchMeta, fetchCategory, fetchUniqueQuestionCount } from './data.js';
import { startExam, setupExamListeners, cleanupExam, getLastExamCategory, refreshExamQuestion } from './exam.js';
import { startLearn, setupLearnListeners, cleanupLearn, refreshLearnQuestion } from './learn.js';
import { showScreen, renderCategories, applyLanguage, renderHistory, renderLearnProgress, renderResults, showConfirmModal } from './ui.js';
import { setLang, getLang, loadQuestionTranslations, nextLang, LANG_LABELS, t } from './i18n.js';
import { downloadCategoryMedia, getDownloadedCategories, reconcileDownloadedCategories } from './offline.js';
import { getProfileSummary, loadHistory, loadLastResult, clearHistory, clearLearnProgress } from './stats.js';
import { setupUiFitScale, refitUiScale, layoutCategoryGrid } from './scale.js';
import {
  DEFAULT_PROFILE_NAME,
  PROFILE_LIMIT,
  createProfile,
  deleteProfile,
  formatProfileName,
  getActiveProfileId,
  getPracticeExamEnabled,
  listProfiles,
  profileGet,
  profileSet,
  renameProfile,
  setActiveProfile,
  setPracticeExamEnabled,
} from './profiles.js';

let meta = null;
let uniqueQuestionCount = null;
let currentMode = 'learn'; // 'learn' or 'exam'
let pendingCategory = null;

function paintHomeTagline() {
  const el = document.querySelector('.hero-tagline');
  if (!el) return;
  const n = Number(uniqueQuestionCount);
  if (!Number.isFinite(n) || n <= 0) return;
  const formatted = getLang() === 'en' ? n.toLocaleString('en-US') : String(n);
  el.textContent = t('tagline').replace('{n}', formatted);
}

function setQuizCategoryPill(categoryId) {
  const el = document.getElementById('quiz-category-pill');
  if (!el) return;
  if (!categoryId) {
    el.hidden = true;
    el.textContent = '';
    el.removeAttribute('aria-label');
    const topic = document.querySelector('.word-topic-text');
    if (topic) topic.textContent = '';
    return;
  }
  el.hidden = false;
  el.textContent = categoryId;
  el.setAttribute('aria-label', `${t('examCategoryShort')} ${categoryId}`);
  const topic = document.querySelector('.word-topic-text');
  if (topic) topic.textContent = `${t('examCategoryShort')} ${categoryId}`;
}

function setAppMode(mode) {
  currentMode = mode === 'exam' ? 'exam' : 'learn';
  document.querySelectorAll('.mode-btn').forEach((btn) => {
    btn.classList.toggle('active', btn.dataset.mode === currentMode);
  });
  const desc = document.getElementById('mode-description');
  if (desc) {
    const key = currentMode === 'learn' ? 'modeLearnDesc' : 'modeExamDesc';
    desc.textContent = t(key);
    desc.dataset.i18n = key;
  }
  syncCategoriesProgressLink();
}

function syncCategoriesProgressLink() {
  const link = document.querySelector('.btn-history-link');
  if (!link) return;
  if (currentMode === 'learn') {
    link.dataset.navigate = 'learn-progress';
    link.dataset.i18n = 'learnProgress';
    link.textContent = t('learnProgress');
  } else {
    link.dataset.navigate = 'history';
    link.dataset.i18n = 'examHistory';
    link.textContent = t('examHistory');
  }
}
const RECENT_CATEGORIES_KEY = 'prawko_recent_categories';
const RECENT_CATEGORIES_LIMIT = 4;
const EXAM_SKIN_KEY = 'prawko_exam_skin';

// ---- Router ----
function navigate(screen) {
  setProfilePanelOpen(false);
  window.location.hash = screen;
}

const VALID_SCREENS = new Set(['home', 'categories', 'quiz', 'results', 'history', 'learn-progress', 'zrodlo-danych']);

function focusCurrentScreenHeading(screenId) {
  const screen = document.getElementById(screenId);
  const heading = screen?.querySelector('h1, h2');
  if (!heading) return;
  const hadTabIndex = heading.hasAttribute('tabindex');
  if (!hadTabIndex) heading.setAttribute('tabindex', '-1');
  heading.focus({ preventScroll: true, focusVisible: false });
  if (!hadTabIndex) {
    heading.addEventListener('blur', () => heading.removeAttribute('tabindex'), { once: true });
  }
}

function getAvailableCategoryIds() {
  return new Set((meta?.categories || []).map(cat => cat.id));
}

function loadRecentCategories() {
  try {
    const parsed = JSON.parse(profileGet(RECENT_CATEGORIES_KEY) || '[]');
    return Array.isArray(parsed) ? parsed.filter(id => typeof id === 'string') : [];
  } catch {
    return [];
  }
}

function saveRecentCategories(ids) {
  try { profileSet(RECENT_CATEGORIES_KEY, JSON.stringify(ids)); } catch {}
}

function addRecentCategory(categoryId) {
  const next = [categoryId, ...loadRecentCategories().filter(id => id !== categoryId)].slice(0, RECENT_CATEGORIES_LIMIT);
  saveRecentCategories(next);
}

function syncCategoryCardVisibility() {
  const available = getAvailableCategoryIds();
  document.querySelectorAll('.category-grid .category-card').forEach((card) => {
    card.hidden = !available.has(card.dataset.category);
  });
}

function applyCategorySearch() {
  const searchInput = document.getElementById('category-search');
  const query = (searchInput?.value || '').trim().toLowerCase();
  document.querySelectorAll('#categories .category-card').forEach((card) => {
    if (card.closest('.category-grid') && card.hidden) return;
    const text = `${card.dataset.category || ''} ${card.querySelector('.category-name')?.textContent || ''}`.toLowerCase();
    card.style.display = !query || text.includes(query) ? '' : 'none';
  });
  const recentSection = document.getElementById('recent-categories');
  const recentRow = document.getElementById('recent-categories-row');
  if (!recentSection || !recentRow) return;
  const hasVisibleRecent = [...recentRow.querySelectorAll('.category-card')].some(card => card.style.display !== 'none');
  recentSection.hidden = recentRow.children.length === 0 || !hasVisibleRecent;
  layoutCategoryGrid();
}

function renderRecentCategories() {
  const recentSection = document.getElementById('recent-categories');
  const recentRow = document.getElementById('recent-categories-row');
  if (!recentSection || !recentRow) return;
  const available = getAvailableCategoryIds();
  const ids = loadRecentCategories().filter(id => available.has(id)).slice(0, RECENT_CATEGORIES_LIMIT);
  recentRow.textContent = '';
  ids.forEach((id) => {
    const sourceCard = document.querySelector(`.category-grid .category-card[data-category="${CSS.escape(id)}"]`);
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = 'category-card recent-category-card';
    btn.dataset.category = id;
    const letter = document.createElement('span');
    letter.className = 'category-letter';
    letter.textContent = sourceCard?.querySelector('.category-letter')?.textContent || id;
    const name = document.createElement('span');
    name.className = 'category-name';
    name.textContent = sourceCard?.querySelector('.category-name')?.textContent || id;
    if (sourceCard?.classList.contains('category-unavailable')) {
      btn.classList.add('category-unavailable');
      btn.setAttribute('aria-disabled', 'true');
    }
    if (sourceCard?.dataset.mediaAccess) btn.dataset.mediaAccess = sourceCard.dataset.mediaAccess;
    if (sourceCard?.title) btn.title = sourceCard.title;
    btn.append(letter, name);
    recentRow.appendChild(btn);
  });
  recentSection.hidden = ids.length === 0;
}

function applyCategoryUiTranslations() {
  const searchInput = document.getElementById('category-search');
  if (!searchInput) return;
  searchInput.placeholder = t('categoriesSearchPlaceholder');
  searchInput.setAttribute('aria-label', t('categoriesSearchLabel'));
}

function syncSessionChrome(screenId) {
  const hide = screenId === 'quiz';
  document.body.classList.toggle('session-chrome-hidden', hide);
  const controls = document.querySelector('.top-controls');
  if (controls) controls.hidden = hide;
}

function handleRoute() {
  const hash = window.location.hash.slice(1) || 'home';

  if (!VALID_SCREENS.has(hash)) {
    window.location.hash = 'home';
    return;
  }

  // Cleanup active sessions when leaving quiz
  if (hash !== 'quiz') {
    cleanupExam();
    cleanupLearn();
    setQuizCategoryPill(null);
  }

  // If navigating to quiz with a pending category, start the session
  if (hash === 'quiz' && pendingCategory) {
    const cat = pendingCategory;
    pendingCategory = null;
    showScreen('quiz');
    focusCurrentScreenHeading('quiz');
    syncSessionChrome('quiz');
    launchSession(cat);
    refitUiScale();
    return;
  }

  // Redirect stale quiz screen (no pending session) to categories
  if (hash === 'quiz' && !pendingCategory) {
    window.location.hash = 'categories';
    return;
  }

  if (hash === 'categories' && meta) {
    renderCategories(meta, getDownloadedCategories());
    syncCategoryCardVisibility();
    renderRecentCategories();
    applyCategorySearch();
  }
  if (hash === 'history') renderHistory();
  if (hash === 'learn-progress') renderLearnProgress(meta);
  if (hash === 'results') {
    const last = loadLastResult();
    if (last) renderResults(last);
  }
  if (hash === 'results' || hash === 'history') setAppMode('exam');
  if (hash === 'learn-progress') setAppMode('learn');
  showScreen(hash);
  focusCurrentScreenHeading(hash);
  syncSessionChrome(hash);
  refitUiScale();
}

// ---- Category & Mode Selection ----
async function launchSession(categoryId) {
  try {
    const data = await fetchCategory(categoryId);
    setQuizCategoryPill(categoryId);
    if (currentMode === 'exam') {
      startExam(data, meta);
    } else {
      startLearn(data);
    }
  } catch {
    window.location.hash = 'categories';
  }
}

function handleCategorySelect(categoryId) {
  addRecentCategory(categoryId);
  pendingCategory = categoryId;
  navigate('quiz');
}

function updateLanguageButtons(lang) {
  document.documentElement.lang = lang === 'uk' ? 'uk' : lang;
  const btn = document.querySelector('.lang-cycle');
  if (!btn) return;
  btn.dataset.lang = lang;
  btn.textContent = LANG_LABELS[lang] || lang.toUpperCase();
  btn.classList.add('active');
  btn.setAttribute('aria-label', t('langToggle'));
}

function getInitialTheme() {
  try {
    const stored = localStorage.getItem('prawko_theme');
    if (stored === 'dark' || stored === 'light') return stored;
  } catch {}
  return window.matchMedia?.('(prefers-color-scheme: dark)').matches ? 'dark' : 'light';
}

function applyTheme(theme, themeIcon, themeBtn) {
  const isDark = theme === 'dark';
  if (isDark) document.documentElement.setAttribute('data-theme', 'dark');
  else document.documentElement.removeAttribute('data-theme');
  if (themeIcon) themeIcon.innerHTML = isDark ? '<use href="#icon-sun"/>' : '<use href="#icon-moon"/>';
  if (themeBtn) themeBtn.setAttribute('aria-pressed', isDark ? 'true' : 'false');
}

function normalizeExamSkin(raw) {
  if (raw === 'image' || raw === 'station') return 'station';
  return 'panel';
}

function getInitialExamSkin() {
  try {
    return normalizeExamSkin(localStorage.getItem(EXAM_SKIN_KEY));
  } catch {
    return 'panel';
  }
}

function applyExamSkin(skin) {
  const next = normalizeExamSkin(skin);
  document.documentElement.setAttribute('data-exam-skin', next);
  const btn = document.querySelector('.skin-btn');
  if (btn) {
    const label = next === 'panel' ? t('examSkinPanel') : t('examSkinStation');
    btn.textContent = label;
    btn.setAttribute('aria-pressed', next === 'panel' ? 'true' : 'false');
    btn.setAttribute('aria-label', `${t('examSkinToggle')}: ${label}`);
  }
  refitUiScale();
}

function fillProfilePanel() {
  const toggle = document.querySelector('.profile-toggle');
  const nameEl = document.querySelector('.profile-toggle-name');
  const list = document.querySelector('.profile-list');
  const learnEl = document.querySelector('.profile-stat-learn');
  const examsEl = document.querySelector('.profile-stat-exams');
  const deleteBtn = document.querySelector('.profile-action-delete');
  const closeBtn = document.querySelector('.profile-panel-close');
  if (!toggle || !list) return;

  const activeId = getActiveProfileId();
  const profiles = listProfiles();
  const active = profiles.find((p) => p.id === activeId);
  if (nameEl) nameEl.textContent = formatProfileName(active?.name || DEFAULT_PROFILE_NAME, t);
  toggle.setAttribute('aria-label', `${t('profileLabel')}: ${formatProfileName(active?.name || DEFAULT_PROFILE_NAME, t)}`);
  if (closeBtn) closeBtn.setAttribute('aria-label', t('profileClose'));

  list.innerHTML = '';
  profiles.forEach((profile) => {
    const item = document.createElement('li');
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = 'profile-list-btn' + (profile.id === activeId ? ' active' : '');
    btn.dataset.id = profile.id;
    btn.textContent = formatProfileName(profile.name, t);
    if (profile.id === activeId) btn.setAttribute('aria-current', 'true');
    item.appendChild(btn);
    list.appendChild(item);
  });

  const summary = getProfileSummary();
  if (learnEl) {
    const learnText = t('profileLearn').replace('{known}', String(summary.learnKnown));
    learnEl.textContent = learnText;
    learnEl.setAttribute('aria-label', `${learnText}. ${t('learnProgress')}`);
  }
  if (examsEl) {
    const examsText = t('profileExams')
      .replace('{n}', String(summary.exams))
      .replace('{passed}', String(summary.examsPassed));
    examsEl.textContent = examsText;
    examsEl.setAttribute('aria-label', `${examsText}. ${t('examHistory')}`);
  }
  if (deleteBtn) deleteBtn.textContent = profiles.length <= 1 ? t('profileReset') : t('profileDelete');
  const practiceBox = document.querySelector('.profile-practice-exam');
  if (practiceBox) practiceBox.checked = getPracticeExamEnabled();
}

function setProfilePanelOpen(open) {
  const toggle = document.querySelector('.profile-toggle');
  const panel = document.getElementById('profile-panel');
  if (!toggle || !panel) return;
  panel.hidden = !open;
  toggle.setAttribute('aria-expanded', open ? 'true' : 'false');
  fillProfilePanel();
}

function refreshAfterProfileChange() {
  const hash = window.location.hash.slice(1) || 'home';
  if (hash === 'quiz' || hash === 'results') {
    pendingCategory = null;
    cleanupLearn();
    cleanupExam();
    fillProfilePanel();
    setProfilePanelOpen(false);
    navigate('categories');
    return;
  }
  fillProfilePanel();
  setProfilePanelOpen(false);
  if (hash === 'categories' && meta) {
    renderCategories(meta, getDownloadedCategories());
    syncCategoryCardVisibility();
    renderRecentCategories();
    applyCategorySearch();
  }
  if (hash === 'history') renderHistory();
  if (hash === 'learn-progress') renderLearnProgress(meta);
  refitUiScale();
}

function setupProfileSwitcher() {
  const switcher = document.querySelector('.profile-switch');
  const toggle = document.querySelector('.profile-toggle');
  const panel = document.getElementById('profile-panel');
  if (!switcher || !toggle || !panel) return;

  fillProfilePanel();
  document.addEventListener('prawko:language', fillProfilePanel);

  toggle.addEventListener('click', (e) => {
    e.stopPropagation();
    setProfilePanelOpen(panel.hidden);
  });

  panel.querySelector('.profile-panel-close')?.addEventListener('click', () => {
    setProfilePanelOpen(false);
    toggle.focus();
  });

  panel.querySelector('.profile-list')?.addEventListener('click', (e) => {
    const btn = e.target.closest('.profile-list-btn');
    if (!btn?.dataset.id) return;
    if (btn.dataset.id === getActiveProfileId()) return;
    setActiveProfile(btn.dataset.id);
    refreshAfterProfileChange();
  });

  panel.querySelector('.profile-action-rename')?.addEventListener('click', () => {
    setProfilePanelOpen(false);
    const current = listProfiles().find((p) => p.id === getActiveProfileId());
    const name = window.prompt(t('profileRenamePrompt'), formatProfileName(current?.name || '', t));
    if (!name || !String(name).trim()) return;
    if (renameProfile(getActiveProfileId(), name)) fillProfilePanel();
  });

  panel.querySelector('.profile-action-new')?.addEventListener('click', () => {
    setProfilePanelOpen(false);
    if (listProfiles().length >= PROFILE_LIMIT) {
      window.alert(t('profileLimit'));
      return;
    }
    const name = window.prompt(t('profileNamePrompt'), t('profileDefaultNew'));
    if (!name || !String(name).trim()) return;
    createProfile(name);
    refreshAfterProfileChange();
  });

  panel.querySelector('.profile-action-delete')?.addEventListener('click', () => {
    const profiles = listProfiles();
    const current = profiles.find((p) => p.id === getActiveProfileId());
    const isLast = profiles.length <= 1;
    setProfilePanelOpen(false);
    showConfirmModal(
      t(isLast ? 'profileResetTitle' : 'profileDeleteTitle'),
      isLast
        ? t('profileResetDesc').replace('{name}', t('profileDefaultMe'))
        : t('profileDeleteDesc').replace('{name}', formatProfileName(current?.name || '', t)),
      () => {
        deleteProfile(getActiveProfileId());
        refreshAfterProfileChange();
      },
      {
        confirmLabel: t(isLast ? 'profileResetConfirm' : 'profileDeleteConfirm'),
        cancelLabel: t('profileDeleteCancel'),
      }
    );
  });

  panel.querySelector('.profile-stat-exams')?.addEventListener('click', () => {
    setProfilePanelOpen(false);
  });

  panel.querySelector('.profile-stat-learn')?.addEventListener('click', () => {
    setProfilePanelOpen(false);
  });

  panel.querySelector('.profile-practice-exam')?.addEventListener('change', (e) => {
    setPracticeExamEnabled(Boolean(e.target.checked));
  });

  document.addEventListener('pointerdown', (e) => {
    if (panel.hidden) return;
    if (switcher.contains(e.target)) return;
    if (document.getElementById('confirm-modal')?.classList.contains('active')) return;
    setProfilePanelOpen(false);
  });

  document.addEventListener('keydown', (e) => {
    if (e.key !== 'Escape' || panel.hidden) return;
    if (document.getElementById('confirm-modal')?.classList.contains('active')) return;
    setProfilePanelOpen(false);
    toggle.focus();
  });
}

const UPDATE_CHECK_INTERVAL_MS = 30 * 1000;
const UPDATE_IGNORE_AFTER_REFRESH_MS = 15 * 1000;
let lastUpdateCheckAt = 0;
let ignoreUpdatesUntil = 0;
let isReloadingForSw = false;

function readIgnoreUpdatesUntil() {
  try {
    return Number(sessionStorage.getItem('prawko_ignore_updates_until') || 0);
  } catch {
    return 0;
  }
}

function rememberRefreshIgnore() {
  ignoreUpdatesUntil = Date.now() + UPDATE_IGNORE_AFTER_REFRESH_MS;
  try {
    sessionStorage.setItem('prawko_ignore_updates_until', String(ignoreUpdatesUntil));
  } catch {}
}

function showUpdateBanner({ force = false } = {}) {
  if (!force && Date.now() < Math.max(ignoreUpdatesUntil, readIgnoreUpdatesUntil())) return;
  const banner = document.getElementById('update-banner');
  if (!banner || !banner.hidden) return;
  banner.hidden = false;
  refitUiScale();
}

function setupAppUpdateChecks(registration) {
  ignoreUpdatesUntil = Math.max(ignoreUpdatesUntil, readIgnoreUpdatesUntil());
  const tick = () => {
    if (document.hidden) return;
    if (registration.waiting) {
      showUpdateBanner({ force: true });
      return;
    }
    const banner = document.getElementById('update-banner');
    if (banner && !banner.hidden) return;
    const now = Date.now();
    if (now - lastUpdateCheckAt < UPDATE_CHECK_INTERVAL_MS) return;
    lastUpdateCheckAt = now;
    registration.update().catch(() => {});
  };
  document.addEventListener('visibilitychange', () => {
    if (!document.hidden) tick();
  });
  window.addEventListener('focus', tick);
  lastUpdateCheckAt = 0;
  tick();
  setInterval(tick, UPDATE_CHECK_INTERVAL_MS);
}

function reloadForUpdate() {
  if (isReloadingForSw) return;
  isReloadingForSw = true;
  location.reload();
}

async function applyAppUpdate(registration) {
  rememberRefreshIgnore();
  const reg = registration || (await navigator.serviceWorker.getRegistration().catch(() => null));
  const waiting = reg?.waiting;
  if (waiting) {
    let reloaded = false;
    const reload = () => {
      if (reloaded) return;
      reloaded = true;
      reloadForUpdate();
    };
    navigator.serviceWorker.addEventListener('controllerchange', reload, { once: true });
    waiting.postMessage({ type: 'SKIP_WAITING' });
    setTimeout(reload, 600);
    return;
  }
  try {
    const keys = await caches.keys();
    await Promise.all(keys.filter((key) => key.includes('-shell')).map((key) => caches.delete(key)));
  } catch { /* still reload */ }
  reloadForUpdate();
}

// ---- Init ----
async function init() {
  setupUiFitScale();
  // Load metadata
  const spinner = document.getElementById('home-spinner');
  try {
    meta = await fetchMeta();
    uniqueQuestionCount = await fetchUniqueQuestionCount();
    paintHomeTagline();
    renderCategories(meta, getDownloadedCategories());
    syncCategoryCardVisibility();
    renderRecentCategories();
    reconcileDownloadedCategories()
      .then((verifiedSet) => {
        if (meta) {
          renderCategories(meta, verifiedSet);
          syncCategoryCardVisibility();
          renderRecentCategories();
          applyCategorySearch();
        }
      })
      .catch(() => {});
    if (spinner) spinner.classList.add('hidden');
  } catch {
    if (spinner) spinner.classList.add('hidden');
    document.getElementById('app').textContent = 'Failed to load app data. Please refresh.';
    return;
  }

  // Navigation buttons (data-navigate attribute)
  document.querySelectorAll('[data-navigate]').forEach(el => {
    el.addEventListener('click', (e) => {
      e.preventDefault();
      const target = el.dataset.navigate;
      if (target === 'categories' && el.closest('#results, #history')) {
        setAppMode('exam');
      }
      if (target === 'categories' && el.closest('#learn-progress')) {
        setAppMode('learn');
      }
      if (target === 'history') setAppMode('exam');
      if (target === 'learn-progress') setAppMode('learn');
      navigate(target);
    });
  });

  // Mode toggle
  document.querySelectorAll('.mode-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      setAppMode(btn.dataset.mode);
      if (meta) {
        renderCategories(meta, getDownloadedCategories());
        renderRecentCategories();
      }
    });
  });

  // Category cards (main grid + recent row)
  document.getElementById('categories')?.addEventListener('click', (e) => {
    const card = e.target.closest('.category-card');
    if (!card || e.target.closest('.offline-btn')) return;
    const categoryId = card.dataset.category;
    if (!categoryId) return;
    if (card.closest('.category-grid') && card.hidden) return;
    if (card.classList.contains('category-unavailable') || card.getAttribute('aria-disabled') === 'true') return;
    handleCategorySelect(categoryId);
  });

  document.getElementById('category-search')?.addEventListener('input', applyCategorySearch);

  // Retry button
  document.querySelector('.btn-retry')?.addEventListener('click', () => {
    setAppMode('exam');
    const lastCat = getLastExamCategory() || loadHistory().at(-1)?.category;
    if (!lastCat) {
      navigate('categories');
      return;
    }
    pendingCategory = lastCat;
    navigate('quiz');
  });

  // Theme toggle
  const themeBtn = document.querySelector('.theme-btn');
  const themeIcon = themeBtn?.querySelector('.theme-icon');
  applyTheme(getInitialTheme(), themeIcon, themeBtn);
  applyExamSkin(getInitialExamSkin());
  setupProfileSwitcher();
  themeBtn?.addEventListener('click', () => {
    const isDark = document.documentElement.getAttribute('data-theme') === 'dark';
    const nextTheme = isDark ? 'light' : 'dark';
    applyTheme(nextTheme, themeIcon, themeBtn);
    try { localStorage.setItem('prawko_theme', nextTheme); } catch {}
  });
  document.querySelector('.skin-btn')?.addEventListener('click', () => {
    const current = normalizeExamSkin(document.documentElement.getAttribute('data-exam-skin'));
    const next = current === 'panel' ? 'station' : 'panel';
    applyExamSkin(next);
    try { localStorage.setItem(EXAM_SKIN_KEY, next); } catch {}
  });

  // Language toggle
  const savedLang = getLang();
  updateLanguageButtons(savedLang);
  if (savedLang !== 'pl') {
    setLang(savedLang);
    applyLanguage();
    updateLanguageButtons(savedLang);
    paintHomeTagline();
    fillProfilePanel();
    await loadQuestionTranslations(savedLang);
  }
  document.querySelector('.lang-cycle')?.addEventListener('click', async () => {
    const lang = nextLang(getLang());
    updateLanguageButtons(lang);
    setLang(lang);
    applyLanguage();
    updateLanguageButtons(lang);
    paintHomeTagline();
    fillProfilePanel();
    applyExamSkin(document.documentElement.getAttribute('data-exam-skin'));
    syncCategoriesProgressLink();
    renderCategories(meta, getDownloadedCategories());
    syncCategoryCardVisibility();
    renderRecentCategories();
    applyCategoryUiTranslations();
    applyCategorySearch();
    if (lang !== 'pl') await loadQuestionTranslations(lang);
    else await loadQuestionTranslations('pl');
    if (document.getElementById('quiz').classList.contains('active')) {
      refreshLearnQuestion();
      refreshExamQuestion();
    }
    if (document.getElementById('results').classList.contains('active')) {
      const last = loadLastResult();
      if (last) renderResults(last);
    }
    if (document.getElementById('history').classList.contains('active')) renderHistory();
    if (document.getElementById('learn-progress').classList.contains('active')) renderLearnProgress(meta);
  });

  // Offline download handler
  document.querySelector('.category-grid').addEventListener('click', async (e) => {
    const dlBtn = e.target.closest('.offline-btn');
    if (!dlBtn) return;
    e.stopPropagation();
    e.preventDefault();

    const catId = dlBtn.dataset.category;
    if (dlBtn.classList.contains('downloaded') || dlBtn.classList.contains('downloading') || dlBtn.classList.contains('unavailable')) return;

    dlBtn.classList.add('downloading');
    dlBtn.textContent = '\u2193 0%';
    dlBtn.style.setProperty('--dl-progress', '0');

    try {
      const result = await downloadCategoryMedia(catId, (done, total) => {
        const pct = Math.round((done / total) * 100);
        dlBtn.textContent = `\u2193 ${pct}%`;
        dlBtn.style.setProperty('--dl-progress', String(pct));
      });
      await reconcileDownloadedCategories();
      dlBtn.classList.remove('downloading');
      dlBtn.style.removeProperty('--dl-progress');
      if (result.success) {
        dlBtn.classList.add('downloaded');
        dlBtn.textContent = `\u2713 ${t('savedOffline')}`;
      } else {
        dlBtn.classList.remove('downloaded');
        dlBtn.textContent = `\u2193 ${t('saveOffline')}`;
      }
      renderCategories(meta, getDownloadedCategories());
      syncCategoryCardVisibility();
      renderRecentCategories();
      applyCategorySearch();
    } catch {
      dlBtn.classList.remove('downloading');
      dlBtn.style.removeProperty('--dl-progress');
      dlBtn.textContent = `\u2193 ${t('saveOffline')}`;
      renderCategories(meta, getDownloadedCategories());
      syncCategoryCardVisibility();
      renderRecentCategories();
      applyCategorySearch();
    }
  });

  // Clear history button — with confirmation
  document.querySelector('.btn-clear-history')?.addEventListener('click', () => {
    showConfirmModal(t('confirmClearHistory'), t('confirmClearHistoryDesc'), () => {
      clearHistory();
      renderHistory();
      fillProfilePanel();
    });
  });

  document.querySelector('.btn-clear-learn')?.addEventListener('click', () => {
    showConfirmModal(t('confirmClearLearn'), t('confirmClearLearnDesc'), () => {
      clearLearnProgress();
      renderLearnProgress(meta);
      fillProfilePanel();
      if (meta) {
        renderCategories(meta, getDownloadedCategories());
        renderRecentCategories();
      }
    });
  });

  // Setup exam and learn listeners
  setupExamListeners();
  setupLearnListeners();
  applyCategoryUiTranslations();
  renderRecentCategories();
  applyCategorySearch();

  // Hash routing
  window.addEventListener('hashchange', handleRoute);
  handleRoute();

  // Register service worker
  let swRegistration = null;
  if ('serviceWorker' in navigator) {
    swRegistration = await navigator.serviceWorker.register('sw.js', { updateViaCache: 'none' }).catch(err => {
      console.warn('SW registration failed:', err);
      return null;
    });
    if (swRegistration?.waiting) showUpdateBanner({ force: true });
    swRegistration?.addEventListener('updatefound', () => {
      const candidate = swRegistration.installing;
      if (!candidate) return;
      candidate.addEventListener('statechange', () => {
        if (candidate.state === 'installed' && navigator.serviceWorker.controller) {
          showUpdateBanner({ force: true });
        }
      });
    });

    // Listen for update notifications from SW
    navigator.serviceWorker.addEventListener('message', (event) => {
      if (event.data?.type === 'APP_UPDATED' || event.data?.type === 'DATA_UPDATED') {
        showUpdateBanner();
      }
    });
    navigator.serviceWorker.addEventListener('controllerchange', () => {
      reloadForUpdate();
    });
    if (swRegistration) setupAppUpdateChecks(swRegistration);
  }

  // Update banner reload
  document.getElementById('update-banner-btn')?.addEventListener('click', () => {
    applyAppUpdate(swRegistration);
  });

  const offlineBanner = document.getElementById('offline-banner');
  function updateOnlineStatus() {
    if (offlineBanner) offlineBanner.style.display = navigator.onLine ? 'none' : '';
    if (meta) {
      renderCategories(meta, getDownloadedCategories());
      syncCategoryCardVisibility();
      renderRecentCategories();
      applyCategorySearch();
    }
    refitUiScale();
  }
  window.addEventListener('online', updateOnlineStatus);
  window.addEventListener('offline', updateOnlineStatus);
  updateOnlineStatus();

  // Preload category data on hover
  document.querySelectorAll('.category-card').forEach(card => {
    card.addEventListener('mouseenter', () => {
      fetchCategory(card.dataset.category).catch(() => {});
    }, { once: true });
  });
}

document.addEventListener('DOMContentLoaded', init);
