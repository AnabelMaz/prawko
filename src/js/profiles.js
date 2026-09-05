// profiles.js — Local named profiles so progress can start fresh without wiping another user

const REGISTRY_KEY = 'prawko_profiles';
const LEGACY_KEYS = [
  'prawko_stats',
  'prawko_learn',
  'prawko_learn_queue_mode',
  'prawko_recent_categories',
];
export const PROFILE_LIMIT = 8;
export const DEFAULT_PROFILE_ID = 'p1';
export const DEFAULT_PROFILE_NAME = 'Ja';
const NAME_MAX = 20;
const ME_ALIASES = ['ja', 'me'];
const NEW_ALIASES = ['nowy', 'new'];

function parseCopyIndex(name) {
  const raw = String(name || '').trim();
  const copy = raw.match(/^(.*) \((\d+)\)$/);
  if (copy) return { base: copy[1], index: Number(copy[2]) };
  return { base: raw, index: 1 };
}

function normalizeBase(base) {
  const lower = String(base || '').toLowerCase();
  if (ME_ALIASES.includes(lower)) return '__me__';
  if (NEW_ALIASES.includes(lower)) return '__new__';
  return lower;
}

export function formatProfileName(stored, translate) {
  const parsed = parseCopyIndex(stored);
  const lower = parsed.base.toLowerCase();
  let label = null;
  if (ME_ALIASES.includes(lower)) label = translate('profileDefaultMe');
  else if (NEW_ALIASES.includes(lower)) label = translate('profileDefaultNew');
  if (label) return parsed.index > 1 ? `${label} (${parsed.index})` : label;
  return stored;
}

export function uniqueProfileName(desired, existingNames) {
  const requested = String(desired || '').trim().slice(0, NAME_MAX) || 'Profil';
  const { base } = parseCopyIndex(requested);
  const key = normalizeBase(base);
  const used = new Set();
  existingNames.forEach((n) => {
    const parsed = parseCopyIndex(n);
    if (normalizeBase(parsed.base) === key) used.add(parsed.index);
  });
  if (!used.has(1)) return requested;
  let n = 2;
  while (used.has(n)) n += 1;
  const suffix = ` (${n})`;
  const trimmed = base.slice(0, Math.max(1, NAME_MAX - suffix.length));
  return `${trimmed}${suffix}`;
}

let migrated = false;

function readJson(key, fallback) {
  try {
    const parsed = JSON.parse(localStorage.getItem(key));
    return parsed == null ? fallback : parsed;
  } catch {
    return fallback;
  }
}

function writeJson(key, value) {
  try {
    localStorage.setItem(key, JSON.stringify(value));
    return true;
  } catch {
    return false;
  }
}

function defaultRegistry() {
  return {
    activeId: DEFAULT_PROFILE_ID,
    profiles: [{ id: DEFAULT_PROFILE_ID, name: DEFAULT_PROFILE_NAME, createdAt: Date.now() }],
  };
}

function wipeProfileKeys(profileId) {
  const prefix = `prawko_p_${profileId}_`;
  const doomed = [];
  for (let i = 0; i < localStorage.length; i++) {
    const key = localStorage.key(i);
    if (key && key.startsWith(prefix)) doomed.push(key);
  }
  doomed.forEach((key) => {
    try { localStorage.removeItem(key); } catch {}
  });
}

function normalizeRegistry(raw) {
  if (!raw || typeof raw !== 'object' || !Array.isArray(raw.profiles) || !raw.profiles.length) {
    return defaultRegistry();
  }
  const profiles = raw.profiles
    .filter((p) => p && typeof p.id === 'string' && typeof p.name === 'string')
    .map((p) => ({
      id: p.id,
      name: p.name.slice(0, 20),
      createdAt: Number.isFinite(p.createdAt) ? p.createdAt : Date.now(),
    }));
  if (!profiles.length) return defaultRegistry();
  const activeId = profiles.some((p) => p.id === raw.activeId) ? raw.activeId : profiles[0].id;
  return { activeId, profiles };
}

