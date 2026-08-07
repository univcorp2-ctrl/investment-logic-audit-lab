export const UX_VIEWS = Object.freeze(['overview','decision','screening','analytics','data']);

export function viewportMode(width) {
  const value = Number(width);
  if (!Number.isFinite(value) || value < 0) return 'desktop';
  if (value <= 767) return 'phone';
  if (value <= 1180) return 'tablet';
  return 'desktop';
}

export function normalizeView(value) {
  return UX_VIEWS.includes(value) ? value : 'overview';
}

export function viewForSelector(selector) {
  const value = String(selector ?? '');
  if (/parameterControlCenter|screeningLab|ranking|filters|own-data/.test(value)) return 'screening';
  if (/performanceAnalytics|riskDiagnostics|demoTrade/.test(value)) return 'analytics';
  if (/investmentDecisionReport/.test(value)) return 'decision';
  if (/methodology|jquants|plan/.test(value)) return 'data';
  return 'overview';
}

export function parseShellHash(hash) {
  const raw = String(hash ?? '').replace(/^#/, '');
  if (!raw) return { view:'overview', params:new URLSearchParams() };
  if (!raw.includes('=') && raw) return { view:viewForSelector(raw), params:new URLSearchParams() };
  const params = new URLSearchParams(raw);
  return { view:normalizeView(params.get('view')), params };
}

export function shellHash(view, hash = '') {
  const parsed = parseShellHash(hash);
  parsed.params.set('view', normalizeView(view));
  return `#${parsed.params.toString()}`;
}

export function densityForMode(mode, requested = 'comfortable') {
  if (mode === 'phone') return 'comfortable';
  return requested === 'compact' ? 'compact' : 'comfortable';
}

export function sectionViewMap() {
  return Object.freeze({
    '.hero':'overview',
    '#dataError':'overview',
    '#dataNotice':'overview',
    '.summary-grid':'overview',
    '.visual-grid':'overview',
    '#investmentDecisionReport':'decision',
    '#parameterControlCenter':'screening',
    '#screeningLab':'screening',
    '.filters':'screening',
    '.ranking':'screening',
    '.own-data':'screening',
    '#performanceAnalytics':'analytics',
    '#riskDiagnostics':'analytics',
    '#demoTrade':'analytics',
    '.methodology':'data',
    'main > .alert.warning':'data',
  });
}
