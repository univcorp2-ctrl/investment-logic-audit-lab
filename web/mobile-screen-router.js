import {
  mobileTargetToScreen,
  normalizePerformancePanel,
  parsePhoneRoute,
  phoneRouteHash,
  screenSelectorMap,
} from './mobile-screen-router-core.js';

const PHONE_QUERY = '(max-width: 767px)';
const phoneMedia = window.matchMedia(PHONE_QUERY);
let currentScreen = 'overview';
let currentPanel = 'current';
let observer = null;

const $ = selector => document.querySelector(selector);

function directMainChild(node) {
  const main = $('main');
  if (!main || !node) return null;
  let cursor = node;
  while (cursor && cursor.parentElement !== main) cursor = cursor.parentElement;
  return cursor?.parentElement === main ? cursor : null;
}

function tagScreenRoots() {
  const main = $('main');
  if (!main) return;
  const map = screenSelectorMap();
  for (const [screen, selectors] of Object.entries(map)) {
    for (const selector of selectors) {
      document.querySelectorAll(selector).forEach(node => {
        const root = directMainChild(node);
        if (root) root.dataset.phoneScreen = screen;
      });
    }
  }
  [...main.children].forEach(child => {
    if (!child.dataset.phoneScreen && !child.matches('script')) child.dataset.phoneScreen = 'data';
  });
  const report = $('#investmentDecisionReport');
  const reportRoot = directMainChild(report);
  if (reportRoot) reportRoot.dataset.phoneScreen = currentScreen === 'data' ? 'data' : 'decision';
  ensurePerformanceNavigation();
  tagPerformancePanels();
}

function ensureBackButton() {
  const header = $('#adaptiveMobileHeader');
  if (!header || $('#mobileScreenBack')) return;
  const button = document.createElement('button');
  button.id = 'mobileScreenBack';
  button.type = 'button';
  button.className = 'mobile-screen-back';
  button.setAttribute('aria-label', '前の画面へ戻る');
  button.textContent = '戻る';
  button.addEventListener('click', () => {
    const depth = Number(history.state?.valuescopeRouteDepth ?? 0);
    if (depth > 0) history.back();
    else activateRoute('overview', 'current', { historyMode:'replace' });
  });
  header.prepend(button);
}

function ensurePerformanceNavigation() {
  if ($('#mobilePerformanceSubnav')) return;
  const anchor = $('#performanceSection') ?? $('#performanceAnalytics');
  if (!anchor) return;
  const nav = document.createElement('nav');
  nav.id = 'mobilePerformanceSubnav';
  nav.className = 'mobile-performance-subnav';
  nav.setAttribute('aria-label', '損益・リスク内の画面');
  const labels = { current:'現在', holdings:'保有', chart:'グラフ', risk:'リスク', metrics:'指標' };
  for (const [key, label] of Object.entries(labels)) {
    const button = document.createElement('button');
    button.type = 'button';
    button.dataset.performancePanel = key;
    button.textContent = label;
    button.addEventListener('click', () => activateRoute('performance', key, { historyMode:'push' }));
    nav.append(button);
  }
  anchor.after(nav);
  nav.dataset.phoneScreen = 'performance';
}

function tagPerformancePanels() {
  const analytics = $('#performanceAnalytics');
  if (analytics) {
    analytics.querySelectorAll(':scope > *').forEach(child => {
      if (child.matches('.pa-controls,.pa-chart-panel,#paDateRange')) child.dataset.phonePerformancePanel = 'chart';
      else if (child.matches('#paMetricGroups,.pa-metric-groups,.pa-dd-detail,.pa-definitions')) child.dataset.phonePerformancePanel = 'metrics';
      else child.dataset.phonePerformancePanel = 'current';
    });
  }
  $('#demoTrade')?.setAttribute('data-phone-performance-root', 'holdings');
  $('#riskDiagnostics')?.setAttribute('data-phone-performance-root', 'risk');
  $('#performanceAnalytics')?.setAttribute('data-phone-performance-root', 'analytics');
}

function setActiveNavigation() {
  document.querySelectorAll('#adaptiveMobileNav [data-adaptive-target]').forEach(button => {
    const active = mobileTargetToScreen(button.dataset.adaptiveTarget) === currentScreen;
    button.classList.toggle('active', active);
    if (active) button.setAttribute('aria-current', 'page');
    else button.removeAttribute('aria-current');
  });
  document.querySelectorAll('#mobilePerformanceSubnav [data-performance-panel]').forEach(button => {
    const active = button.dataset.performancePanel === currentPanel;
    button.classList.toggle('active', active);
    button.setAttribute('aria-current', active ? 'page' : 'false');
  });
}

