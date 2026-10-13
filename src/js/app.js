// app.js — Router, initialization, and event wiring

import { fetchMeta, fetchCategory, fetchUniqueQuestionCount, loadLocalConfig } from './data.js';
import { startExam, setupExamListeners, cleanupExam, getLastExamCategory, refreshExamQuestion } from './exam.js';
import { startLearn, setupLearnListeners, cleanupLearn, refreshLearnQuestion, loadLearnLocalFlags } from './learn.js';
import { showScreen, renderCategories, applyLanguage, renderHistory, renderLearnProgress, renderResults, showConfirmModal, refreshOfflineCoverage } from './ui.js';
import { setLang, getLang, loadQuestionTranslations, nextLang, LANG_LABELS, t, readStoredLang } from './i18n.js';
import { downloadCategoryMedia, getDownloadedCategories, reconcileDownloadedCategories, offlineCoverageHue, getInProgressOfflineCategory, getActiveDownloadProgress } from './offline.js';
import { getProfileSummary, loadHistory, loadLastResult, clearHistory, clearLearnProgress, packLearnForExport, unpackLearnFromImport, packExamHistoryForExport, unpackExamHistoryFromImport } from './stats.js';
import { setupUiFitScale, refitUiScale, revealUiScale, layoutCategoryGrid, applyUiFitScale } from './scale.js';
import {
  DEFAULT_PROFILE_NAME,
  PROFILE_LIMIT,
  createProfile,
  deleteProfile,
  formatProfileName,
  getActiveProfileId,
  getPracticeExamEnabled,
  importProfileSnapshot,
  listProfiles,
  profileGet,
  profileSet,
  renameProfile,
  snapshotActiveProfile,
  setActiveProfile,
  setPracticeExamEnabled,
} from './profiles.js';

let meta = null;
let uniqueQuestionCount = null;
let currentMode = 'learn'; // 'learn' or 'exam'
let pendingCategory = null;
let pendingOfflineDownload = null;

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
  const hide = screenId !== 'home';
  document.body.classList.toggle('session-chrome-hidden', hide);
  const controls = document.querySelector('.top-controls');
  if (controls) controls.hidden = hide;
  if (hide) setProfilePanelOpen(false);
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
    const quiz = document.getElementById('quiz');
    document.documentElement.setAttribute('data-ui-hold', '1');
    quiz?.classList.toggle('learn-active', currentMode === 'learn');
    quiz?.classList.toggle('exam-active', currentMode === 'exam');
    showScreen('quiz');
    focusCurrentScreenHeading('quiz');
    syncSessionChrome('quiz');
    launchSession(cat);
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
  if (hash === 'categories' && pendingOfflineDownload) {
    const catId = pendingOfflineDownload;
    pendingOfflineDownload = null;
    requestAnimationFrame(() => {
      const dlBtn = document.querySelector(`.category-grid .offline-btn[data-category="${CSS.escape(catId)}"]`);
      dlBtn?.closest('.category-card')?.scrollIntoView({ block: 'center', behavior: 'smooth' });
      startOfflineDownload(dlBtn);
    });
  } else if (hash === 'categories') {
    resumeOfflineDownloadIfNeeded();
  }
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
    syncSessionChrome('quiz');
    applyUiFitScale();
  } catch {
    window.location.hash = 'categories';
  } finally {
    document.documentElement.removeAttribute('data-ui-hold');
  }
}

function handleCategorySelect(categoryId) {
  addRecentCategory(categoryId);
  pendingCategory = categoryId;
  navigate('quiz');
}

