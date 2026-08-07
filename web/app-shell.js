import { densityForMode, normalizeView, parseShellHash, sectionViewMap, shellHash, viewportMode } from './app-shell-core.js';

const STORAGE_DENSITY = 'valuescope-density-v1';
const VIEW_LABELS = Object.freeze({ overview:'概要', decision:'投資判断', screening:'条件スクリーナー', analytics:'損益・リスク', data:'データ・プラン' });
const VIEW_DESCRIPTIONS = Object.freeze({
  overview:'現在の成績、判断、リスク、データ鮮度を最初に確認します。',
  decision:'売買判断の根拠をFundamentalとTechnicalに分けて確認します。',
  screening:'条件とウェイトを調整し、通過銘柄と除外理由を確認します。',
  analytics:'資産推移、損益、ドローダウン、原因診断、リスク上限を確認します。',
  data:'J-Quantsの鮮度、プラン差、データ能力、研究情報を確認します。',
});
const NAV_ICONS = Object.freeze({ overview:'⌂', decision:'◎', screening:'⌕', analytics:'↗', data:'▦' });
const $ = selector => document.querySelector(selector);

let activeView = 'overview';
let currentMode = viewportMode(window.innerWidth);
let requestedDensity = localStorage.getItem(STORAGE_DENSITY) ?? 'comfortable';
let shell = null;
let observer = null;
let contextTimer = null;

