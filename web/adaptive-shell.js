const IPHONE_QUERY = '(max-width: 767px)';
const iphoneMedia = window.matchMedia(IPHONE_QUERY);
const state = { initialized: false, observer: null, overviewLoaded: false };

const SECTION_MAP = Object.freeze({
  overview: { id: 'overviewSection', label: '概要' },
  decision: { id: 'decisionSection', label: '投資判断', tab: 'judge' },
  screening: { id: 'screeningSection', label: '条件設定' },
  performance: { id: 'performanceSection', label: '損益・リスク' },
  strategy: { id: 'strategySection', label: '戦略検証', tab: 'strategy' },
  data: { id: 'dataPlanSection', label: 'データ・プラン', tab: 'plan' },
});

const MOBILE_NAV = Object.freeze([
  ['overview', '概要', '⌂'],
  ['decision', '判断', '◎'],
  ['screening', '条件', '⌕'],
  ['performance', '損益', '↗'],
  ['data', 'その他', '⋯'],
]);

const LARGE_NAV = Object.freeze([
  ['overview', '概要'],
  ['decision', '投資判断'],
  ['screening', '条件設定'],
  ['performance', '損益・リスク'],
  ['strategy', '戦略検証'],
  ['data', 'データ・プラン'],
]);

const numberOrNull = value => {
  if (value === null || value === undefined || value === '') return null;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
};
const money = value => numberOrNull(value) === null ? '–' : new Intl.NumberFormat('ja-JP', {
  style: 'currency', currency: 'JPY', maximumFractionDigits: 0,
}).format(Number(value));
const percent = (value, digits = 2) => numberOrNull(value) === null ? '–' : `${Number(value) >= 0 ? '+' : ''}${Number(value).toFixed(digits)}%`;
const dateTime = value => {
  if (!value) return '–';
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? String(value) : new Intl.DateTimeFormat('ja-JP', {
    timeZone: 'Asia/Tokyo', month: 'numeric', day: 'numeric', hour: '2-digit', minute: '2-digit',
  }).format(date);
};
const escapeHtml = value => String(value ?? '').replace(/[&<>'"]/g, character => ({
  '&':'&amp;','<':'&lt;','>':'&gt;',"'":'&#39;','"':'&quot;',
})[character]);

function deviceMode() {
  return iphoneMedia.matches ? 'iphone' : 'large';
}

function updateDeviceMode() {
  const mode = deviceMode();
  document.documentElement.dataset.deviceMode = mode;
  const indicator = document.querySelector('#adaptiveModeIndicator');
  if (indicator) indicator.textContent = mode === 'iphone' ? 'iPhone表示' : 'PC / iPad表示';
  const mobileUpdated = document.querySelector('#adaptiveMobileUpdated');
  const source = document.querySelector('#adaptiveOverviewUpdated');
  if (mobileUpdated && source) mobileUpdated.textContent = source.textContent;
  configureDisclosures(mode);
}

function installSkipLink() {
  if (document.querySelector('.adaptive-skip-link')) return;
  const link = document.createElement('a');
  link.className = 'adaptive-skip-link';
  link.href = '#overviewSection';
  link.textContent = '本文へ移動';
  document.body.prepend(link);
}

function installHeaderModeIndicator() {
  if (document.querySelector('#adaptiveModeIndicator')) return;
  const indicator = document.createElement('span');
  indicator.id = 'adaptiveModeIndicator';
  indicator.className = 'adaptive-mode-indicator';
  indicator.setAttribute('aria-live', 'polite');
  document.querySelector('.header-actions')?.prepend(indicator);
}

function navButton(key, label, icon = '') {
  const button = document.createElement('button');
  button.type = 'button';
  button.dataset.adaptiveTarget = key;
  button.innerHTML = icon ? `<span aria-hidden="true">${icon}</span><b>${label}</b>` : label;
  button.addEventListener('click', () => navigateTo(key));
  return button;
}

