import { DETAIL_TABS, chartGeometry, extractSecurityCode, normalizeSecurityCode, pickDisclosure, reasonGroups, recommendationLabel, sliceChartBars } from './security-detail-core.js';

const $ = selector => document.querySelector(selector);
const escapeHtml = value => String(value ?? '').replace(/[&<>"']/g, character => ({ '&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;' })[character]);
const number = (value, digits = 1) => Number.isFinite(Number(value)) ? Number(value).toLocaleString('ja-JP', { maximumFractionDigits:digits }) : '–';
const percent = (value, digits = 1) => Number.isFinite(Number(value)) ? `${Number(value) >= 0 ? '+' : ''}${Number(value).toFixed(digits)}%` : '–';
const money = value => Number.isFinite(Number(value)) ? new Intl.NumberFormat('ja-JP', { style:'currency', currency:'JPY', maximumFractionDigits:0 }).format(Number(value)) : '–';
const dateText = value => { const date = new Date(value); return !value || Number.isNaN(date.getTime()) ? String(value ?? '–') : new Intl.DateTimeFormat('ja-JP', { year:'numeric', month:'2-digit', day:'2-digit' }).format(date); };
let indexData = { securities:[] };
let currentDetail = null;
let activeTab = 'overview';
let chartRange = '6m';
let observer = null;

async function getJson(path) {
  if (window.ValueScopeData?.getJson) return window.ValueScopeData.getJson(path);
  const response = await fetch(path, { cache:'default' });
  if (!response.ok) throw new Error(`HTTP ${response.status}`);
  return response.json();
}

function list(items, empty = '該当情報はありません。') {
  const values = (items ?? []).filter(Boolean);
  return values.length ? `<ul>${values.map(item => `<li>${escapeHtml(item)}</li>`).join('')}</ul>` : `<p class="sd-empty">${empty}</p>`;
}

function installDialog() {
  if ($('#securityDetailDialog')) return;
  const dialog = document.createElement('dialog');
  dialog.id = 'securityDetailDialog';
  dialog.className = 'security-detail-dialog';
  dialog.setAttribute('aria-labelledby', 'sdTitle');
  dialog.innerHTML = `<div class="sd-shell"><header class="sd-header"><div><p class="eyebrow">SECURITY ANALYSIS</p><h2 id="sdTitle">銘柄詳細</h2><p id="sdSubtitle">決算・開示・推奨理由・チャート</p></div><form method="dialog"><button class="sd-close" type="submit" aria-label="銘柄詳細を閉じる">×</button></form></header><nav class="sd-tabs" role="tablist" aria-label="銘柄詳細タブ">${DETAIL_TABS.map((tab, index) => `<button type="button" role="tab" data-sd-tab="${tab.key}" aria-selected="${index === 0}">${tab.label}</button>`).join('')}</nav><main id="sdBody" class="sd-body"><div class="sd-loading">銘柄データを読み込んでいます。</div></main></div>`;
  document.body.append(dialog);
  dialog.querySelector('.sd-tabs').addEventListener('click', event => {
    const button = event.target.closest('[data-sd-tab]');
    if (!button) return;
    activeTab = button.dataset.sdTab;
    render();
  });
  dialog.addEventListener('close', () => { document.body.classList.remove('security-detail-open'); });
}

function openDialog() {
  const dialog = $('#securityDetailDialog');
  document.body.classList.add('security-detail-open');
  if (typeof dialog.showModal === 'function' && !dialog.open) dialog.showModal(); else dialog.setAttribute('open', '');
}

function findCode(node) {
  const direct = normalizeSecurityCode(node?.dataset?.securityCode ?? node?.closest?.('[data-security-code]')?.dataset?.securityCode ?? '');
  if (direct) return direct;
  return extractSecurityCode(node?.textContent ?? '', indexData.securities ?? []);
}

async function showSecurity(code) {
  const normalized = normalizeSecurityCode(code);
  if (!normalized) return;
  installDialog();
  openDialog();
  activeTab = 'overview';
  currentDetail = null;
  $('#sdTitle').textContent = `${normalized} 読み込み中`;
  $('#sdBody').innerHTML = '<div class="sd-loading">決算・開示・チャートを読み込んでいます。</div>';
  try {
    currentDetail = await getJson(`./data/security-details/${normalized}.json`);
    $('#sdTitle').textContent = `${currentDetail.company_name}（${normalized}）`;
    $('#sdSubtitle').textContent = `${currentDetail.market ?? '市場不明'} · 更新 ${dateText(currentDetail.generated_at)}`;
    render();
  } catch (error) {
    $('#sdBody').innerHTML = `<div class="sd-error"><strong>銘柄詳細を取得できません。</strong><p>${escapeHtml(error.message)}</p><small>日次の詳細データ更新後に再度確認してください。</small></div>`;
  }
}

function renderOverview() {
  const groups = reasonGroups(currentDetail);
  const recommendation = currentDetail.recommendation ?? {};
  const scores = currentDetail.scores ?? {};
  return `<section class="sd-recommendation"><div class="sd-recommendation-head"><span class="sd-action action-${String(recommendation.action ?? '').toLowerCase()}">${escapeHtml(recommendationLabel(recommendation.action))}</span><div><strong>確信度 ${number(recommendation.confidence)}%</strong><small>${escapeHtml(recommendation.execution_note ?? '監視・研究用')}</small></div></div><div class="sd-score-grid"><article><span>総合</span><strong>${number(scores.overall_score)}</strong></article><article><span>割安</span><strong>${number(scores.value_score)}</strong></article><article><span>品質</span><strong>${number(scores.quality_score)}</strong></article><article><span>Technical</span><strong>${number(scores.technical_score)}</strong></article><article><span>Trap</span><strong>${number(scores.value_trap_risk)}</strong></article></div><div class="sd-reason-columns"><article class="fundamental"><header><span>F</span><div><h3>Fundamentalの理由</h3><p>何を保有するか</p></div><strong>${number(groups.fundamental.score)}</strong></header><h4>支持材料</h4>${list(groups.fundamental.positive)}<h4>リスク・欠損</h4>${list([...groups.fundamental.risks, ...groups.fundamental.missing.map(item => `欠損: ${item}`)], '明示的なFundamentalリスクなし')}</article><article class="technical"><header><span>T</span><div><h3>Technicalの理由</h3><p>いつ入る・出るか</p></div><strong>${number(groups.technical.score)}</strong></header><p class="sd-regime">トレンド: ${escapeHtml(groups.technical.regime ?? '不明')}</p><h4>支持材料</h4>${list(groups.technical.positive)}<h4>警戒材料</h4>${list(groups.technical.risks, '明示的なTechnicalリスクなし')}</article></div><p class="sd-disclaimer">${escapeHtml(recommendation.disclaimer ?? '機械的なデモ分析であり、利益を保証しません。')}</p></section>`;
}

function financialMetric(label, value, type = 'number') {
  const display = type === 'money' ? money(value) : type === 'percent' ? percent(value) : number(value, 2);
  return `<article><span>${escapeHtml(label)}</span><strong>${display}</strong></article>`;
}

function renderFinancials() {
  const financials = currentDetail.financials ?? {};
  const latest = financials.latest_snapshot ?? {};
  const trend = financials.trend ?? {};
  const history = financials.summary_history ?? [];
  return `<section class="sd-financials"><div class="sd-financial-head"><div><span>決算状況</span><strong>${escapeHtml(trend.label ?? '比較データ不足')}</strong></div><p>実効データcutoff: ${escapeHtml(financials.effective_data_cutoff ?? '–')} · ${escapeHtml(financials.source ?? '')}</p></div><div class="sd-financial-grid">${financialMetric('売上高', latest.net_sales, 'money')}${financialMetric('営業利益', latest.operating_profit, 'money')}${financialMetric('純利益', latest.profit, 'money')}${financialMetric('EPS', latest.eps)}${financialMetric('総資産', latest.total_assets, 'money')}${financialMetric('自己資本', latest.equity, 'money')}${financialMetric('営業CF', latest.operating_cash_flow, 'money')}${financialMetric('投資CF', latest.investing_cash_flow, 'money')}</div><div class="sd-change-grid">${financialMetric('売上変化', trend.sales_change_pct, 'percent')}${financialMetric('営業利益変化', trend.operating_profit_change_pct, 'percent')}</div><h3>決算短信・要約履歴</h3><div class="sd-table-wrap"><table><thead><tr><th>開示日</th><th>売上</th><th>営業利益</th><th>純利益</th><th>EPS</th></tr></thead><tbody>${history.slice(-8).reverse().map(row => `<tr><td>${dateText(row.disclosed_date ?? row.DiscDate ?? row.DisclosedDate)}</td><td>${money(row.net_sales ?? row.Sales ?? row.NetSales)}</td><td>${money(row.operating_profit ?? row.OP ?? row.OperatingProfit)}</td><td>${money(row.profit ?? row.Profit)}</td><td>${number(row.eps ?? row.EPS ?? row.EarningsPerShare, 2)}</td></tr>`).join('') || '<tr><td colspan="5">履歴なし</td></tr>'}</tbody></table></div><h3>次回決算予定</h3>${list((financials.earnings_dates ?? []).map(row => `${dateText(row.Date ?? row.date ?? row.EarningsDate)} ${row.Note ?? row.Status ?? ''}`), '取得可能な決算予定日はありません。')}<details class="sd-statement-details"><summary>決算書詳細データを見る</summary><pre>${escapeHtml(JSON.stringify((financials.statement_details ?? []).slice(-1)[0] ?? {}, null, 2))}</pre></details></section>`;
}

function renderNews() {
  const disclosures = (currentDetail.disclosures ?? []).map(pickDisclosure);
  const news = currentDetail.news ?? [];
  const disclosureHtml = disclosures.length ? disclosures.map(item => `<article><div><span>${escapeHtml(item.category)}</span><time>${dateText(item.published_at)}</time></div><h3>${escapeHtml(item.title)}</h3>${item.url ? `<a href="${escapeHtml(item.url)}" target="_blank" rel="noreferrer">公式資料を開く</a>` : '<small>文書リンクなし</small>'}</article>`).join('') : '<p class="sd-empty">TDnetアドオンまたはサニタイズ済み適時開示データがありません。</p>';
  const newsHtml = news.length ? news.map(item => `<article><div><span>${escapeHtml(item.source ?? 'News')}</span><time>${dateText(item.published_at)}</time></div><h3>${escapeHtml(item.title)}</h3><a href="${escapeHtml(item.url)}" target="_blank" rel="noreferrer">記事提供元で確認</a></article>`).join('') : '<p class="sd-empty">ニュース見出しを取得できませんでした。</p>';
  return `<section class="sd-news"><div class="sd-source-note"><strong>一次情報を優先</strong><p>適時開示は公式資料、ニュースは見出しと提供元リンクのみを表示します。記事本文や推測の要約は生成しません。</p></div><h3>適時開示・決算短信</h3><div class="sd-news-list">${disclosureHtml}</div><h3>関連ニュース</h3><div class="sd-news-list">${newsHtml}</div></section>`;
}

function candleSvg(bars) {
  const geometry = chartGeometry(bars);
  if (!geometry.bars.length) return '<div class="sd-empty">日足OHLCデータがありません。</div>';
  const { x, y, bodyWidth, width, height, left, right, top, bottom, min, max } = geometry;
  const candles = geometry.bars.map((bar, index) => { const open = Number(bar.open), close = Number(bar.close), high = Number(bar.high), low = Number(bar.low); const rising = close >= open; const bodyY = Math.min(y(open), y(close)); const bodyHeight = Math.max(1.5, Math.abs(y(open) - y(close))); const color = rising ? '#45dea0' : '#ff7482'; return `<g><line x1="${x(index)}" x2="${x(index)}" y1="${y(high)}" y2="${y(low)}" stroke="${color}" stroke-width="1"/><rect x="${x(index)-bodyWidth/2}" y="${bodyY}" width="${bodyWidth}" height="${bodyHeight}" fill="${color}" rx="1"><title>${bar.date} O ${number(open)} H ${number(high)} L ${number(low)} C ${number(close)}</title></rect></g>`; }).join('');
  const line = (key, color) => { const points = geometry.bars.map((bar, index) => Number.isFinite(Number(bar[key])) ? `${x(index)},${y(bar[key])}` : null).filter(Boolean).join(' '); return points ? `<polyline points="${points}" fill="none" stroke="${color}" stroke-width="2" stroke-linejoin="round"/>` : ''; };
  const first = geometry.bars[0]?.date ?? '';
  const last = geometry.bars.at(-1)?.date ?? '';
  return `<svg class="sd-candle-svg" viewBox="0 0 ${width} ${height}" role="img" aria-label="${escapeHtml(currentDetail.company_name)}の日足ローソク足、SMA20、SMA60"><line x1="${left}" y1="${bottom}" x2="${right}" y2="${bottom}" class="sd-axis"/><line x1="${left}" y1="${top}" x2="${left}" y2="${bottom}" class="sd-axis"/>${candles}${line('sma20','#6bb8ff')}${line('sma60','#ffd08b')}<text x="${left-6}" y="${top+5}" text-anchor="end" class="sd-chart-label">${number(max)}</text><text x="${left-6}" y="${bottom}" text-anchor="end" class="sd-chart-label">${number(min)}</text><text x="${left}" y="${height-12}" class="sd-chart-label">${escapeHtml(first)}</text><text x="${right}" y="${height-12}" text-anchor="end" class="sd-chart-label">${escapeHtml(last)}</text></svg>`;
}

function renderChart() {
  const chart = currentDetail.chart ?? {};
  const bars = sliceChartBars(chart.bars ?? [], chartRange);
  const latest = bars.at(-1) ?? {};
  return `<section class="sd-chart"><div class="sd-chart-toolbar"><div><strong>日足ローソク足</strong><small>${escapeHtml(chart.source ?? '')}</small></div><div>${['3m','6m','1y'].map(range => `<button type="button" data-sd-range="${range}" class="${chartRange === range ? 'active' : ''}">${range.toUpperCase()}</button>`).join('')}</div></div><div class="sd-chart-legend"><span class="price-up">陽線</span><span class="price-down">陰線</span><span class="sma20">SMA20 ${number(latest.sma20)}</span><span class="sma60">SMA60 ${number(latest.sma60)}</span></div>${candleSvg(bars)}<div class="sd-chart-metrics"><article><span>終値</span><strong>${money(latest.close)}</strong></article><article><span>SMA20</span><strong>${money(latest.sma20)}</strong></article><article><span>SMA60</span><strong>${money(latest.sma60)}</strong></article><article><span>出来高</span><strong>${number(latest.volume, 0)}</strong></article></div><p class="sd-chart-note">移動平均は日足終値から算出。売買判断はFundamentalと併せて確認してください。</p></section>`;
}

function render() {
  if (!currentDetail) return;
  document.querySelectorAll('[data-sd-tab]').forEach(button => { const active = button.dataset.sdTab === activeTab; button.setAttribute('aria-selected', String(active)); button.tabIndex = active ? 0 : -1; });
  $('#sdBody').innerHTML = ({ overview:renderOverview, financials:renderFinancials, news:renderNews, chart:renderChart })[activeTab]?.() ?? renderOverview();
  $('#sdBody').querySelectorAll('[data-sd-range]').forEach(button => button.addEventListener('click', () => { chartRange = button.dataset.sdRange; render(); }));
}

function decorateTargets() {
  const candidates = document.querySelectorAll('#rankingBody tr,#demoTradeBody tr,.sl-card,.decision-card,.dr-card');
  candidates.forEach(node => {
    if (node.dataset.securityDetailReady === 'true') return;
    const code = findCode(node);
    if (!code) return;
    node.dataset.securityCode = code;
    node.dataset.securityDetailReady = 'true';
    node.title = `${node.title ? `${node.title} / ` : ''}ダブルクリックで銘柄詳細`;
    const host = node.matches('tr') ? node.querySelector('td') : node.querySelector('header') ?? node;
    if (host && !host.querySelector('.security-detail-open')) {
      const button = document.createElement('button');
      button.type = 'button';
      button.className = 'security-detail-open';
      button.textContent = '銘柄詳細';
      button.setAttribute('aria-label', `${code}の銘柄詳細を開く`);
      button.addEventListener('click', event => { event.stopPropagation(); showSecurity(code); });
      host.append(button);
    }
  });
}

async function start() {
  installDialog();
  try { indexData = await getJson('./data/security-details/index.json'); } catch { indexData = { securities:[] }; }
  document.addEventListener('dblclick', event => { const target = event.target.closest('[data-security-code],#rankingBody tr,#demoTradeBody tr,.sl-card,.decision-card,.dr-card'); const code = findCode(target); if (code) showSecurity(code); });
  observer = new MutationObserver(decorateTargets);
  observer.observe(document.querySelector('main') ?? document.body, { childList:true, subtree:true });
  decorateTargets();
}

if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', start, { once:true }); else start();
