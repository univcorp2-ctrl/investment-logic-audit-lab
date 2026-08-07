import {
  densityForMode,
  normalizeView,
  parseShellHash,
  sectionViewMap,
  shellHash,
  viewportMode,
} from './app-shell-core.js';

const STORAGE_DENSITY = 'valuescope-density-v1';
const VIEW_LABELS = Object.freeze({
  overview: '概要',
  decision: '投資判断',
  screening: '条件設定',
  analytics: '損益・リスク',
  data: 'データ・プラン',
});
const VIEW_DESCRIPTIONS = Object.freeze({
  overview: '現在の成績、判断、リスク、データ鮮度を最初に確認します。',
  decision: '売買判断の根拠をFundamentalとTechnicalに分けて確認します。',
  screening: '条件とウェイトを調整し、通過銘柄と除外理由を確認します。',
  analytics: '保有銘柄、資産推移、損益、ドローダウンと原因診断を確認します。',
  data: 'J-Quantsの鮮度、プラン差、適時開示能力、研究情報を確認します。',
});
const NAV_ICONS = Object.freeze({ overview: '⌂', decision: '◎', screening: '⌕', analytics: '↗', data: '▦' });
const $ = selector => document.querySelector(selector);
const $$ = selector => [...document.querySelectorAll(selector)];

let activeView = 'overview';
let currentMode = viewportMode(window.innerWidth);
let requestedDensity = localStorage.getItem(STORAGE_DENSITY) ?? 'comfortable';
let observer = null;
let contextTimer = null;
let trustedSummaryLoaded = false;

const money = value => Number.isFinite(Number(value))
  ? new Intl.NumberFormat('ja-JP', { style: 'currency', currency: 'JPY', maximumFractionDigits: 0 }).format(Number(value))
  : '–';
const percent = value => Number.isFinite(Number(value))
  ? `${Number(value) >= 0 ? '+' : ''}${Number(value).toFixed(2)}%`
  : '–';
const dateTime = value => {
  if (!value) return '–';
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? String(value) : new Intl.DateTimeFormat('ja-JP', {
    timeZone: 'Asia/Tokyo',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
  }).format(date);
};

function createShell() {
  const main = $('main');
  if (!main || $('#uxAppShell')) return;
  const shell = document.createElement('div');
  shell.id = 'uxAppShell';
  shell.className = 'ux-app-shell';
  shell.innerHTML = `
    <aside class="ux-rail">
      <div class="ux-rail-brand"><span>VS</span><div><strong>ValueScope</strong><small>Japan</small></div></div>
      <nav id="uxPrimaryNav" class="ux-primary-nav" aria-label="主要画面">
        ${Object.entries(VIEW_LABELS).map(([key, label]) => `<button type="button" data-view="${key}" aria-current="false"><span aria-hidden="true">${NAV_ICONS[key]}</span><b>${label}</b></button>`).join('')}
      </nav>
      <div class="ux-rail-footer"><span id="uxModeLabel">PC表示</span><small>Paper analysis only</small></div>
    </aside>
    <section class="ux-workspace">
      <header class="ux-view-header">
        <div><p class="eyebrow">VALUESCOPE WORKSPACE</p><h1 id="uxViewTitle">概要</h1><p id="uxViewDescription">${VIEW_DESCRIPTIONS.overview}</p></div>
        <div class="ux-header-actions"><button id="uxDensityToggle" type="button" class="ux-density-button">表示密度: 標準</button><span class="ux-safety">実注文なし</span></div>
      </header>
      <section id="uxOverviewHighlights" class="ux-overview-highlights" aria-label="主要サマリー">
        <article><span>合計損益（日次確定）</span><strong id="uxTotalPnl">読込中</strong><small id="uxTotalReturn">–</small></article>
        <article><span>含み損益（現在値）</span><strong id="uxUnrealizedPnl">読込中</strong><small>現在保有分</small></article>
        <article><span>現在ドローダウン</span><strong id="uxCurrentDd">読込中</strong><small id="uxRiskState">リスク確認中</small></article>
        <article><span>Fundamentalデータ</span><strong id="uxDataState">読込中</strong><small id="uxFreshness">鮮度確認中</small></article>
      </section>
      <div id="uxViewHost" class="ux-view-host">
        ${Object.entries(VIEW_LABELS).map(([key, label]) => `<section id="uxView-${key}" class="ux-view" data-view="${key}" aria-label="${label}" ${key === 'overview' ? '' : 'hidden'}><div class="ux-view-loading"><i></i><i></i><i></i><span>${label}を準備しています</span></div></section>`).join('')}
      </div>
    </section>
    <aside class="ux-context" aria-label="コンテキストサマリー">
      <section><span>現在の画面</span><strong id="uxContextView">概要</strong></section>
      <section><span>リスク状態</span><strong id="uxContextRisk">確認中</strong></section>
      <section><span>データ鮮度</span><strong id="uxContextData">確認中</strong></section>
      <section><span>最終更新</span><strong id="uxContextUpdated">確認中</strong></section>
      <section class="ux-context-help"><strong>見方</strong><p id="uxContextHelp">最初に合計損益と現在DDを確認し、異常時は「損益・リスク」へ進みます。</p></section>
    </aside>`;
  main.prepend(shell);
  document.documentElement.classList.add('ux-shell-ready');
  $('#mobileNavigation')?.remove();
  installNavigation();
  installHistoryPatch();
  installObserver();
  moveKnownSections();
  updateMode();
  const initial = parseShellHash(location.hash).view;
  activateView(initial, { history: 'replace', scroll: false });
  loadTrustedSummaries();
  contextTimer = window.setInterval(() => {
    updateSummariesFromDom();
    if (!trustedSummaryLoaded) loadTrustedSummaries();
  }, 15000);
  window.setTimeout(() => clearInterval(contextTimer), 180000);
}