function applyVisibility() {
  if (!phoneMedia.matches) {
    document.documentElement.removeAttribute('data-phone-routing');
    document.body.removeAttribute('data-phone-screen');
    document.body.removeAttribute('data-phone-performance-panel');
    document.querySelectorAll('[data-phone-screen-active]').forEach(node => node.removeAttribute('data-phone-screen-active'));
    return;
  }
  document.documentElement.dataset.phoneRouting = 'true';
  document.body.dataset.phoneScreen = currentScreen;
  document.body.dataset.phonePerformancePanel = currentPanel;
  tagScreenRoots();
  document.querySelectorAll('main > [data-phone-screen]').forEach(node => {
    node.dataset.phoneScreenActive = String(node.dataset.phoneScreen === currentScreen);
    if ('inert' in node) node.inert = node.dataset.phoneScreen !== currentScreen;
  });
  const back = $('#mobileScreenBack');
  if (back) back.hidden = currentScreen === 'overview';
  setActiveNavigation();
  window.scrollTo({ top:0, behavior:'auto' });
}

function activateDecisionContext() {
  if (currentScreen !== 'decision' && currentScreen !== 'data') return;
  const tab = currentScreen === 'data' ? 'plan' : 'judge';
  document.querySelector(`.dr-tabs [data-tab="${tab}"]`)?.click();
}

function activateRoute(screen, panel = 'current', options = {}) {
  currentScreen = mobileTargetToScreen(screen);
  currentPanel = currentScreen === 'performance' ? normalizePerformancePanel(panel) : 'current';
  const hash = phoneRouteHash(currentScreen, currentPanel, location.hash);
  if (options.historyMode === 'push') {
    const depth = Number(history.state?.valuescopeRouteDepth ?? 0) + 1;
    history.pushState({ valuescopeRouteDepth:depth, screen:currentScreen, panel:currentPanel }, '', hash);
  } else if (options.historyMode === 'replace') {
    const depth = Number(history.state?.valuescopeRouteDepth ?? 0);
    history.replaceState({ valuescopeRouteDepth:depth, screen:currentScreen, panel:currentPanel }, '', hash);
  }
  activateDecisionContext();
  applyVisibility();
}

function interceptMobileNavigation(event) {
  if (!phoneMedia.matches) return;
  const button = event.target.closest('#adaptiveMobileNav [data-adaptive-target]');
  if (!button) return;
  event.preventDefault();
  event.stopImmediatePropagation();
  activateRoute(mobileTargetToScreen(button.dataset.adaptiveTarget), 'current', { historyMode:'push' });
}

function restoreFromLocation() {
  const route = parsePhoneRoute(location.hash);
  currentScreen = route.screen;
  currentPanel = route.panel;
  activateDecisionContext();
  applyVisibility();
}

function installObserver() {
  if (observer) return;
  observer = new MutationObserver(() => {
    tagScreenRoots();
    if (phoneMedia.matches) applyVisibility();
  });
  observer.observe(document.documentElement, { childList:true, subtree:true });
  window.setTimeout(() => observer?.disconnect(), 30000);
}

function init() {
  ensureBackButton();
  tagScreenRoots();
  const route = parsePhoneRoute(location.hash);
  currentScreen = route.screen;
  currentPanel = route.panel;
  if (!location.hash.includes('screen=')) activateRoute(currentScreen, currentPanel, { historyMode:'replace' });
  else applyVisibility();
  installObserver();
  document.addEventListener('click', interceptMobileNavigation, true);
  window.addEventListener('popstate', restoreFromLocation);
  window.addEventListener('hashchange', restoreFromLocation);
  phoneMedia.addEventListener('change', applyVisibility);
  window.addEventListener('orientationchange', () => requestAnimationFrame(applyVisibility));
}

if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init, { once:true });
else init();

window.ValueScopeMobileRouter = Object.freeze({
  open: (screen, panel = 'current') => activateRoute(screen, panel, { historyMode:'push' }),
  back: () => $('#mobileScreenBack')?.click(),
  current: () => ({ screen:currentScreen, panel:currentPanel }),
});