async function startOfflineDownload(dlBtn) {
  if (!dlBtn) return;
  const catId = dlBtn.dataset.category;
  if (!catId) return;
  if (dlBtn.classList.contains('downloaded') || dlBtn.classList.contains('downloading') || dlBtn.classList.contains('unavailable')) return;

  dlBtn.classList.add('downloading');
  const startPct = Number(dlBtn.dataset.offlinePct);
  const initial = Number.isFinite(startPct) && startPct > 0 ? Math.min(99, Math.round(startPct)) : 0;
  dlBtn.textContent = `\u2193 ${initial}%`;
  dlBtn.style.setProperty('--dl-progress', String(initial));
  dlBtn.style.setProperty('--offline-hue', String(offlineCoverageHue(initial)));

  try {
    const result = await downloadCategoryMedia(catId, (done, total) => {
      const pct = Math.round((done / total) * 100);
      const btn = document.querySelector(`.category-grid .offline-btn[data-category="${CSS.escape(catId)}"]`) || dlBtn;
      btn.classList.add('downloading');
      btn.textContent = `\u2193 ${pct}%`;
      btn.style.setProperty('--dl-progress', String(pct));
      btn.style.setProperty('--offline-hue', String(offlineCoverageHue(pct)));
    });
    const verifiedSet = await reconcileDownloadedCategories();
    dlBtn.classList.remove('downloading');
    dlBtn.style.removeProperty('--dl-progress');
    if (result.success) {
      dlBtn.classList.add('downloaded');
      dlBtn.textContent = `\u2713 ${t('savedOffline')}`;
    } else {
      dlBtn.classList.remove('downloaded');
      dlBtn.textContent = `\u2193 ${t('saveOffline')}`;
    }
    renderCategories(meta, verifiedSet);
    await refreshOfflineCoverage(meta, verifiedSet);
    syncCategoryCardVisibility();
    renderRecentCategories();
    applyCategorySearch();
  } catch {
    dlBtn.classList.remove('downloading');
    dlBtn.style.removeProperty('--dl-progress');
    dlBtn.textContent = `\u2193 ${t('saveOffline')}`;
    const verifiedSet = getDownloadedCategories();
    renderCategories(meta, verifiedSet);
    refreshOfflineCoverage(meta, verifiedSet).catch(() => {});
    syncCategoryCardVisibility();
    renderRecentCategories();
    applyCategorySearch();
  }
}

function resumeOfflineDownloadIfNeeded() {
  const catId = getInProgressOfflineCategory();
  if (!catId || !meta) return;
  if (getActiveDownloadProgress(catId)) return;
  const dlBtn = document.querySelector(`.category-grid .offline-btn[data-category="${CSS.escape(catId)}"]`);
  if (!dlBtn || dlBtn.classList.contains('unavailable') || dlBtn.classList.contains('downloaded')) return;
  startOfflineDownload(dlBtn);
}

function updateLanguageButtons(lang) {
  document.documentElement.lang = lang;
  const btn = document.querySelector('.lang-cycle');
  if (!btn) return;
  btn.dataset.lang = lang;
  btn.textContent = LANG_LABELS[lang] || lang.toUpperCase();
  btn.classList.add('active');
  btn.setAttribute('aria-label', t('langToggle'));
}

const THEME_CYCLE = ['light', 'dark', 'system'];

function normalizeThemeChoice(raw) {
  if (raw === 'light' || raw === 'dark' || raw === 'system') return raw;
  return null;
}

function systemPrefersDark() {
  return window.matchMedia?.('(prefers-color-scheme: dark)').matches === true;
}

function getInitialTheme() {
  try {
    const stored = normalizeThemeChoice(profileGet('prawko_theme'));
    if (stored) return stored;
  } catch {}
  const fallback = systemPrefersDark() ? 'dark' : 'light';
  try { profileSet('prawko_theme', fallback); } catch {}
  return fallback;
}

function themeChoiceLabel(choice) {
  if (choice === 'dark') return t('themeDark');
  if (choice === 'system') return t('themeSystem');
  return t('themeLight');
}

function applyTheme(theme, themeIcon, themeBtn) {
  const choice = normalizeThemeChoice(theme) || 'light';
  const isDark = choice === 'dark' || (choice === 'system' && systemPrefersDark());
  if (isDark) document.documentElement.setAttribute('data-theme', 'dark');
  else document.documentElement.removeAttribute('data-theme');
  document.documentElement.setAttribute('data-theme-choice', choice);
  const icon = choice === 'dark' ? '#icon-moon' : choice === 'system' ? '#icon-system' : '#icon-sun';
  if (themeIcon) themeIcon.innerHTML = `<use href="${icon}"/>`;
  if (themeBtn) {
    const pressed = choice === 'dark' ? 'true' : choice === 'system' ? 'mixed' : 'false';
    themeBtn.setAttribute('aria-pressed', pressed);
    const label = themeChoiceLabel(choice);
    themeBtn.setAttribute('aria-label', label);
    themeBtn.title = label;
  }
}