function installNavigation() {
  $('#uxPrimaryNav')?.addEventListener('click', event => {
    const button = event.target.closest('button[data-view]');
    if (!button) return;
    activateView(button.dataset.view, { history: 'push', scroll: true });
  });
  $('#uxDensityToggle')?.addEventListener('click', () => {
    requestedDensity = requestedDensity === 'compact' ? 'comfortable' : 'compact';
    localStorage.setItem(STORAGE_DENSITY, requestedDensity);
    applyDensity();
  });
  window.addEventListener('popstate', () => activateView(parseShellHash(location.hash).view, { history: 'none', scroll: false }));
  window.addEventListener('hashchange', () => {
    const parsed = parseShellHash(location.hash);
    if (parsed.view !== activeView) activateView(parsed.view, { history: 'none', scroll: false });
  });
  window.addEventListener('resize', updateMode, { passive: true });
  window.addEventListener('orientationchange', () => requestAnimationFrame(updateMode));
  document.addEventListener('keydown', event => {
    if (event.key === 'Escape') document.querySelectorAll('[data-ux-open="true"]').forEach(node => { node.dataset.uxOpen = 'false'; });
  });
}

function installHistoryPatch() {
  const original = history.replaceState.bind(history);
  history.replaceState = (state, title, url) => {
    if (typeof url === 'string' && url.includes('#screen=') && !url.includes('view=')) {
      const replacement = url.replace('#screen=', `#view=${activeView}&screen=`);
      return original(state, title, replacement);
    }
    return original(state, title, url);
  };
}

function installObserver() {
  const main = $('main');
  if (!main) return;
  observer = new MutationObserver(() => {
    moveKnownSections();
    updateSummariesFromDom();
  });
  observer.observe(main, { childList: true, subtree: true });
  window.setTimeout(() => {
    moveKnownSections();
    observer?.disconnect();
  }, 20000);
}

function targetViewFor(selector, mappedView) {
  if (selector === '#investmentDecisionReport' && activeView === 'data') return 'data';
  return mappedView;
}

