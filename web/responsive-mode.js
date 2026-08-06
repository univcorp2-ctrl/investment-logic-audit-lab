const MOBILE_QUERY = '(max-width: 767px)';
const media = window.matchMedia(MOBILE_QUERY);

function targetFor(name) {
  return ({
    overview: '#top',
    decision: '#investmentDecisionReport',
    screening: '#screeningLab',
    performance: '#performanceAnalytics',
    plans: '#investmentDecisionReport',
  })[name] ?? '#top';
}

function activateDecisionTab(tabName) {
  const button = document.querySelector(`.dr-tabs [data-tab="${tabName}"]`);
  if (button instanceof HTMLButtonElement) button.click();
}

function updateMode() {
  const mobile = media.matches;
  document.documentElement.dataset.viewport = mobile ? 'mobile' : 'desktop';
  const label = document.querySelector('#viewportMode');
  if (label) label.textContent = mobile ? 'iPhone表示' : 'PC表示';
}

function installModeIndicator() {
  if (document.querySelector('#viewportMode')) return;
  const indicator = document.createElement('span');
  indicator.id = 'viewportMode';
  indicator.className = 'viewport-mode';
  indicator.setAttribute('aria-live', 'polite');
  const headerActions = document.querySelector('.header-actions');
  if (headerActions) headerActions.prepend(indicator);
}

function installMobileNavigation() {
  if (document.querySelector('#mobileNavigation')) return;
  const nav = document.createElement('nav');
  nav.id = 'mobileNavigation';
  nav.className = 'mobile-navigation';
  nav.setAttribute('aria-label', 'モバイル主要ナビゲーション');
  nav.innerHTML = `
    <button type="button" data-target="overview"><span aria-hidden="true">⌂</span><b>概要</b></button>
    <button type="button" data-target="decision"><span aria-hidden="true">◎</span><b>判断</b></button>
    <button type="button" data-target="screening"><span aria-hidden="true">⌕</span><b>条件</b></button>
    <button type="button" data-target="performance"><span aria-hidden="true">↗</span><b>損益</b></button>
    <button type="button" data-target="plans"><span aria-hidden="true">▦</span><b>プラン</b></button>`;
  nav.addEventListener('click', event => {
    const button = event.target.closest('button[data-target]');
    if (!button) return;
    const name = button.dataset.target;
    if (name === 'plans') activateDecisionTab('plan');
    if (name === 'decision') activateDecisionTab('judge');
    const selector = targetFor(name);
    document.querySelector(selector)?.scrollIntoView({ behavior: media.matches ? 'smooth' : 'auto', block: 'start' });
    nav.querySelectorAll('button').forEach(item => item.classList.toggle('active', item === button));
  });
  document.body.append(nav);
}

function convertRankingRows() {
  const body = document.querySelector('#rankingBody');
  if (!body || body.dataset.mobileLabels === 'ready') return;
  const labels = ['順位','銘柄','市場・業種','株価','総合','割安','品質','テクニカル','流動性','Trap','充足率','判定'];
  const apply = () => {
    body.querySelectorAll('tr').forEach(row => {
      [...row.children].forEach((cell, index) => { cell.dataset.label = labels[index] ?? ''; });
    });
  };
  apply();
  new MutationObserver(apply).observe(body, { childList: true, subtree: true });
  body.dataset.mobileLabels = 'ready';
}

function init() {
  installModeIndicator();
  installMobileNavigation();
  convertRankingRows();
  updateMode();
  media.addEventListener('change', updateMode);
  window.addEventListener('orientationchange', () => requestAnimationFrame(updateMode));
}

if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init);
else init();