function watchSystemTheme() {
  const mq = window.matchMedia?.('(prefers-color-scheme: dark)');
  if (!mq?.addEventListener) return;
  mq.addEventListener('change', () => {
    if (getInitialTheme() !== 'system') return;
    const themeBtn = document.querySelector('.theme-btn');
    applyTheme('system', themeBtn?.querySelector('.theme-icon'), themeBtn);
  });
}

function nextThemeChoice(choice) {
  const index = THEME_CYCLE.indexOf(normalizeThemeChoice(choice) || 'light');
  return THEME_CYCLE[(index + 1) % THEME_CYCLE.length];
}

function normalizeExamSkin(raw) {
  if (raw === 'image' || raw === 'station') return 'station';
  return 'panel';
}

function getInitialExamSkin() {
  let raw = null;
  try { raw = profileGet(EXAM_SKIN_KEY); } catch {}
  const next = normalizeExamSkin(raw);
  if (raw !== 'panel' && raw !== 'station') {
    try { profileSet(EXAM_SKIN_KEY, next); } catch {}
  }
  return next;
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

let profileListOpen = false;

function setProfileListOpen(open) {
  const list = document.querySelector('.profile-list');
  const toggle = document.querySelector('.profile-list-toggle');
  profileListOpen = Boolean(open);
  if (list) list.hidden = !profileListOpen;
  if (toggle) {
    toggle.hidden = false;
    toggle.setAttribute('aria-expanded', profileListOpen ? 'true' : 'false');
    const label = t('profileList');
    toggle.setAttribute('aria-label', label);
    toggle.title = label;
  }
}

function fillProfilePanel() {
  const toggle = document.querySelector('.profile-toggle');
  const nameEl = document.querySelector('.profile-toggle-name');
  const nameInput = document.querySelector('.profile-name-input');
  const list = document.querySelector('.profile-list');
  const learnEl = document.querySelector('.profile-stat-learn');
  const examsEl = document.querySelector('.profile-stat-exams');
  const deleteBtn = document.querySelector('.profile-action-delete');
  const closeBtn = document.querySelector('.profile-panel-close');
  if (!toggle || !list) return;

  const activeId = getActiveProfileId();
  const profiles = listProfiles();
  const active = profiles.find((p) => p.id === activeId);
  const activeName = formatProfileName(active?.name || DEFAULT_PROFILE_NAME, t);
  if (nameEl) nameEl.textContent = activeName;
  if (nameInput && document.activeElement !== nameInput) {
    nameInput.value = activeName;
    nameInput.setAttribute('aria-label', activeName);
  }
  toggle.setAttribute('aria-label', `${t('profileLabel')}: ${activeName}`);
  if (closeBtn) closeBtn.setAttribute('aria-label', t('profileClose'));
  document.querySelectorAll('.profile-io-btn').forEach((btn) => {
    const key = btn.getAttribute('data-i18n-aria');
    if (!key) return;
    const label = t(key);
    btn.setAttribute('aria-label', label);
    btn.title = label;
  });
  list.innerHTML = '';
  profiles.forEach((profile) => {
    if (profile.id === activeId) return;
    const item = document.createElement('li');
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = 'profile-list-btn';
    btn.dataset.id = profile.id;
    btn.textContent = formatProfileName(profile.name, t);
    item.appendChild(btn);
    list.appendChild(item);
  });
  if (profiles.length < PROFILE_LIMIT) {
    const add = document.createElement('li');
    add.className = 'profile-list-add';
    const input = document.createElement('input');
    input.type = 'text';
    input.className = 'profile-list-new';
    input.maxLength = 20;
    input.autocomplete = 'off';
    const hint = t('profileAddPlaceholder');
    input.placeholder = hint;
    input.setAttribute('aria-label', hint);
    add.appendChild(input);
    list.appendChild(add);
  }
  setProfileListOpen(profileListOpen);

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
  if (deleteBtn) {
    const label = profiles.length <= 1 ? t('profileReset') : t('profileDelete');
    deleteBtn.setAttribute('aria-label', label);
    deleteBtn.title = label;
  }
  const practiceBox = document.querySelector('.profile-practice-exam');
  if (practiceBox) practiceBox.checked = getPracticeExamEnabled();
}

let committingNewProfile = false;

function commitNewProfile() {
  if (committingNewProfile) return;
  const input = document.querySelector('.profile-list-new');
  if (!input) return;
  const typed = input.value.trim();
  if (!typed) return;
  if (listProfiles().length >= PROFILE_LIMIT) {
    window.alert(t('profileLimit'));
    input.value = '';
    return;
  }
  committingNewProfile = true;
  profileListOpen = true;
  createProfile(typed);
  refreshAfterProfileChange().finally(() => {
    committingNewProfile = false;
  });
}

function commitProfileName() {
  const input = document.querySelector('.profile-name-input');
  if (!input) return;
  const id = getActiveProfileId();
  const current = listProfiles().find((p) => p.id === id);
  if (!current) return;
  const typed = input.value.trim();
  const display = formatProfileName(current.name, t);
  if (!typed || typed === display || typed === current.name) {
    input.value = display;
    return;
  }
  renameProfile(id, typed);
  const updated = listProfiles().find((p) => p.id === id);
  input.value = formatProfileName(updated?.name || typed, t);
  fillProfilePanel();
}

function profileFileSlug(name) {
  const slug = String(name || '')
    .trim()
    .toLowerCase()
    .replace(/\s+/g, '-')
    .replace(/[^\p{L}\p{N}-]+/gu, '')
    .replace(/^-+|-+$/g, '');
  return slug || 'profil';
}

async function expandProfileSnapshot(raw) {
  if (!raw || raw.v !== 2 || !raw.data || typeof raw.data !== 'object' || Array.isArray(raw.data)) {
    return null;
  }
  const data = { ...raw.data };
  if (Object.prototype.hasOwnProperty.call(data, 'learn')) {
    if (typeof data.learn !== 'string') return null;
    const expanded = await unpackLearnFromImport(data.learn);
    if (expanded == null) return null;
    if (expanded === '{}') delete data.learn;
    else data.learn = expanded;
  }
  if (Object.prototype.hasOwnProperty.call(data, 'stats')) {
    if (typeof data.stats !== 'string') return null;
    const expanded = unpackExamHistoryFromImport(data.stats);
    if (expanded == null) return null;
    if (expanded === '[]') delete data.stats;
    else data.stats = expanded;
  }
  return { ...raw, data };
}

async function downloadProfileSnapshot() {
  const snapshot = snapshotActiveProfile();
  try {
    if (typeof snapshot.data.learn === 'string') {
      const packed = await packLearnForExport(snapshot.data.learn);
      if (packed == null) {
        window.alert(t('profileExportBad'));
        return;
      }
      if (packed === '{}') delete snapshot.data.learn;
      else snapshot.data.learn = packed;
    }
    if (typeof snapshot.data.stats === 'string') {
      const packed = packExamHistoryForExport(snapshot.data.stats);
      if (packed == null) {
        window.alert(t('profileExportBad'));
        return;
      }
      if (packed === '') delete snapshot.data.stats;
      else snapshot.data.stats = packed;
    }
  } catch {
    window.alert(t('profileExportBad'));
    return;
  }
  const blob = new Blob([JSON.stringify(snapshot)], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = `prawko-${profileFileSlug(snapshot.profile.name)}.json`;
  document.body.appendChild(link);
  link.click();
  link.remove();
  URL.revokeObjectURL(url);
}

function finishProfileImport(parsed, overwrite) {
  const result = importProfileSnapshot(parsed, { overwrite });
  if (!result.ok) {
    window.alert(t(result.reason === 'limit' ? 'profileLimit' : 'profileImportBad'));
    return;
  }
  refreshAfterProfileChange();
}

async function importProfileFile(file) {
  if (!file) return;
  let parsed;
  try {
    parsed = JSON.parse(await file.text());
  } catch {
    window.alert(t('profileImportBad'));
    return;
  }
  parsed = await expandProfileSnapshot(parsed);
  if (!parsed) {
    window.alert(t('profileImportBad'));
    return;
  }
  const result = importProfileSnapshot(parsed);
  if (!result.ok && result.reason === 'exists') {
    const name = formatProfileName(result.name, t);
    showConfirmModal(
      t('profileImportOverwriteTitle'),
      t('profileImportOverwriteDesc').replace('{name}', name),
      () => finishProfileImport(parsed, true),
      {
        confirmLabel: t('profileImportOverwriteYes'),
        cancelLabel: t('profileImportOverwriteNo'),
        dismiss: true,
        onCancel: () => finishProfileImport(parsed, false),
      }
    );
    return;
  }
  if (!result.ok) {
    window.alert(t(result.reason === 'limit' ? 'profileLimit' : 'profileImportBad'));
    return;
  }
  refreshAfterProfileChange();
}

function setProfilePanelOpen(open) {
  const toggle = document.querySelector('.profile-toggle');
  const panel = document.getElementById('profile-panel');
  if (!toggle || !panel) return;
  profileListOpen = false;
  panel.hidden = !open;
  toggle.setAttribute('aria-expanded', open ? 'true' : 'false');
  fillProfilePanel();
}

async function applyActiveProfileChrome() {
  const lang = readStoredLang() || getLang();
  const changed = lang !== getLang();
  setLang(lang);
  updateLanguageButtons(lang);
  if (changed) {
    applyLanguage();
    paintHomeTagline();
    fillProfilePanel();
    syncCategoriesProgressLink();
    applyCategoryUiTranslations();
    await loadQuestionTranslations(lang);
  }
  const themeBtn = document.querySelector('.theme-btn');
  applyTheme(getInitialTheme(), themeBtn?.querySelector('.theme-icon'), themeBtn);
  applyExamSkin(getInitialExamSkin());
}

async function refreshAfterProfileChange() {
  await applyActiveProfileChrome();
  const hash = window.location.hash.slice(1) || 'home';
  if (hash === 'quiz' || hash === 'results') {
    pendingCategory = null;
    cleanupLearn();
    cleanupExam();
    fillProfilePanel();
    navigate('categories');
    return;
  }
  fillProfilePanel();
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

  panel.querySelector('.profile-current')?.addEventListener('click', (e) => {
    if (e.target.closest('button, .profile-list')) return;
    const input = panel.querySelector('.profile-name-input');
    if (input && document.activeElement !== input) input.focus();
  });

  const nameInput = panel.querySelector('.profile-name-input');
  nameInput?.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') {
      e.preventDefault();
      nameInput.blur();
    } else if (e.key === 'Escape') {
      const current = listProfiles().find((p) => p.id === getActiveProfileId());
      nameInput.value = formatProfileName(current?.name || '', t);
      nameInput.blur();
    }
  });
  nameInput?.addEventListener('blur', () => {
    commitProfileName();
  });

  panel.querySelector('.profile-list-toggle')?.addEventListener('click', () => {
    setProfileListOpen(!profileListOpen);
  });

  const profileList = panel.querySelector('.profile-list');
  profileList?.addEventListener('click', (e) => {
    const btn = e.target.closest('.profile-list-btn');
    if (!btn?.dataset.id) return;
    if (btn.dataset.id === getActiveProfileId()) return;
    setActiveProfile(btn.dataset.id);
    refreshAfterProfileChange();
  });
  profileList?.addEventListener('keydown', (e) => {
    const input = e.target.closest?.('.profile-list-new');
    if (!input) return;
    if (e.key === 'Enter') {
      e.preventDefault();
      input.blur();
    } else if (e.key === 'Escape') {
      e.preventDefault();
      input.value = '';
      input.blur();
    }
  });
  profileList?.addEventListener('focusout', (e) => {
    if (!e.target.classList?.contains('profile-list-new')) return;
    commitNewProfile();
  });

  panel.querySelector('.profile-action-delete')?.addEventListener('click', () => {
    const profiles = listProfiles();
    const current = profiles.find((p) => p.id === getActiveProfileId());
    const isLast = profiles.length <= 1;
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
        dismiss: true,
      }
    );
  });

  panel.querySelector('.profile-practice-exam')?.addEventListener('change', (e) => {
    setPracticeExamEnabled(Boolean(e.target.checked));
  });

  const importInput = panel.querySelector('.profile-import-file');
  panel.addEventListener('click', (e) => {
    if (e.target.closest('.profile-action-export')) {
      downloadProfileSnapshot();
      return;
    }
    if (e.target.closest('.profile-action-import')) importInput?.click();
  });
  importInput?.addEventListener('change', () => {
    const file = importInput.files && importInput.files[0];
    importInput.value = '';
    importProfileFile(file);
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
let ignoreUpdatesUntil = 0;
let isReloadingForSw = false;
let knownSwVersion = '';

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
  applyUiFitScale();
}

async function readSwCacheVersion() {
  const res = await fetch(new URL('sw.js', location.href), { cache: 'no-store' });
  if (!res.ok) return '';
  const text = await res.text();
  const m = text.match(/CACHE_VERSION\s*=\s*['"]([^'"]+)['"]/);
  return m ? m[1] : '';
}

async function setupAppUpdateChecks(registration) {
  ignoreUpdatesUntil = Math.max(ignoreUpdatesUntil, readIgnoreUpdatesUntil());
  if (registration) {
    if (registration.waiting) showUpdateBanner({ force: true });
    const pokeWorker = () => {
      if (document.hidden) return;
      if (registration.waiting) {
        showUpdateBanner({ force: true });
        return;
      }
      if (typeof registration.update === 'function') registration.update().catch(() => {});
    };
    pokeWorker();
    setInterval(pokeWorker, UPDATE_CHECK_INTERVAL_MS);
    return;
  }

  let lastVersionCheckAt = 0;
  const checkVersion = async () => {
    try {
      const ver = await readSwCacheVersion();
      if (!ver) return;
      if (!knownSwVersion) {
        knownSwVersion = ver;
        return;
      }
      if (ver !== knownSwVersion) showUpdateBanner({ force: true });
    } catch { /* no sw.js / offline */ }
  };
  const tick = () => {
    const banner = document.getElementById('update-banner');
    if (banner && !banner.hidden) return;
    const now = Date.now();
    if (now - lastVersionCheckAt < UPDATE_CHECK_INTERVAL_MS) return;
    lastVersionCheckAt = now;
    if (!navigator.onLine) return;
    return checkVersion();
  };
  try {
    knownSwVersion = (await readSwCacheVersion()) || knownSwVersion;
    lastVersionCheckAt = Date.now();
  } catch { /* no sw.js / offline */ }

  document.addEventListener('click', (event) => {
    const el = event.target.closest?.(
      '.btn-next, .btn-prev, .btn-exam-next, .quiz-back, .btn-back, [data-navigate], .category-card, .mode-btn, .btn-retry, .btn-confirm-end, .exam-film-start'
    );
    if (!el || el.disabled || el.getAttribute('aria-disabled') === 'true') return;
    void tick();
  }, true);
}

function reloadForUpdate() {
  if (isReloadingForSw) return;
  isReloadingForSw = true;
  location.reload();
}

async function applyAppUpdate(registration) {
  rememberRefreshIgnore();
  const banner = document.getElementById('update-banner');
  if (banner) banner.hidden = true;
  applyUiFitScale();
  try {
    let reg = registration;
    if (!reg && navigator.serviceWorker?.getRegistration) {
      reg = await navigator.serviceWorker.getRegistration().catch(() => null);
    }
    const waiting = reg?.waiting;
    if (waiting && navigator.serviceWorker?.addEventListener) {
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
    if (typeof caches !== 'undefined' && caches.keys) {
      const keys = await caches.keys();
      await Promise.all(keys.filter((key) => key.includes('-shell')).map((key) => caches.delete(key)));
    }
  } catch { /* still reload — LAN HTTP has no service worker */ }
  reloadForUpdate();
}

// ---- Init ----
async function init() {
  setupUiFitScale();
  const metaP = fetchMeta();
  await loadLocalConfig();
  await loadLearnLocalFlags();
  const spinner = document.getElementById('home-spinner');
  try {
    meta = await metaP;
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
        resumeOfflineDownloadIfNeeded();
      })
      .catch(() => {});
    if (spinner) spinner.classList.add('hidden');
  } catch {
    if (spinner) spinner.classList.add('hidden');
    document.getElementById('app').textContent = 'Failed to load app data. Please refresh.';
    document.documentElement.removeAttribute('data-ui-pending');
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
  watchSystemTheme();
  applyExamSkin(getInitialExamSkin());
  setupProfileSwitcher();
  themeBtn?.addEventListener('click', () => {
    const nextTheme = nextThemeChoice(getInitialTheme());
    applyTheme(nextTheme, themeIcon, themeBtn);
    try { profileSet('prawko_theme', nextTheme); } catch {}
  });
  document.querySelector('.skin-btn')?.addEventListener('click', () => {
    const current = normalizeExamSkin(document.documentElement.getAttribute('data-exam-skin'));
    const next = current === 'panel' ? 'station' : 'panel';
    applyExamSkin(next);
    try { profileSet(EXAM_SKIN_KEY, next); } catch {}
  });

  // Language toggle
  const savedLang = getLang();
  setLang(savedLang);
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
    refitUiScale();
    fillProfilePanel();
    applyTheme(getInitialTheme(), themeIcon, themeBtn);
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
  document.addEventListener('prawko-offline-download', (e) => {
    const categoryId = e.detail?.categoryId;
    if (!categoryId) return;
    pendingOfflineDownload = categoryId;
    navigate('categories');
  });

  document.querySelector('.category-grid').addEventListener('click', (e) => {
    const dlBtn = e.target.closest('.offline-btn');
    if (!dlBtn) return;
    e.stopPropagation();
    e.preventDefault();
    startOfflineDownload(dlBtn);
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

  // Register service worker (missing on insecure LAN HTTP)
  let swRegistration = null;
  const sw = navigator.serviceWorker;
  const hadController = Boolean(sw?.controller);
  if (sw?.register) {
    swRegistration = await sw.register('sw.js', { updateViaCache: 'none' }).catch(err => {
      console.warn('SW registration failed:', err);
      return null;
    });
    if (swRegistration?.waiting) showUpdateBanner({ force: true });
    swRegistration?.addEventListener('updatefound', () => {
      const candidate = swRegistration.installing;
      if (!candidate) return;
      candidate.addEventListener('statechange', () => {
        if (candidate.state === 'installed' && sw.controller) {
          showUpdateBanner({ force: true });
        }
      });
    });

    sw.addEventListener('message', (event) => {
      if (event.data?.type === 'APP_UPDATED' || event.data?.type === 'DATA_UPDATED') {
        showUpdateBanner();
      }
    });
    // First visit: page already has current files; clients.claim() must not reload.
    // Later visits already have a controller — a new worker taking over still reloads.
    sw.addEventListener('controllerchange', () => {
      if (!hadController) return;
      reloadForUpdate();
    });
  }
  await setupAppUpdateChecks(swRegistration);

  // Update banner reload
  document.getElementById('update-banner-btn')?.addEventListener('click', () => {
    applyAppUpdate(swRegistration);
  });

  const offlineBanner = document.getElementById('offline-banner');
  function updateOnlineStatus() {
    if (offlineBanner) offlineBanner.hidden = navigator.onLine;
    if (meta) {
      renderCategories(meta, getDownloadedCategories());
      syncCategoryCardVisibility();
      renderRecentCategories();
      applyCategorySearch();
    }
    applyUiFitScale();
  }
  window.addEventListener('online', updateOnlineStatus);
  window.addEventListener('offline', updateOnlineStatus);
  updateOnlineStatus();
  await revealUiScale();

  // Preload category data on hover
  document.querySelectorAll('.category-card').forEach(card => {
    card.addEventListener('mouseenter', () => {
      fetchCategory(card.dataset.category).catch(() => {});
    }, { once: true });
  });
}

document.addEventListener('DOMContentLoaded', init);