function moveKnownSections() {
  const map = sectionViewMap();
  for (const [selector, mappedView] of Object.entries(map)) {
    document.querySelectorAll(selector).forEach(node => {
      const view = targetViewFor(selector, mappedView);
      if (node.closest('#uxAppShell') && node.closest('.ux-view')?.dataset.view === view) return;
      if (node.id === 'uxAppShell' || node.classList.contains('ux-view')) return;
      $(`#uxView-${view}`)?.append(node);
      node.dataset.uxGrouped = view;
    });
  }
  document.querySelectorAll('.ux-view').forEach(view => {
    const loading = view.querySelector(':scope > .ux-view-loading');
    const hasContent = [...view.children].some(child => !child.classList.contains('ux-view-loading'));
    if (loading) loading.hidden = hasContent;
  });
  prepareProgressiveSections();
  labelResponsiveTables();
  preparePhoneAccordions();
}

function createProgressiveDetails(id, label, helper) {
  const details = document.createElement('details');
  details.id = id;
  details.className = 'ux-progressive-block';
  details.innerHTML = `<summary><span>${label}</span><small>${helper}</small></summary><div class="ux-progressive-content"></div>`;
  details.addEventListener('toggle', () => { details.dataset.uxUserToggled = 'true'; });
  return details;
}

function prepareProgressiveSections() {
  const ranking = $('.ranking');
  const filters = $('.filters');
  if (ranking && filters && !$('#uxLegacyRanking')) {
    const details = createProgressiveDetails('uxLegacyRanking', 'ランキング表・簡易フィルター', '必要な時だけ展開');
    filters.before(details);
    details.querySelector('.ux-progressive-content').append(filters, ranking);
  }
  const visual = $('.visual-grid');
  if (visual && !$('#uxOverviewCharts')) {
    const details = createProgressiveDetails('uxOverviewCharts', 'スコア分布・上位比較', '補助チャートを表示');
    visual.before(details);
    details.querySelector('.ux-progressive-content').append(visual);
    details.open = currentMode !== 'phone';
  }
  const demo = $('#demoTrade');
  const demoTable = demo?.querySelector('.demo-table-wrap');
  if (demo && demoTable && !$('#uxDemoPositions')) {
    const details = createProgressiveDetails('uxDemoPositions', '保有銘柄の明細', '10銘柄の損益と検証状態');
    demoTable.before(details);
    details.querySelector('.ux-progressive-content').append(demoTable);
  }
  if (demo && !demo.querySelector('.ux-section-jump')) {
    const button = document.createElement('button');
    button.type = 'button';
    button.className = 'ux-section-jump';
    button.textContent = '詳細な損益・リスク分析へ';
    button.addEventListener('click', () => activateView('analytics', { history: 'push', scroll: true }));
    demo.prepend(button);
  }
  const report = $('#investmentDecisionReport');
  if (report) report.dataset.uxShared = 'decision-data';
}

function labelTable(bodySelector, labels) {
  const body = $(bodySelector);
  if (!body || body.dataset.uxLabels === 'ready') return;
  const apply = () => body.querySelectorAll('tr').forEach(row => {
    [...row.children].forEach((cell, index) => { cell.dataset.label = labels[index] ?? ''; });
  });
  apply();
  new MutationObserver(apply).observe(body, { childList: true, subtree: true });
  body.dataset.uxLabels = 'ready';
}

function labelResponsiveTables() {
  labelTable('#rankingBody', ['順位', '銘柄', '市場・業種', '株価', '総合', '割安', '品質', 'Technical', '流動性', 'Trap', '充足率', '判定']);
  labelTable('#demoTradeBody', ['銘柄', '株数', '取得価格', '現在値', '投資額', '評価額', '損益', '収益率', '検証', '更新時刻']);
}