function installNavigation() {
  if (!document.querySelector('#adaptiveLargeNav')) {
    const nav = document.createElement('nav');
    nav.id = 'adaptiveLargeNav';
    nav.className = 'adaptive-large-nav';
    nav.setAttribute('aria-label', '主要セクション');
    const inner = document.createElement('div');
    inner.className = 'adaptive-large-nav-inner';
    LARGE_NAV.forEach(([key, label]) => inner.append(navButton(key, label)));
    nav.append(inner);
    document.querySelector('.header')?.after(nav);
  }
  if (!document.querySelector('#adaptiveMobileNav')) {
    const nav = document.createElement('nav');
    nav.id = 'adaptiveMobileNav';
    nav.className = 'adaptive-mobile-nav';
    nav.setAttribute('aria-label', 'iPhone主要ナビゲーション');
    MOBILE_NAV.forEach(([key, label, icon]) => nav.append(navButton(key, label, icon)));
    document.body.append(nav);
  }
  if (!document.querySelector('#adaptiveMobileHeader')) {
    const header = document.createElement('div');
    header.id = 'adaptiveMobileHeader';
    header.className = 'adaptive-mobile-header';
    header.innerHTML = `<div><strong>ValueScope Japan</strong><small id="adaptiveMobileUpdated">更新 –</small></div><span>iPhone表示</span>`;
    document.body.prepend(header);
  }
}

function anchorBefore(target, id) {
  if (!target || document.querySelector(`#${id}`)) return;
  const anchor = document.createElement('span');
  anchor.id = id;
  anchor.className = 'adaptive-section-anchor';
  anchor.setAttribute('aria-hidden', 'true');
  target.before(anchor);
}

function ensureSectionAnchors() {
  const decision = document.querySelector('#investmentDecisionReport');
  const screening = document.querySelector('#screeningLab');
  const performance = document.querySelector('#performanceAnalytics');
  anchorBefore(decision, 'decisionSection');
  anchorBefore(screening, 'screeningSection');
  anchorBefore(performance, 'performanceSection');
  anchorBefore(decision, 'strategySection');
  anchorBefore(decision, 'dataPlanSection');
  applyContentOrder();
  markTables();
  groupLegacyAnalysis();
}

function setOrder(element, order) {
  if (!element) return;
  element.classList.add('adaptive-ordered');
  element.style.setProperty('--adaptive-order', String(order));
}

function applyContentOrder() {
  setOrder(document.querySelector('#overviewSection'), 10);
  setOrder(document.querySelector('#dataError'), 11);
  setOrder(document.querySelector('#dataNotice'), 12);
  setOrder(document.querySelector('#decisionSection'), 19);
  setOrder(document.querySelector('#strategySection'), 19);
  setOrder(document.querySelector('#dataPlanSection'), 19);
  setOrder(document.querySelector('#investmentDecisionReport'), 20);
  setOrder(document.querySelector('#screeningSection'), 29);
  setOrder(document.querySelector('#screeningLab'), 30);
  setOrder(document.querySelector('#performanceSection'), 39);
  setOrder(document.querySelector('#performanceAnalytics'), 40);
  setOrder(document.querySelector('#riskDiagnostics'), 45);
  setOrder(document.querySelector('#demoTrade'), 50);
  setOrder(document.querySelector('.ranking'), 60);
  setOrder(document.querySelector('#adaptiveLegacyDetails'), 80);
}

function groupLegacyAnalysis() {
  const main = document.querySelector('main');
  if (!main || document.querySelector('#adaptiveLegacyDetails')) return;
  const movable = [
    main.querySelector(':scope > .visual-grid'),
    main.querySelector(':scope > .filters'),
    main.querySelector(':scope > .own-data'),
    main.querySelector(':scope > .methodology'),
  ].filter(Boolean);
  if (!movable.length) return;
  const details = document.createElement('details');
  details.id = 'adaptiveLegacyDetails';
  details.className = 'adaptive-legacy-details';
  details.innerHTML = '<summary>詳細ランキング設定と補助分析</summary><div class="adaptive-legacy-content"></div>';
  const content = details.querySelector('.adaptive-legacy-content');
  movable.forEach(node => content.append(node));
  main.append(details);
  setOrder(details, 80);
}

function tableHeaders(table) {
  return [...table.querySelectorAll('thead th')].map(cell => cell.textContent.trim());
}

function addMobileDetails(row, cells, labels) {
  if (cells.length <= 5 || row.querySelector('.adaptive-row-more')) return;
  const secondary = cells.slice(4);
  secondary.forEach(cell => cell.classList.add('adaptive-secondary-cell'));
  const moreCell = document.createElement('td');
  moreCell.className = 'adaptive-row-more';
  moreCell.colSpan = cells.length;
  const details = document.createElement('details');
  details.innerHTML = `<summary>詳細を見る</summary><dl>${secondary.map((cell, index) => `<div><dt>${escapeHtml(labels[index + 4] ?? '')}</dt><dd>${escapeHtml(cell.textContent.trim())}</dd></div>`).join('')}</dl>`;
  details.addEventListener('click', event => event.stopPropagation());
  moreCell.append(details);
  row.append(moreCell);
}