function profileStorageKeyFor(profileId, legacyKey) {
  const short = String(legacyKey).replace(/^prawko_/, '');
  return `prawko_p_${profileId}_${short}`;
}

function migrateLegacyKeys(profileId) {
  LEGACY_KEYS.forEach((key) => {
    const raw = localStorage.getItem(key);
    if (raw == null) return;
    const nextKey = profileStorageKeyFor(profileId, key);
    if (localStorage.getItem(nextKey) == null) {
      try { localStorage.setItem(nextKey, raw); } catch {}
    }
    try { localStorage.removeItem(key); } catch {}
  });
}

function ensureMigrated() {
  if (migrated) return;
  migrated = true;
  const hadRegistry = localStorage.getItem(REGISTRY_KEY) != null;
  const registry = normalizeRegistry(readJson(REGISTRY_KEY, null));
  if (!hadRegistry) migrateLegacyKeys(registry.activeId);
  writeJson(REGISTRY_KEY, registry);
}

function loadRegistry() {
  ensureMigrated();
  return normalizeRegistry(readJson(REGISTRY_KEY, null));
}

function saveRegistry(registry) {
  writeJson(REGISTRY_KEY, registry);
}

export function getActiveProfileId() {
  return loadRegistry().activeId;
}

export function listProfiles() {
  return loadRegistry().profiles;
}

export function profileStorageKey(legacyKey) {
  return profileStorageKeyFor(getActiveProfileId(), legacyKey);
}

export function profileGet(legacyKey) {
  try {
    return localStorage.getItem(profileStorageKey(legacyKey));
  } catch {
    return null;
  }
}

export function profileSet(legacyKey, value) {
  try {
    localStorage.setItem(profileStorageKey(legacyKey), value);
    return true;
  } catch {
    return false;
  }
}

export function profileRemove(legacyKey) {
  try {
    localStorage.removeItem(profileStorageKey(legacyKey));
  } catch {}
}

const PRACTICE_EXAM_KEY = 'prawko_practice_exam';

export function getPracticeExamEnabled() {
  return profileGet(PRACTICE_EXAM_KEY) === '1';
}

export function setPracticeExamEnabled(enabled) {
  return profileSet(PRACTICE_EXAM_KEY, enabled ? '1' : '0');
}

export function setActiveProfile(id) {
  const registry = loadRegistry();
  if (!registry.profiles.some((p) => p.id === id)) return false;
  registry.activeId = id;
  saveRegistry(registry);
  return true;
}

export function createProfile(name) {
  const registry = loadRegistry();
  if (registry.profiles.length >= PROFILE_LIMIT) return null;
  const id = `p${Date.now().toString(36)}`;
  const requested = String(name || '').trim().slice(0, NAME_MAX);
  const clean = uniqueProfileName(
    requested,
    registry.profiles.map((p) => p.name),
  );
  registry.profiles.push({ id, name: clean, createdAt: Date.now() });
  registry.activeId = id;
  saveRegistry(registry);
  return id;
}

export function renameProfile(id, name) {
  const requested = String(name || '').trim().slice(0, NAME_MAX);
  if (!requested) return false;
  const registry = loadRegistry();
  const profile = registry.profiles.find((p) => p.id === id);
  if (!profile) return false;
  const others = registry.profiles.filter((p) => p.id !== id).map((p) => p.name);
  profile.name = uniqueProfileName(requested, others);
  saveRegistry(registry);
  return true;
}

export function deleteProfile(id) {
  const registry = loadRegistry();
  if (!registry.profiles.some((p) => p.id === id)) return false;

  wipeProfileKeys(id);

  if (registry.profiles.length <= 1) {
    if (id !== DEFAULT_PROFILE_ID) wipeProfileKeys(DEFAULT_PROFILE_ID);
    saveRegistry(defaultRegistry());
    return true;
  }

  registry.profiles = registry.profiles.filter((p) => p.id !== id);
  if (registry.activeId === id) {
    registry.activeId = registry.profiles[0].id;
  }
  saveRegistry(registry);
  return true;
}
