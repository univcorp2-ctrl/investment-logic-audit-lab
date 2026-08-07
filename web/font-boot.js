const FONT_SCALE_KEY = 'valuescope-font-scale-v1';
const DISPLAY_KEY = 'valuescope-display-preferences-v1';
const BUNDLE_KEY = 'valuescope-parameter-bundle-v1';

function parseJson(value) {
  try { return JSON.parse(value ?? 'null'); } catch { return null; }
}

function normalizeFontScale(value) {
  if (value === 'standard') return 'normal';
  return ['normal', 'large', 'xlarge'].includes(value) ? value : 'normal';
}

function normalizeDensity(value) {
  return ['comfortable', 'compact'].includes(value) ? value : 'comfortable';
}

function normalizeContrast(value) {
  return ['normal', 'high'].includes(value) ? value : 'normal';
}

export function loadBootDisplayPreferences(storage = localStorage) {
  const bundle = parseJson(storage.getItem(BUNDLE_KEY));
  const standalone = parseJson(storage.getItem(DISPLAY_KEY));
  const legacyFontScale = storage.getItem(FONT_SCALE_KEY);
  const display = { ...(bundle?.display ?? {}), ...(standalone ?? {}) };
  if (legacyFontScale) display.fontScale = legacyFontScale;
  return {
    fontScale: normalizeFontScale(display.fontScale),
    density: normalizeDensity(display.density),
    contrast: normalizeContrast(display.contrast),
    reducedMotion: Boolean(display.reducedMotion),
  };
}

export function applyBootDisplayPreferences(preferences = loadBootDisplayPreferences()) {
  const root = document.documentElement;
  root.dataset.fontScale = normalizeFontScale(preferences.fontScale);
  root.dataset.displayDensity = normalizeDensity(preferences.density);
  root.dataset.displayContrast = normalizeContrast(preferences.contrast);
  root.dataset.reduceMotion = String(Boolean(preferences.reducedMotion));
  return preferences;
}

applyBootDisplayPreferences();
