import { finiteMetric, labVerdict, strategyRowsToCsv } from './strategy-lab-view-core.js';

const $ = selector => document.querySelector(selector);
const esc = value => String(value ?? '').replace(/[&<>'"]/g, char => ({'&':'&amp;','<':'&lt;','>':'&gt;',"'":'&#39;','"':'&quot;'}[char]));
const number = (value,digits=2) => finiteMetric(value) === null ? '–' : Number(value).toFixed(digits);
const percent = value => finiteMetric(value) === null ? '–' : `${Number(value)>=0?'+':''}${Number(value).toFixed(2)}%`;
let payload = null;

function installTab() {
  const tabs = document.querySelector('.dr-tabs');
  if (!tabs || tabs.querySelector('[data-tab="strategy"]')) return;
  const button = document.createElement('button');
  button.type='button'; button.dataset.tab='strategy'; button.setAttribute('role','tab'); button.setAttribute('aria-selected','false'); button.textContent='戦略ラボ';
  button.addEventListener('click', show);
  tabs.append(button);
}
function download() {
  if (!payload) return;
  const blob=new Blob([`\uFEFF${strategyRowsToCsv(payload)}`],{type:'text/csv;charset=utf-8'}),link=document.createElement('a');
  link.href=URL.createObjectURL(blob); link.download='valuescope-strategy-lab.csv'; link.click(); URL.revokeObjectURL(link.href);
}
function projectComparison() {
  return `<div class="ql-projects"><article><span>採用</span><h4>vectorbt 1.1</h4><p>大量比較とwalk-forwardの任意検証エンジン。ライセンスはApache 2.0 with Commons Clause。</p></article><article><span>設計参考</span><h4>Microsoft Qlib</h4><p>実験manifestを参考。日本株custom dataと重いML依存が必要なため直接導入していません。</p></article><article><span>未導入</span><h4>bt</h4><p>再利用可能なリバランス基盤ですが、既存バックテストと機能が重複します。</p></article></div>`;
}
function render() {
  const body=$('#drBody');
  if (!body) return;
  if (!payload) { body.innerHTML='<p class="dr-empty">戦略ラボ結果を読み込めません。週次ワークフローを実行してください。</p>'; return; }
  const verdict=labVerdict(payload);
  const strategies=(payload.strategies??[]).map(row=>`<article class="ql-card"><header><h4>${esc(row.name)}</h4><span class="${row.metrics?.status==='ok'?'ok':'warn'}">${esc(row.metrics?.status??'unknown')}</span></header><div class="ql-metrics"><div><span>期間収益</span><b>${percent(row.metrics?.total_return_pct)}</b></div><div><span>Baseline差</span><b>${percent(row.baseline_excess_pct)}</b></div><div><span>Sharpe</span><b>${number(row.metrics?.sharpe)}</b></div><div><span>最大DD</span><b>${percent(row.metrics?.max_drawdown_pct)}</b></div><div><span>観測数</span><b>${row.metrics?.observations??0}</b></div><div><span>回転率</span><b>${number(row.metrics?.turnover)}</b></div></div></article>`).join('');
  body.innerHTML=`<div class="ql-head"><div><p class="eyebrow">OPEN-SOURCE RESEARCH</p><h3>戦略比較ラボ</h3><p>Fundamental cutoff ${esc(payload.fundamental_cutoff)} 以後だけを評価し、手数料5bps＋slippage2bps、次営業日約定で比較します。</p></div><button id="qlCsv" class="button ghost">比較CSV</button></div><div class="ql-verdict ${verdict.tone}"><strong>${esc(verdict.title)}</strong><p>${esc(verdict.message)}</p></div><div class="ql-overview"><article><span>評価期間</span><b>${esc(payload.evaluation_start)}<br>${esc(payload.evaluation_end)}</b></article><article><span>観測数</span><b>${payload.observations??0}</b></article><article><span>Walk-forward</span><b>${esc(payload.walk_forward?.status??'–')}</b></article><article><span>Engine</span><b>${esc(payload.engine?.vectorbt?.available?'vectorbt + pandas':'pandas fallback')}</b></article></div><div class="ql-grid">${strategies}</div>${projectComparison()}<div class="ql-warnings"><strong>検証上の注意</strong><ul>${(payload.warnings??[]).map(item=>`<li>${esc(item)}</li>`).join('')}</ul><p>${esc(payload.disclaimer)}</p></div>`;
  $('#qlCsv')?.addEventListener('click',download);
}
async function show() {
  document.querySelectorAll('.dr-tabs button').forEach(button=>button.setAttribute('aria-selected',String(button.dataset.tab==='strategy')));
  if (!payload) { try { const response=await fetch(`./data/strategy-lab/latest.json?ts=${Date.now()}`,{cache:'no-store'}); if(response.ok) payload=await response.json(); } catch { payload=null; } }
  render();
}
function init(){installTab()}
if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',init);else init();