function preparePhoneAccordions() {
  if (currentMode !== 'phone') return;
  const screening = $$('#screeningLab .sl-controls > details');
  screening.forEach((details, index) => {
    if (details.dataset.uxPhonePrepared) return;
    details.dataset.uxPhonePrepared = 'true';
    details.open = index === 0;
  });
  $$('#fundamentalDetailLab details, .pa-settings, .pa-series-table').forEach(details => {
    if (details.dataset.uxPhonePrepared) return;
    details.dataset.uxPhonePrepared = 'true';
    details.open = false;
  });
  const overviewCharts = $('#uxOverviewCharts');
  if (overviewCharts && overviewCharts.dataset.uxUserToggled !== 'true') overviewCharts.open = false;
  const legacy = $('#uxLegacyRanking');
  if (legacy && legacy.dataset.uxUserToggled !== 'true') legacy.open = false;
  const positions = $('#uxDemoPositions');
  if (positions && positions.dataset.uxUserToggled !== 'true') positions.open = false;
}

function activateView(requested, options = {}) {
  const view = normalizeView(requested);
  activeView = view;
  document.body.dataset.uxView = view;
  const report = $('#investmentDecisionReport');
  if (report) {
    if (view === 'data') {
      $('#uxView-data')?.append(report);
      report.querySelector('[data-tab="plan"]')?.click();
    } else if (view === 'decision') {
      $('#uxView-decision')?.append(report);
      report.querySelector('[data-tab="judge"]')?.click();
    }
  }
  document.querySelectorAll('.ux-view').forEach(node => { node.hidden = node.dataset.view !== view; });
  document.querySelectorAll('#uxPrimaryNav button').forEach(button => {
    const selected = button.dataset.view === view;
    button.setAttribute('aria-current', selected ? 'page' : 'false');
  });
  $('#uxViewTitle').textContent = VIEW_LABELS[view];
  $('#uxViewDescription').textContent = VIEW_DESCRIPTIONS[view];
  $('#uxContextView').textContent = VIEW_LABELS[view];
  $('#uxContextHelp').textContent = VIEW_DESCRIPTIONS[view];
  if (options.history === 'push') history.pushState({ uxView: view }, '', shellHash(view, location.hash));
  if (options.history === 'replace') history.replaceState({ uxView: view }, '', shellHash(view, location.hash));
  if (options.scroll) $('#uxAppShell')?.scrollIntoView({ behavior: currentMode === 'phone' ? 'smooth' : 'auto', block: 'start' });
  updateSummariesFromDom();
}

function updateMode() {
  currentMode = viewportMode(window.innerWidth);
  document.documentElement.dataset.uxMode = currentMode;
  const label = currentMode === 'phone' ? 'iPhone表示' : currentMode === 'tablet' ? 'iPad表示' : 'PC表示';
  $('#uxModeLabel').textContent = label;
  const legacy = $('#viewportMode');
  if (legacy) legacy.textContent = label;
  applyDensity();
  preparePhoneAccordions();
  if (currentMode !== 'phone') {
    const overviewCharts = $('#uxOverviewCharts');
    if (overviewCharts && overviewCharts.dataset.uxUserToggled !== 'true') overviewCharts.open = true;
  }
}

function applyDensity() {
  const density = densityForMode(currentMode, requestedDensity);
  document.documentElement.dataset.uxDensity = density;
  const button = $('#uxDensityToggle');
  if (button) {
    button.hidden = currentMode === 'phone';
    button.textContent = `表示密度: ${density === 'compact' ? 'コンパクト' : '標準'}`;
  }
}

function readText(selector, fallback = '–') {
  const value = $(selector)?.textContent?.trim();
  return value || fallback;
}

function setSignedClass(node, text) {
  if (!node) return;
  node.className = String(text).includes('-') ? 'negative' : ['読込中', '–'].includes(String(text)) ? '' : 'positive';
}

