const $ = selector => document.querySelector(selector);
const money = value => Number.isFinite(Number(value))
  ? new Intl.NumberFormat('ja-JP', { style:'currency', currency:'JPY', maximumFractionDigits:0 }).format(Number(value))
  : '–';
const percent = value => Number.isFinite(Number(value)) ? `${Number(value) >= 0 ? '+' : ''}${Number(value).toFixed(2)}%` : '–';

function waitFor(selector, timeoutMs = 5000) {
  const existing = $(selector);
  if (existing) return Promise.resolve(existing);
  return new Promise(resolve => {
    const observer = new MutationObserver(() => {
      const node = $(selector);
      if (!node) return;
      clearTimeout(timer);
      observer.disconnect();
      resolve(node);
    });
    const timer = setTimeout(() => { observer.disconnect(); resolve(null); }, timeoutMs);
    observer.observe(document.documentElement, { childList:true, subtree:true });
  });
}

function signed(node, value) {
  if (!node) return;
  node.className = Number(value) < 0 ? 'negative' : 'positive';
}

function ensureStatus() {
  let node = $('#uxLoadStatus');
  if (node) return node;
  node = document.createElement('span');
  node.id = 'uxLoadStatus';
  node.className = 'ux-load-status loading';
  node.textContent = '日次データを読込中';
  const actions = document.querySelector('.header-actions') ?? document.querySelector('.ux-header-actions');
  actions?.prepend(node);
  return node;
}

function overviewMetric(label) {
  return [...document.querySelectorAll('.adaptive-kpi')].find(card => card.querySelector('span')?.textContent?.trim() === label)?.querySelector('strong') ?? null;
}

async function loadDaily() {
  await waitFor('#overviewSection, #uxAppShell');
  const status = ensureStatus();
  try {
    const [reportResponse, metricsResponse] = await Promise.all([
      fetch('./data/paper-trading/latest-report.json'),
      fetch('./data/paper-trading/performance-metrics.json'),
    ]);
    if (!reportResponse.ok) throw new Error(`report HTTP ${reportResponse.status}`);
    const report = await reportResponse.json();
    const metrics = metricsResponse.ok ? await metricsResponse.json() : null;
    const summary = report.summary ?? {};
    const totalPnl = Number(summary.total_pnl);
    const unrealized = Number(summary.unrealized_pnl);
    const totalReturn = Number(summary.cumulative_return_pct);
    const currentDd = metrics?.risk?.current_drawdown_pct?.value ?? summary.max_drawdown_pct;
    const totalNode = $('#uxTotalPnl') ?? overviewMetric('合計損益');
    const unrealizedNode = $('#uxUnrealizedPnl') ?? overviewMetric('含み損益');
    const drawdownNode = $('#uxCurrentDd') ?? overviewMetric('現在DD');
    if (totalNode) totalNode.textContent = `${totalPnl >= 0 ? '+' : ''}${money(totalPnl)}`;
    if ($('#uxTotalReturn')) $('#uxTotalReturn').textContent = `${percent(totalReturn)} · 日次確定値`;
    if (unrealizedNode) unrealizedNode.textContent = `${unrealized >= 0 ? '+' : ''}${money(unrealized)}`;
    if (drawdownNode) drawdownNode.textContent = percent(currentDd);
    if ($('#uxRiskState')) $('#uxRiskState').textContent = '日次確定値';
    if ($('#uxDataState')) $('#uxDataState').textContent = report.fundamental_source?.plan?.name ?? report.fundamental_source?.plan ?? 'Free';
    if ($('#uxFreshness')) $('#uxFreshness').textContent = `cutoff ${report.fundamental_source?.effective_data_cutoff ?? '–'}`;
    signed(totalNode, totalPnl);
    signed(unrealizedNode, unrealized);
    status.textContent = '日次データ表示済み・現在値を更新中';
    status.className = 'ux-load-status updating';
  } catch (error) {
    status.textContent = '日次データ読込失敗';
    status.className = 'ux-load-status error';
    status.title = String(error?.message ?? error);
  }
}

window.addEventListener('valuescope:quotes', event => {
  const payload = event.detail ?? {};
  const status = ensureStatus();
  const live = Number(payload.portfolio?.total_unrealized_pnl);
  const node = $('#uxUnrealizedPnl') ?? overviewMetric('含み損益');
  if (node && Number.isFinite(live)) {
    node.textContent = `${live >= 0 ? '+' : ''}${money(live)}`;
    signed(node, live);
  }
  if (payload._saved_snapshot) {
    status.textContent = '日次データ表示済み・現在値を更新中';
    status.className = 'ux-load-status updating';
  } else if (payload._stale) {
    status.textContent = '現在値取得失敗・保存値を表示';
    status.className = 'ux-load-status stale';
  } else {
    status.textContent = '現在値反映済み';
    status.className = 'ux-load-status ready';
  }
});

if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', loadDaily, { once:true });
else loadDaily();
