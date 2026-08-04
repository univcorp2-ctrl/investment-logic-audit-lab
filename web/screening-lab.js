import { DEFAULT_SCREENING_CONFIG, SCREENING_PRESETS, applyPreset, decodeConfig, encodeConfig, mergeScreeningData, screenRecords, screeningRowsToCsv } from './screening-lab-core.js';

const STORAGE_KEY = 'valuescope-screening-lab-v1';
const $ = selector => document.querySelector(selector);
const esc = value => String(value ?? '').replace(/[&<>'"]/g, char => ({'&':'&amp;','<':'&lt;','>':'&gt;',"'":'&#39;','"':'&quot;'}[char]));
const score = value => Number.isFinite(Number(value)) ? Number(value).toFixed(1) : '–';
let records = [];
let config = structuredClone(DEFAULT_SCREENING_CONFIG);
let result = { included:[], excluded:[], evaluated:[] };

function field(label, id, min, max, step = 1) {
  return `<label class="sl-field"><span>${label} <b data-value-for="${id}"></b></span><input id="${id}" type="range" min="${min}" max="${max}" step="${step}"></label>`;
}
function select(label, id, options) {
  return `<label class="sl-field"><span>${label}</span><select id="${id}">${options.map(([value,text]) => `<option value="${esc(value)}">${esc(text)}</option>`).join('')}</select></label>`;
}
function inject() {
  if ($('#screeningLab')) return;
  const anchor = $('.ranking') ?? $('.filters');
  if (!anchor) return;
  const section = document.createElement('section');
  section.id = 'screeningLab';
  section.className = 'screening-lab';
  section.innerHTML = `<div class="sl-head"><div><p class="eyebrow">USER-CONTROLLED RESEARCH</p><h2>条件スクリーナー</h2><p>J-Quantsランキングと日次Technicalをブラウザ内で再評価します。設定や結果は外部送信されません。</p></div><div class="sl-actions"><button id="slReset" class="button ghost">リセット</button><button id="slExport" class="button ghost">設定JSON</button><label class="button ghost sl-import">読込<input id="slImport" type="file" accept="application/json"></label><button id="slCsv" class="button primary">結果CSV</button></div></div><div class="sl-layout"><aside class="sl-controls"><div class="sl-presets">${Object.entries(SCREENING_PRESETS).map(([key,item]) => `<button data-preset="${key}">${esc(item.label)}</button>`).join('')}</div><details open><summary>基本スコア</summary><div class="sl-control-grid">${field('最低 総合','slMinOverall',0,100)}${field('最低 Fundamental','slMinFundamental',0,100)}${field('最低 割安','slMinValue',0,100)}${field('最低 品質','slMinQuality',0,100)}${field('最低 成長','slMinGrowth',0,100)}${field('最低 充足率','slMinCompleteness',0,100)}${field('最低 Technical','slMinTechnical',0,100)}${field('最大 Trap','slMaxTrap',0,100)}</div></details><details><summary>テクニカル条件</summary><div class="sl-control-grid">${field('最低 RSI','slMinRsi',0,100)}${field('最大 RSI','slMaxRsi',0,100)}${field('最低 20日Mom','slMinMomentum20',-50,50,.5)}${field('最低 60日Mom','slMinMomentum60',-80,80,.5)}${field('最大 Vol','slMaxVolatility',10,200,1)}${field('最小 Drawdown','slMinDrawdown',-50,0,.5)}<label class="sl-check"><input id="slPriceAbove" type="checkbox">株価 &gt; SMA20</label><label class="sl-check"><input id="slSmaTrend" type="checkbox">SMA20 &gt; SMA60</label></div></details><details><summary>対象・欠損</summary><div class="sl-control-grid">${select('市場','slMarket',[['','すべて']])}${select('業種','slSector',[['','すべて']])}${select('保有','slHolding',[['all','すべて'],['held','保有中'],['unheld','未保有']])}${select('判断','slAction',[['all','すべて'],['SIM_BUY','買い候補'],['SIM_HOLD','保有継続'],['SIM_SELL','売却候補'],['WATCH','監視'],['NO_DATA','データ不足']])}${select('欠損処理','slMissing',[['allow','許容'],['neutral','中立50点'],['exclude','除外']])}${select('上位件数','slTopN',[[5,'5'],[10,'10'],[20,'20'],[50,'50']])}</div></details><details><summary>再計算ウェイト</summary><div class="sl-control-grid">${field('Fundamental','slWeightFundamental',0,50)}${field('割安','slWeightValue',0,50)}${field('品質','slWeightQuality',0,50)}${field('成長','slWeightGrowth',0,50)}${field('Technical','slWeightTechnical',0,50)}${field('流動性','slWeightLiquidity',0,50)}${field('Trap安全性','slWeightTrap',0,50)}</div></details></aside><div class="sl-results"><div class="sl-summary"><article><span>条件通過</span><strong id="slIncluded">0</strong></article><article><span>除外</span><strong id="slExcluded">0</strong></article><article><span>母集団</span><strong id="slTotal">0</strong></article><article><span>プリセット</span><strong id="slPreset">–</strong></article></div><div id="delayedPerformance" class="sl-delay-card"><p>遅延データ検証を取得しています。</p></div><div id="slCards" class="sl-cards"></div><details class="sl-excluded"><summary>除外理由を見る</summary><div id="slExcludedList"></div></details></div></div>`;
  anchor.before(section);
  bind();
}
function unique(fieldName) { return [...new Set(records.map(item => item[fieldName]).filter(Boolean))].sort((a,b) => String(a).localeCompare(String(b),'ja')); }
function populateSelect(id, values) { const element = $(id); const current = element.value; element.innerHTML = '<option value="">すべて</option>' + values.map(value => `<option value="${esc(value)}">${esc(value)}</option>`).join(''); element.value = values.includes(current) ? current : ''; }
function mapControls() {
  const pairs = {
    slMinOverall:'minOverall',slMinFundamental:'minFundamental',slMinValue:'minValue',slMinQuality:'minQuality',slMinGrowth:'minGrowth',slMinCompleteness:'minCompleteness',slMinTechnical:'minTechnical',slMaxTrap:'maxTrap',slMinRsi:'minRsi',slMaxRsi:'maxRsi',slMinMomentum20:'minMomentum20',slMinMomentum60:'minMomentum60',slMaxVolatility:'maxVolatility',slMinDrawdown:'minDrawdown',slHolding:'holding',slAction:'action',slMissing:'missingPolicy',slTopN:'topN',slMarket:'market',slSector:'sector'};
  for (const [id,key] of Object.entries(pairs)) { const el = $(`#${id}`); if (el) el.value = String(config[key]); }
  $('#slPriceAbove').checked = config.requirePriceAboveSma20;
  $('#slSmaTrend').checked = config.requireSma20AboveSma60;
  const weights = {slWeightFundamental:'fundamental',slWeightValue:'value',slWeightQuality:'quality',slWeightGrowth:'growth',slWeightTechnical:'technical',slWeightLiquidity:'liquidity',slWeightTrap:'trapPenalty'};
  for (const [id,key] of Object.entries(weights)) $(`#${id}`).value = String(config.weights[key]);
  document.querySelectorAll('[data-value-for]').forEach(node => { const input = $(`#${node.dataset.valueFor}`); node.textContent = input?.value ?? ''; });
}
function readControls() {
  const value = id => Number($(`#${id}`).value);
  config = {...config,minOverall:value('slMinOverall'),minFundamental:value('slMinFundamental'),minValue:value('slMinValue'),minQuality:value('slMinQuality'),minGrowth:value('slMinGrowth'),minCompleteness:value('slMinCompleteness'),minTechnical:value('slMinTechnical'),maxTrap:value('slMaxTrap'),minRsi:value('slMinRsi'),maxRsi:value('slMaxRsi'),minMomentum20:value('slMinMomentum20'),minMomentum60:value('slMinMomentum60'),maxVolatility:value('slMaxVolatility'),minDrawdown:value('slMinDrawdown'),requirePriceAboveSma20:$('#slPriceAbove').checked,requireSma20AboveSma60:$('#slSmaTrend').checked,market:$('#slMarket').value,sector:$('#slSector').value,holding:$('#slHolding').value,action:$('#slAction').value,missingPolicy:$('#slMissing').value,topN:Number($('#slTopN').value),weights:{fundamental:value('slWeightFundamental'),value:value('slWeightValue'),quality:value('slWeightQuality'),growth:value('slWeightGrowth'),technical:value('slWeightTechnical'),liquidity:value('slWeightLiquidity'),trapPenalty:value('slWeightTrap')}};
}
function render() {
  result = screenRecords(records, config);
  $('#slIncluded').textContent = result.included.length;
  $('#slExcluded').textContent = result.excluded.length;
  $('#slTotal').textContent = records.length;
  $('#slPreset').textContent = SCREENING_PRESETS[config.preset]?.label ?? 'カスタム';
  $('#slCards').innerHTML = result.included.map((item,index) => `<article class="sl-card"><header><span>${index+1}</span><div><h3>${esc(item.company_name)}</h3><small>${esc(item.code)} · ${esc(item.market)} · ${esc(item.sector)}</small></div><strong>${score(item.lab_score)}</strong></header><div class="sl-pillars"><div><span>Fundamental</span><b>${score(item.fundamental_score)}</b></div><div><span>Technical</span><b>${score(item.technical_score)}</b></div><div><span>Value</span><b>${score(item.value_score)}</b></div><div><span>Quality</span><b>${score(item.quality_score)}</b></div><div><span>Trap</span><b>${score(item.value_trap_risk)}</b></div><div><span>RSI</span><b>${score(item.rsi14)}</b></div></div><footer><span>${esc(item.action)}</span><small>${item.missing.length ? `欠損: ${item.missing.join(', ')}` : '主要欠損なし'}</small></footer></article>`).join('') || '<p class="sl-empty">現在の条件を通過する銘柄はありません。</p>';
  $('#slExcludedList').innerHTML = result.excluded.slice(0,50).map(item => `<p><strong>${esc(item.company_name)} (${esc(item.code)})</strong><span>${esc(item.exclusion_reasons.join(' / '))}</span></p>`).join('') || '<p>除外なし</p>';
  localStorage.setItem(STORAGE_KEY, JSON.stringify(config));
  const encoded = encodeConfig(config); history.replaceState(null,'',`${location.pathname}${location.search}#screen=${encoded}`);
  mapControls();
}
function download(content, name, type) { const blob = new Blob([content],{type}); const link = document.createElement('a'); link.href=URL.createObjectURL(blob); link.download=name; link.click(); URL.revokeObjectURL(link.href); }
function bind() {
  $('#screeningLab').addEventListener('input', event => { if (event.target.matches('input,select')) { config.preset='custom'; readControls(); render(); } });
  document.querySelectorAll('[data-preset]').forEach(button => button.addEventListener('click', () => { config = applyPreset(button.dataset.preset, config); mapControls(); render(); }));
  $('#slReset').addEventListener('click', () => { config=structuredClone(DEFAULT_SCREENING_CONFIG); mapControls(); render(); });
  $('#slExport').addEventListener('click', () => download(JSON.stringify(config,null,2),'valuescope-screening-config.json','application/json'));
  $('#slCsv').addEventListener('click', () => download(`\uFEFF${screeningRowsToCsv(result.included)}`,'valuescope-screening-results.csv','text/csv;charset=utf-8'));
  $('#slImport').addEventListener('change', async event => { const file=event.target.files?.[0]; if (!file) return; try { config={...structuredClone(DEFAULT_SCREENING_CONFIG),...JSON.parse(await file.text())}; mapControls(); render(); } catch { alert('設定JSONを読み込めませんでした。'); } });
}
async function loadDelayedPerformance() {
  try {
    const response = await fetch('/api/portfolio-status?offset=0&limit=10',{cache:'no-store'});
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    const text = await response.text();
    const total = text.split('\n').find(line => line.startsWith('total\t'))?.split('\t') ?? [];
    const generated = text.split('\n').find(line => line.startsWith('generated_at\t'))?.split('\t')[1];
    const entry=Number(total[1]),current=Number(total[2]),pnl=Number(total[3]),returnPct=Number(total[4]),wins=Number(total[5]),losses=Number(total[6]);
    $('#delayedPerformance').innerHTML = `<div><p class="eyebrow">DELAYED-DATA CHECK</p><h3>12週間遅延データで選定した場合</h3><small>Fundamental cutoff 2026-05-11 · 2026-08-03後場に各100株のデモ取得</small></div><div class="sl-delay-metrics"><span>取得 <b>¥${entry.toLocaleString('ja-JP')}</b></span><span>評価 <b>¥${current.toLocaleString('ja-JP')}</b></span><span>損益 <b class="${pnl>=0?'up':'down'}">${pnl>=0?'+':''}¥${pnl.toLocaleString('ja-JP')}</b></span><span>収益率 <b>${returnPct>=0?'+':''}${returnPct.toFixed(3)}%</b></span><span>勝敗 <b>${wins}勝 ${losses}敗</b></span></div><p class="sl-confidence">経過が5営業日未満のため、統計的な優位性は評価できません。市場開始前は前営業日の最新validated quoteです。更新 ${esc(generated??'–')}</p>`;
  } catch (error) { $('#delayedPerformance').innerHTML=`<p>遅延データ検証を取得できません: ${esc(error.message)}</p>`; }
}
async function start() {
  inject();
  const saved = JSON.parse(localStorage.getItem(STORAGE_KEY) || 'null');
  const hash = location.hash.match(/screen=([^&]+)/)?.[1];
  config = {...structuredClone(DEFAULT_SCREENING_CONFIG), ...(decodeConfig(hash??'') ?? saved ?? {})};
  const [rankingResponse, reportResponse] = await Promise.all([fetch('./jquants-ranking.json',{cache:'no-store'}),fetch('./data/paper-trading/latest-report.json',{cache:'no-store'})]);
  const [ranking,report] = await Promise.all([rankingResponse.json(),reportResponse.ok?reportResponse.json():{}]);
  records = mergeScreeningData(ranking, report);
  populateSelect('#slMarket', unique('market')); populateSelect('#slSector', unique('sector')); mapControls(); render(); loadDelayedPerformance();
}
start().catch(error => { inject(); $('#slCards').innerHTML=`<p class="sl-empty">条件スクリーナーを開始できません: ${esc(error.message)}</p>`; });