function createShell() {
  const main = $('main');
  if (!main || $('#uxAppShell')) return;
  shell = document.createElement('div');
  shell.id = 'uxAppShell';
  shell.className = 'ux-app-shell';
  shell.innerHTML = `
    <aside class="ux-rail">
      <div class="ux-rail-brand"><span>VS</span><div><strong>ValueScope</strong><small>Japan</small></div></div>
      <nav id="uxPrimaryNav" class="ux-primary-nav" aria-label="主要画面">
        ${Object.entries(VIEW_LABELS).map(([key,label]) => `<button type="button" data-view="${key}" aria-current="false"><span aria-hidden="true">${NAV_ICONS[key]}</span><b>${label}</b></button>`).join('')}
      </nav>
      <div class="ux-rail-footer"><span id="uxModeLabel">PC表示</span><small>Paper analysis only</small></div>
    </aside>
    <section class="ux-workspace">
      <header class="ux-view-header">
        <div><p class="eyebrow">VALUESCOPE WORKSPACE</p><h1 id="uxViewTitle">概要</h1><p id="uxViewDescription">${VIEW_DESCRIPTIONS.overview}</p></div>
        <div class="ux-header-actions"><button id="uxDensityToggle" type="button" class="ux-density-button">表示密度: 標準</button><span class="ux-safety">実注文なし</span></div>
      </header>
      <section id="uxOverviewHighlights" class="ux-overview-highlights" aria-label="主要サマリー">
        <article><span>合計損益</span><strong id="uxTotalPnl">読込中</strong><small id="uxTotalReturn">–</small></article>
        <article><span>含み損益</span><strong id="uxUnrealizedPnl">読込中</strong><small>現在保有分</small></article>
        <article><span>現在DD</span><strong id="uxCurrentDd">読込中</strong><small id="uxRiskState">リスク確認中</small></article>
        <article><span>データ</span><strong id="uxDataState">読込中</strong><small id="uxFreshness">鮮度確認中</small></article>
      </section>
      <main id="uxViewHost" class="ux-view-host">
        ${Object.entries(VIEW_LABELS).map(([key,label]) => `<section id="uxView-${key}" class="ux-view" data-view="${key}" aria-label="${label}" ${key === 'overview' ? '' : 'hidden'}><div class="ux-view-loading"><i></i><i></i><i></i><span>${label}を準備しています</span></div></section>`).join('')}
      </main>
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
  document.querySelector('#mobileNavigation')?.remove();
  installNavigation();
  installHistoryPatch();
  installObserver();
  moveKnownSections();
  updateMode();
  const initial = parseShellHash(location.hash).view;
  activateView(initial, { history:'replace', scroll:false });
  contextTimer = window.setInterval(updateSummaries, 3000);
  window.setTimeout(() => clearInterval(contextTimer), 30000);
}

function installNavigation() {
  $('#uxPrimaryNav')?.addEventListener('click', event => {
    const button = event.target.closest('button[data-view]');
    if (!button) return;
    activateView(button.dataset.view, { history:'push', scroll:true });
  });
  $('#uxDensityToggle')?.addEventListener('click', () => {
    requestedDensity = requestedDensity === 'compact' ? 'comfortable' : 'compact';
    localStorage.setItem(STORAGE_DENSITY, requestedDensity);
    applyDensity();
  });
  window.addEventListener('popstate', () => activateView(parseShellHash(location.hash).view, { history:'none', scroll:false }));
  window.addEventListener('hashchange', () => {
    const parsed = parseShellHash(location.hash);
    if (parsed.view !== activeView) activateView(parsed.view, { history:'none', scroll:false });
  });
  window.addEventListener('resize', updateMode, { passive:true });
  window.addEventListener('orientationchange', () => requestAnimationFrame(updateMode));
  document.addEventListener('keydown', event => {
    if (event.key === 'Escape') document.querySelectorAll('[data-ux-open="true"]').forEach(node => node.dataset.uxOpen = 'false');
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
    updateSummaries();
  });
  observer.observe(main, { childList:true, subtree:true });
  window.setTimeout(() => observer?.disconnect(), 15000);
}

function moveKnownSections() {
  const map = sectionViewMap();
  for (const [selector,view] of Object.entries(map)) {
    document.querySelectorAll(selector).forEach(node => {
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
  prepareLegacySections();
}

function prepareLegacySections() {
  const ranking = $('.ranking');
  const filters = $('.filters');
  if (ranking && filters && !$('#uxLegacyRanking')) {
    const details = document.createElement('details');
    details.id = 'uxLegacyRanking';
    details.className = 'ux-progressive-block';
    details.innerHTML = '<summary><span>ランキング表・簡易フィルター</span><small>必要な時だけ展開</small></summary><div class="ux-progressive-content"></div>';
    filters.before(details);
    details.querySelector('.ux-progressive-content').append(filters, ranking);
  }
  const demo = $('#demoTrade');
  if (demo && !demo.querySelector('.ux-section-jump')) {
    const button = document.createElement('button');
    button.type = 'button';
    button.className = 'ux-section-jump';
    button.textContent = '詳細分析を上へ表示';
    button.addEventListener('click', () => $('#performanceAnalytics')?.scrollIntoView({ behavior:'smooth', block:'start' }));
    demo.prepend(button);
  }
  const report = $('#investmentDecisionReport');
  if (report) report.dataset.uxShared = 'decision-data';
}

function activateView(requested, options = {}) {
  const view = normalizeView(requested);
  activeView = view;
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
  if (options.history === 'push') history.pushState({ uxView:view }, '', shellHash(view, location.hash));
  if (options.history === 'replace') history.replaceState({ uxView:view }, '', shellHash(view, location.hash));
  if (options.scroll) $('#uxAppShell')?.scrollIntoView({ behavior:currentMode === 'phone' ? 'smooth' : 'auto', block:'start' });
  updateSummaries();
}

function updateMode() {
  currentMode = viewportMode(window.innerWidth);
  document.documentElement.dataset.uxMode = currentMode;
  const label = currentMode === 'phone' ? 'iPhone表示' : currentMode === 'tablet' ? 'iPad表示' : 'PC表示';
  $('#uxModeLabel').textContent = label;
  const legacy = $('#viewportMode');
  if (legacy) legacy.textContent = label;
  applyDensity();
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

function updateSummaries() {
  const totalPnl = readText('#demoPnl', readText('#paLivePnl', '読込中'));
  const totalReturn = readText('#demoReturn');
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
  const pnlNumber = totalPnl.includes('-') ? 'negative' : totalPnl === '読込中' ? '' : 'positive';
  $('#uxTotalPnl').className = pnlNumber;
  $('#uxUnrealizedPnl').className = unrealized.includes('-') ? 'negative' : unrealized === '読込中' ? '' : 'positive';
}

function start() {
  createShell();
}

if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', start);
else start();