function labelTable(table) {
  if (table.dataset.adaptiveTable === 'ready') return;
  table.dataset.adaptiveTable = 'ready';
  const apply = () => {
    const labels = tableHeaders(table);
    table.querySelectorAll('tbody tr').forEach(row => {
      const cells = [...row.children].filter(cell => !cell.classList.contains('adaptive-row-more'));
      cells.forEach((cell, index) => { cell.dataset.label = labels[index] ?? ''; });
      addMobileDetails(row, cells, labels);
    });
  };
  apply();
  new MutationObserver(apply).observe(table.querySelector('tbody') ?? table, { childList: true, subtree: true });
}

function markTables() {
  document.querySelectorAll('main table').forEach(labelTable);
}

function activateDecisionTab(tab) {
  const button = document.querySelector(`.dr-tabs [data-tab="${tab}"]`);
  if (button instanceof HTMLButtonElement) button.click();
}

function navigateTo(key) {
  const config = SECTION_MAP[key] ?? SECTION_MAP.overview;
  if (config.tab) activateDecisionTab(config.tab);
  const target = document.querySelector(`#${config.id}`);
  target?.scrollIntoView({ behavior: window.matchMedia('(prefers-reduced-motion: reduce)').matches ? 'auto' : 'smooth', block: 'start' });
  updateActiveNavigation(key);
}

function updateActiveNavigation(key) {
  document.querySelectorAll('[data-adaptive-target]').forEach(button => {
    const active = button.dataset.adaptiveTarget === key;
    button.classList.toggle('active', active);
    if (active) button.setAttribute('aria-current', 'page');
    else button.removeAttribute('aria-current');
  });
}

function installSectionObserver() {
  if (!('IntersectionObserver' in window)) return;
  const observer = new IntersectionObserver(entries => {
    const visible = entries.filter(entry => entry.isIntersecting).sort((a, b) => b.intersectionRatio - a.intersectionRatio)[0];
    if (!visible) return;
    const key = Object.entries(SECTION_MAP).find(([, config]) => config.id === visible.target.id)?.[0];
    if (key) updateActiveNavigation(key);
  }, { rootMargin: '-25% 0px -65% 0px', threshold: [0.05, 0.2, 0.5] });
  Object.values(SECTION_MAP).forEach(config => {
    const element = document.querySelector(`#${config.id}`);
    if (element) observer.observe(element);
  });
}

function configureDisclosures(mode) {
  if (mode !== 'iphone') return;
  document.querySelectorAll('.sl-controls details, .pa-metric-group, .pa-definitions, .adaptive-legacy-details').forEach((details, index) => {
    if (details instanceof HTMLDetailsElement) details.open = index === 0 && details.closest('.sl-controls') !== null;
  });
}

async function fetchJson(path, fallback) {
  try {
    const response = await fetch(`${path}${path.includes('?') ? '&' : '?'}adaptive=${Date.now()}`, { cache: 'no-store' });
    return response.ok ? await response.json() : fallback;
  } catch {
    return fallback;
  }
}

function overviewCard(label, value, type, helper = '') {
  const numeric = numberOrNull(value);
  const tone = numeric === null ? 'neutral' : numeric > 0 ? 'positive' : numeric < 0 ? 'negative' : 'neutral';
  const display = type === 'money' ? money(value) : type === 'percent' ? percent(value) : String(value ?? '–');
  return `<article class="adaptive-kpi ${tone}"><span>${escapeHtml(label)}</span><strong>${display}</strong>${helper ? `<small>${escapeHtml(helper)}</small>` : ''}</article>`;
}

