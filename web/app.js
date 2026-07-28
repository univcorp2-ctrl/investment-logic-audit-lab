import { demoFundamentals } from './demo-data.js';
import { parseCsv, scoreRows, summarizeRows, toCsv } from './scoring.js';

const $ = selector => document.querySelector(selector);
const state = { rows: [], rawRows: [], search: '', payload: null };
const formatScore = value => Number.isFinite(Number(value)) ? Number(value).toFixed(1) : '–';
const escapeHtml = value => String(value ?? '').replace(/[&<>'"]/g, char => ({ '&':'&amp;','<':'&lt;','>':'&gt;',"'":'&#39;','"':'&quot;' }[char]));
const formatDate = value => {
  if (!value) return '日付不明';
  const date = new Date(`${value}T00:00:00+09:00`);
  return Number.isNaN(date.getTime()) ? value : new Intl.DateTimeFormat('ja-JP', { year:'numeric', month:'long', day:'numeric' }).format(date);
};
const yen = value => Number.isFinite(Number(value)) ? new Intl.NumberFormat('ja-JP', { style:'currency', currency:'JPY', maximumFractionDigits:0 }).format(Number(value)) : '–';

function candidateRows() {
  const eligible = state.rows.filter(row => row.eligible);
  return (eligible.length >= 5 ? eligible : state.rows).slice(0, 5);
}

function renderTopPicks() {
  $('#topPicks').innerHTML = candidateRows().map((row, index) => `
    <button class="pick-card" data-symbol="${escapeHtml(row.symbol)}" type="button">
      <span class="pick-rank">${index + 1}</span>
      <div class="pick-name"><strong>${escapeHtml(row.company_name || row.symbol)}</strong><small>${escapeHtml(row.symbol)} · ${escapeHtml(row.sector)}</small></div>
      <div class="pick-score"><strong>${formatScore(row.overall_score)}</strong><small>総合点</small></div>
      <p>${escapeHtml((row.reasons || [])[0] || '総合スコアが上位')}</p>
      <span class="pick-more">理由を見る →</span>
    </button>`).join('');
  document.querySelectorAll('.pick-card').forEach(card => card.addEventListener('click', () => showDetail(state.rows.find(row => String(row.symbol) === card.dataset.symbol))));
}

function renderTable() {
  const query = state.search.trim().toLowerCase();
  const rows = state.rows.filter(row => !query || [row.symbol, row.company_name, row.sector].join(' ').toLowerCase().includes(query));
  $('#rankingBody').innerHTML = rows.map(row => `
    <tr data-symbol="${escapeHtml(row.symbol)}" tabindex="0">
      <td class="rank">${row.rank}</td>
      <td><strong>${escapeHtml(row.company_name || row.symbol)}</strong><small>${escapeHtml(row.symbol)} · ${escapeHtml(row.sector)}</small></td>
      <td><b class="score strong">${formatScore(row.overall_score)}</b></td>
      <td><b class="score">${formatScore(row.undervaluation_score)}</b></td>
      <td><b class="score">${formatScore(row.quality_score)}</b></td>
      <td><b class="score">${formatScore(row.technical_score)}</b></td>
      <td><b class="score risk">${formatScore(row.value_trap_risk)}</b></td>
      <td><span class="status ${row.eligible ? 'pass' : 'watch'}">${row.eligible ? '候補' : '要確認'}</span></td>
    </tr>`).join('');
  document.querySelectorAll('#rankingBody tr').forEach(row => {
    const open = () => showDetail(state.rows.find(item => String(item.symbol) === row.dataset.symbol));
    row.addEventListener('click', open);
    row.addEventListener('keydown', event => { if (event.key === 'Enter') open(); });
  });
}

function renderSummary() {
  const summary = summarizeRows(state.rows);
  $('#scoredCount').textContent = state.rows.length;
  $('#eligibleCount').textContent = summary.eligible;
  $('#medianScore').textContent = formatScore(summary.medianOverall);
  $('#averageTrap').textContent = formatScore(summary.averageTrap);
}

function render() {
  renderTopPicks();
  renderTable();
  renderSummary();
}

function showDetail(row) {
  if (!row) return;
  const reasons = Array.isArray(row.reasons) ? row.reasons : [];
  const filters = Array.isArray(row.filter_reasons) ? row.filter_reasons : [];
  $('#detailContent').innerHTML = `
    <p class="eyebrow">WHY THIS STOCK</p>
    <h2>${escapeHtml(row.company_name || row.symbol)}</h2>
    <p class="detail-meta">${escapeHtml(row.symbol)} · ${escapeHtml(row.sector)}</p>
    <div class="detail-total"><span>総合スコア</span><strong>${formatScore(row.overall_score)}</strong><em class="status ${row.eligible ? 'pass' : 'watch'}">${row.eligible ? '候補' : '要確認'}</em></div>
    <div class="detail-grid">
      <div><span>割安</span><strong>${formatScore(row.undervaluation_score)}</strong></div>
      <div><span>品質</span><strong>${formatScore(row.quality_score)}</strong></div>
      <div><span>買い時</span><strong>${formatScore(row.technical_score)}</strong></div>
      <div><span>Trap Risk</span><strong>${formatScore(row.value_trap_risk)}</strong></div>
    </div>
    <section><h3>選ばれた理由</h3><ul>${reasons.map(reason => `<li>${escapeHtml(reason)}</li>`).join('') || '<li>総合スコアが上位です。</li>'}</ul></section>
    <section><h3>注意点</h3>${filters.length ? `<ul class="warning-list">${filters.map(reason => `<li>${escapeHtml(reason)}</li>`).join('')}</ul>` : '<p class="safe">現在の自動除外条件を通過しています。</p>'}</section>
    <section><h3>参考情報</h3><dl><div><dt>株価</dt><dd>${yen(row.last_price)}</dd></div><div><dt>20日騰落</dt><dd>${Number.isFinite(Number(row.change_20d)) ? `${(Number(row.change_20d) * 100).toFixed(1)}%` : '–'}</dd></div><div><dt>データ充足率</dt><dd>${formatScore(row.data_completeness)}%</dd></div><div><dt>信頼度</dt><dd>${formatScore(row.confidence)}</dd></div></dl></section>`;
  $('#detailPanel').setAttribute('aria-hidden', 'false');
  $('#backdrop').hidden = false;
}

function closeDetail() { $('#detailPanel').setAttribute('aria-hidden', 'true'); $('#backdrop').hidden = true; }

async function loadLiveRanking() {
  try {
    const response = await fetch(`./live-ranking.json?ts=${Date.now()}`, { cache: 'no-store' });
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    const payload = await response.json();
    if (!Array.isArray(payload.rows) || payload.rows.length < 1) throw new Error('live ranking is empty');
    state.payload = payload;
    state.rows = payload.rows;
    state.rawRows = payload.rows;
    $('#liveState').textContent = '自動抽出済み';
    $('#marketDate').textContent = `${formatDate(payload.market_date)} 時点`;
    $('#sourceLabel').textContent = `${payload.source} · ${payload.scored_count}銘柄を分析`;
    render();
  } catch (error) {
    state.rawRows = structuredClone(demoFundamentals);
    state.rows = scoreRows(state.rawRows);
    $('#liveState').textContent = 'デモ表示';
    $('#marketDate').textContent = '実データ更新を準備中';
    $('#sourceLabel').textContent = '自動取得に失敗したためデモデータを表示しています';
    $('#dataError').hidden = false;
    $('#dataError').textContent = `実データを読み込めませんでした。デモ表示に切り替えました。(${error.message})`;
    render();
  }
}

$('#searchInput').addEventListener('input', event => { state.search = event.target.value; renderTable(); });
$('#fundamentalFile').addEventListener('change', async event => {
  const file = event.target.files[0];
  if (!file) return;
  try {
    const rows = parseCsv(await file.text());
    const symbolColumn = ['symbol', 'code', 'Code', 'ticker', 'Ticker'].find(column => column in rows[0]);
    if (!symbolColumn) throw new Error('symbol、code、Code、tickerのいずれかの列が必要です。');
    state.rawRows = rows;
    state.rows = scoreRows(rows);
    $('#uploadStatus').textContent = `${file.name} の${rows.length}銘柄をブラウザ内で分析しました。`;
    $('#liveState').textContent = 'CSV分析中';
    $('#marketDate').textContent = file.name;
    $('#sourceLabel').textContent = 'このCSVは外部サーバーへ送信されていません';
    render();
    window.scrollTo({ top: 0, behavior: 'smooth' });
  } catch (error) {
    $('#uploadStatus').textContent = `読み込みエラー: ${error.message}`;
  }
});
$('#downloadSample').addEventListener('click', () => {
  const blob = new Blob([`\uFEFF${toCsv(demoFundamentals)}`], { type: 'text/csv;charset=utf-8' });
  const link = document.createElement('a');
  link.href = URL.createObjectURL(blob);
  link.download = 'valuescope-sample.csv';
  link.click();
  URL.revokeObjectURL(link.href);
});
$('#closeDetail').addEventListener('click', closeDetail);
$('#backdrop').addEventListener('click', closeDetail);
document.addEventListener('keydown', event => { if (event.key === 'Escape') closeDetail(); });

loadLiveRanking();