function updateSummariesFromDom() {
  if (trustedSummaryLoaded) return;
  const totalPnl = readText('#paTotalPnl', readText('#demoPnl', '読込中'));
  const totalReturn = readText('#paTotalReturn', readText('#demoReturn'));
  const unrealized = readText('#rdSnapshot article:nth-child(2) strong', readText('#demoPnl'));
  const drawdown = readText('#rdSnapshot article:nth-child(3) strong', readText('.pa-metric-grid .pa-metric:nth-child(3) strong'));
  const risk = readText('#rdStatus', '確認中');
  const dataState = readText('#liveState', '確認中');
  const freshness = readText('#cutoffLabel', readText('#priceDateLabel'));
  const updated = readText('#demoUpdatedAt', readText('#asOfLabel'));
  $('#uxTotalPnl').textContent = totalPnl;
  $('#uxTotalReturn').textContent = totalReturn;
  $('#uxUnrealizedPnl').textContent = unrealized;
  $('#uxCurrentDd').textContent = drawdown;
  $('#uxRiskState').textContent = risk;
  $('#uxDataState').textContent = dataState;
  $('#uxFreshness').textContent = freshness;
  $('#uxContextRisk').textContent = risk;
  $('#uxContextData').textContent = dataState;
  $('#uxContextUpdated').textContent = updated;
  setSignedClass($('#uxTotalPnl'), totalPnl);
  setSignedClass($('#uxUnrealizedPnl'), unrealized);
}

function parsePortfolioStatus(text) {
  const lines = String(text ?? '').trim().split('\n').map(line => line.split('\t'));
  const total = lines.find(parts => parts[0] === 'total') ?? [];
  return {
    generatedAt: lines.find(parts => parts[0] === 'generated_at')?.[1] ?? null,
    currentValue: Number(total[2]),
    unrealizedPnl: Number(total[3]),
    returnPct: Number(total[4]),
  };
}

async function loadTrustedSummaries() {
  try {
    const [reportResponse, portfolioResponse, metricsResponse] = await Promise.all([
      fetch(`./data/paper-trading/latest-report.json?ts=${Date.now()}`, { cache: 'no-store' }),
      fetch('/api/portfolio-status?offset=0&limit=10', { cache: 'no-store' }),
      fetch(`./data/paper-trading/performance-metrics.json?ts=${Date.now()}`, { cache: 'no-store' }),
    ]);
    const report = reportResponse.ok ? await reportResponse.json() : null;
    const portfolio = portfolioResponse.ok ? parsePortfolioStatus(await portfolioResponse.text()) : null;
    const metrics = metricsResponse.ok ? await metricsResponse.json() : null;
    if (!report && !portfolio) return;
    const summary = report?.summary ?? {};
    const totalPnl = Number(summary.total_pnl);
    const totalReturn = Number(summary.cumulative_return_pct);
    const unrealized = Number.isFinite(portfolio?.unrealizedPnl) ? portfolio.unrealizedPnl : Number(summary.unrealized_pnl);
    const currentDd = metrics?.risk?.current_drawdown_pct?.value ?? summary.max_drawdown_pct;
    const cutoff = report?.fundamental_source?.effective_data_cutoff ?? '–';
    const plan = report?.fundamental_source?.plan?.name ?? report?.fundamental_source?.plan ?? 'Free';
    const riskText = Number(currentDd) <= -8 ? '高リスク' : Number(currentDd) <= -4 ? '注意' : '設定内';
    $('#uxTotalPnl').textContent = `${totalPnl >= 0 ? '+' : ''}${money(totalPnl)}`;
    $('#uxTotalReturn').textContent = percent(totalReturn);
    $('#uxUnrealizedPnl').textContent = `${unrealized >= 0 ? '+' : ''}${money(unrealized)}`;
    $('#uxCurrentDd').textContent = percent(currentDd);
    $('#uxRiskState').textContent = riskText;
    $('#uxDataState').textContent = `${plan}`;
    $('#uxFreshness').textContent = `cutoff ${cutoff}`;
    $('#uxContextRisk').textContent = riskText;
    $('#uxContextData').textContent = `${plan} / ${cutoff}`;
    $('#uxContextUpdated').textContent = dateTime(portfolio?.generatedAt ?? report?.generated_at);
    setSignedClass($('#uxTotalPnl'), totalPnl);
    setSignedClass($('#uxUnrealizedPnl'), unrealized);
    trustedSummaryLoaded = true;
  } catch {
    trustedSummaryLoaded = false;
  }
}

function start() {
  createShell();
}

if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', start);
else start();