async function loadOverview() {
  if (state.overviewLoaded) return;
  state.overviewLoaded = true;
  const [report, metrics, diagnostics, quotes] = await Promise.all([
    fetchJson('./data/paper-trading/latest-report.json', {}),
    fetchJson('./data/paper-trading/performance-metrics.json', {}),
    fetchJson('./data/paper-trading/drawdown-diagnostics.json', {}),
    fetchJson('/api/quotes?compact=1', null),
  ]);
  const summary = report.summary ?? {};
  const realized = numberOrNull(summary.realized_pnl) ?? 0;
  const liveUnrealized = numberOrNull(quotes?.portfolio?.total_unrealized_pnl);
  const unrealized = liveUnrealized ?? numberOrNull(summary.unrealized_pnl) ?? 0;
  const total = realized + unrealized;
  const equity = numberOrNull(summary.equity) ?? numberOrNull(quotes?.portfolio?.total_current_value);
  const currentDd = numberOrNull(metrics?.risk?.current_drawdown_pct?.value) ?? numberOrNull(summary.max_drawdown_pct);
  const maxDd = numberOrNull(metrics?.risk?.max_drawdown_pct?.value) ?? numberOrNull(summary.max_drawdown_pct);
  const firstCause = (diagnostics.causes ?? [])[0];
  const section = document.querySelector('#overviewSection');
  if (!section) return;
  section.innerHTML = `
    <div class="adaptive-overview-heading">
      <div><p class="eyebrow">TODAY AT A GLANCE</p><h1 id="adaptiveOverviewTitle">今日の状況</h1><p>現在の紙上ポートフォリオは<strong class="${total >= 0 ? 'positive-text' : 'negative-text'}">${total >= 0 ? 'プラス' : 'マイナス'}</strong>です。実現・含み・合計を分けて確認できます。</p></div>
      <div class="adaptive-overview-meta"><span>最終日次集計</span><strong id="adaptiveOverviewUpdated">${dateTime(report.generated_at)}</strong><small>実注文は送信されません</small></div>
    </div>
    <div class="adaptive-kpi-grid">
      ${overviewCard('現在評価額', equity, 'money')}
      ${overviewCard('実現損益', realized, 'money', '確定済み')}
      ${overviewCard('含み損益', unrealized, 'money', liveUnrealized === null ? '日次終値' : '現在値反映')}
      ${overviewCard('合計損益', total, 'money', '実現 + 含み')}
      ${overviewCard('現在DD', currentDd, 'percent', '直近ピーク比')}
      ${overviewCard('最大DD', maxDd, 'percent', '記録期間内')}
    </div>
    <div class="adaptive-primary-alert ${firstCause?.severity ?? 'info'}">
      <span>今日の注意</span><div><strong>${escapeHtml(firstCause?.title ?? '重大なリスク上限超過は検出していません')}</strong><p>${escapeHtml(firstCause?.explanation ?? '日次履歴を蓄積しながら原因の再現性を確認します。')}</p></div>
      <button type="button" data-overview-risk>損益・リスクを見る</button>
    </div>`;
  section.querySelector('[data-overview-risk]')?.addEventListener('click', () => navigateTo('performance'));
  updateDeviceMode();
}

function installOverview() {
  if (document.querySelector('#overviewSection')) return;
  const main = document.querySelector('main');
  if (!main) return;
  const section = document.createElement('section');
  section.id = 'overviewSection';
  section.className = 'adaptive-overview';
  section.setAttribute('aria-labelledby', 'adaptiveOverviewTitle');
  section.innerHTML = '<p class="adaptive-loading">今日の状況を読み込んでいます。</p>';
  main.prepend(section);
  setOrder(section, 10);
  loadOverview();
}

function watchDynamicModules() {
  const main = document.querySelector('main');
  if (!main || state.observer) return;
  let scheduled = false;
  state.observer = new MutationObserver(() => {
    if (scheduled) return;
    scheduled = true;
    requestAnimationFrame(() => {
      scheduled = false;
      ensureSectionAnchors();
    });
  });
  state.observer.observe(main, { childList: true, subtree: true });
}

function init() {
  if (state.initialized) return;
  state.initialized = true;
  installSkipLink();
  installHeaderModeIndicator();
  installNavigation();
  installOverview();
  ensureSectionAnchors();
  watchDynamicModules();
  updateDeviceMode();
  updateActiveNavigation('overview');
  iphoneMedia.addEventListener('change', updateDeviceMode);
  window.addEventListener('orientationchange', () => requestAnimationFrame(updateDeviceMode), { passive: true });
  window.setTimeout(() => { ensureSectionAnchors(); installSectionObserver(); }, 1200);
}

if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init, { once: true });
else init();
