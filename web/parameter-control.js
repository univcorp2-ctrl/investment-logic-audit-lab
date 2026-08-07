import {
  DEFAULT_PARAMETER_BUNDLE,
  PARAMETER_PRESETS,
  PARAMETER_SCHEMA_VERSION,
  PARAMETER_STORAGE_KEYS,
  applyParameterPreset,
  bundleFromStorage,
  decodeParameterBundle,
  encodeParameterBundle,
  impactPreview,
  normalizeParameterBundle,
  parameterChanges,
  storagePayloads,
  validateParameterBundle,
} from './parameter-control-core.js';

const $ = selector => document.querySelector(selector);
const escapeHtml = value => String(value ?? '').replace(/[&<>"']/g, character => ({
  '&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;',
})[character]);
const clone = value => structuredClone(value);
const getPath = (object, path) => path.split('.').reduce((value, key) => value?.[key], object);
const setPath = (object, path, value) => {
  const keys = path.split('.');
  const last = keys.pop();
  let cursor = object;
  for (const key of keys) {
    if (!cursor[key] || typeof cursor[key] !== 'object') cursor[key] = {};
    cursor = cursor[key];
  }
  cursor[last] = value;
};
const numeric = value => {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : 0;
};

let savedBundle = bundleFromStorage(localStorage);
let draftBundle = clone(savedBundle);
let sourceData = { ranking:{rows:[]}, report:{}, metrics:{}, demo:{positions:[]} };
let activeTab = 'screening';
let importObjectUrl = null;

const TABS = Object.freeze([
  ['screening','スクリーニング'],
  ['fundamental','ファンダメンタル'],
  ['technical','テクニカル'],
  ['risk','リスク上限'],
  ['display','表示'],
  ['management','設定管理'],
]);

const screeningFields = [
  ['screening.minOverall','最低 総合スコア',0,100,1],
  ['screening.minFundamental','最低 Fundamental',0,100,1],
  ['screening.minValue','最低 割安',0,100,1],
  ['screening.minQuality','最低 品質',0,100,1],
  ['screening.minGrowth','最低 成長',0,100,1],
  ['screening.minCompleteness','最低 データ充足率',0,100,1],
  ['screening.minTechnical','最低 Technical',0,100,1],
  ['screening.maxTrap','最大 Value Trap',0,100,1],
  ['screening.minTradingValue','最低 売買代金',0,1000000000000,10000000],
  ['screening.topN','表示上位件数',1,100,1],
];
const fundamentalFields = [
  ['fundamental.minValueScore','最低 割安スコア',0,100,1],
  ['fundamental.minQualityScore','最低 品質スコア',0,100,1],
  ['fundamental.minGrowthScore','最低 成長スコア',0,100,1],
  ['fundamental.maxTrapRisk','最大 Value Trap Risk',0,100,1],
  ['fundamental.minCompleteness','最低 データ充足率',0,100,1],
  ['fundamental.minEarningsYieldPct','最低 利益利回り %',-100,100,.5],
  ['fundamental.minBookToMarketPct','最低 純資産/時価 %',-100,500,1],
  ['fundamental.minFcfYieldPct','最低 FCF利回り %',-100,100,.5],
  ['fundamental.minRoePct','最低 ROE %',-100,100,.5],
  ['fundamental.minOperatingMarginPct','最低 営業利益率 %',-100,100,.5],
  ['fundamental.maxDisclosureAgeDays','最大 開示経過日',1,3650,1],
  ['fundamental.weights.value','ウェイト 割安',0,100,1],
  ['fundamental.weights.quality','ウェイト 品質',0,100,1],
  ['fundamental.weights.growth','ウェイト 成長',0,100,1],
  ['fundamental.weights.trapSafety','ウェイト Trap安全性',0,100,1],
  ['fundamental.weights.completeness','ウェイト データ充足率',0,100,1],
];
const technicalFields = [
  ['screening.minRsi','最低 RSI',0,100,1],
  ['screening.maxRsi','最大 RSI',0,100,1],
  ['screening.minMomentum20','最低 20日Momentum %',-100,100,.5],
  ['screening.minMomentum60','最低 60日Momentum %',-100,100,.5],
  ['screening.maxVolatility','最大 年率Volatility %',0,500,1],
  ['screening.minDrawdown','許容 20日Drawdown %',-100,0,.5],
  ['screening.weights.technical','Technicalウェイト',0,100,1],
];
const riskFields = [
  ['risk.maxPortfolioDrawdownPct','最大 ポートフォリオDD %',.5,50,.5],
  ['risk.maxTotalUnrealizedLossPct','全体 最大含み損率 %',.5,50,.5],
  ['risk.maxTotalUnrealizedLossYen','全体 最大含み損額 円',10000,100000000,10000],
  ['risk.maxPositionLossPct','1銘柄 最大含み損率 %',.5,50,.5],
  ['risk.maxPositionLossYen','1銘柄 最大含み損額 円',10000,50000000,10000],
  ['risk.maxPositionWeightPct','最大 ポジション比率 %',1,100,1],
  ['risk.maxSectorWeightPct','最大 業種比率 %',1,100,1],
];

function numberField([path, label, min, max, step]) {
  const id = `pc-${path.replaceAll('.','-')}`;
  return `<label class="pc-field" for="${id}"><span>${escapeHtml(label)}</span><input id="${id}" data-parameter-path="${path}" type="number" min="${min}" max="${max}" step="${step}" value="${getPath(draftBundle,path)}"><small>${min}〜${max}</small></label>`;
}
function selectField(path, label, options, id = `pc-${path.replaceAll('.','-')}`) {
  const selected = getPath(draftBundle, path);
  return `<label class="pc-field" for="${id}"><span>${escapeHtml(label)}</span><select id="${id}" data-parameter-path="${path}">${options.map(([value,text]) => `<option value="${escapeHtml(value)}" ${String(selected) === String(value) ? 'selected' : ''}>${escapeHtml(text)}</option>`).join('')}</select></label>`;
}
function checkboxField(path, label) {
  const id = `pc-${path.replaceAll('.','-')}`;
  return `<label class="pc-check" for="${id}"><input id="${id}" data-parameter-path="${path}" type="checkbox" ${getPath(draftBundle,path) ? 'checked' : ''}><span>${escapeHtml(label)}</span></label>`;
}
function panelHeader(title, text) {
  return `<div class="pc-panel-heading"><h3>${escapeHtml(title)}</h3><p>${escapeHtml(text)}</p></div>`;
}
function screeningPanel() {
  const markets = [...new Set((sourceData.ranking?.rows ?? []).map(row => row.market).filter(Boolean))].sort();
  const sectors = [...new Set((sourceData.ranking?.rows ?? []).map(row => row.sector).filter(Boolean))].sort();
  return `${panelHeader('銘柄を通過させる基本条件','ランキングの対象・最低スコア・欠損の扱いを調整します。')}<div class="pc-field-grid">${screeningFields.map(numberField).join('')}${selectField('screening.market','市場',[['','すべて'],...markets.map(value=>[value,value])])}${selectField('screening.sector','業種',[['','すべて'],...sectors.map(value=>[value,value])])}${selectField('screening.holding','保有状態',[['all','すべて'],['held','保有中'],['unheld','未保有']])}${selectField('screening.action','現在の判断',[['all','すべて'],['SIM_BUY','買い候補'],['SIM_HOLD','保有継続'],['SIM_SELL','売却候補'],['WATCH','監視'],['NO_DATA','データ不足']])}${selectField('screening.missingPolicy','欠損処理',[['allow','許容'],['neutral','中立50点'],['exclude','除外']])}</div>`;
}
function fundamentalPanel() {
  return `${panelHeader('Fundamental条件と再計算ウェイト','割安・品質・成長・CF・開示鮮度をTechnicalと分けて調整します。')}<div class="pc-field-grid">${fundamentalFields.map(numberField).join('')}${selectField('fundamental.missingPolicy','欠損処理',[['allow','許容'],['neutral','中立50点'],['exclude','除外']])}</div>`;
}
function technicalPanel() {
  return `${panelHeader('Technical確認条件','移動平均、RSI、Momentum、Volatility、Drawdownを調整します。')}<div class="pc-field-grid">${technicalFields.map(numberField).join('')}</div><div class="pc-check-grid">${checkboxField('screening.requirePriceAboveSma20','株価がSMA20を上回ることを必須にする')}${checkboxField('screening.requireSma20AboveSma60','SMA20がSMA60を上回ることを必須にする')}</div>`;
}
function riskPanel() {
  return `${panelHeader('ユーザーの損失・集中上限','この端末の警告と研究比較へ使います。日次デモ運用ルールや実注文を自動変更しません。')}<div class="pc-scope-note"><strong>適用範囲</strong><span>ブラウザ内の警告・スクリーニング比較のみ</span></div><div class="pc-field-grid">${riskFields.map(numberField).join('')}</div>`;
}
function displayPanel() {
  return `${panelHeader('文字と画面密度','変更はすぐ反映され、この端末に保存できます。')}<div class="pc-field-grid">${selectField('display.fontScale','文字サイズ',[['normal','標準'],['large','大きめ'],['xlarge','特大']],'pcFontScale')}${selectField('display.density','余白・密度',[['comfortable','標準'],['compact','コンパクト']],'pcDensity')}${selectField('display.contrast','コントラスト',[['normal','標準'],['high','強調']],'pcContrast')}</div><div class="pc-check-grid">${checkboxField('display.reducedMotion','アニメーションを減らす')}</div><div class="pc-font-preview"><span>表示例</span><strong>東京エレクトロン　総合 78.9</strong><p>現在値、Fundamental、Technical、損益理由を読みやすい大きさで確認します。</p><small>最終更新 2026/08/08 16:15</small></div>`;
}
function managementPanel() {
  const changes = parameterChanges(savedBundle,draftBundle);
  return `${panelHeader('設定の保存・共有','設定JSONにはAPIキー、株価データ、認証情報を含めません。')}<div class="pc-management-grid"><article><span>schema</span><strong>v${PARAMETER_SCHEMA_VERSION}</strong></article><article><span>現在のプリセット</span><strong>${escapeHtml(PARAMETER_PRESETS[draftBundle.preset]?.label ?? 'カスタム')}</strong></article><article><span>未保存の変更</span><strong>${changes.length}</strong></article></div><div class="pc-change-list">${changes.slice(0,12).map(change=>`<p><code>${escapeHtml(change.key)}</code><span>${escapeHtml(change.before)} → ${escapeHtml(change.after)}</span></p>`).join('') || '<p>未保存の変更はありません。</p>'}</div><div class="pc-management-actions"><button id="pcExport" class="button ghost" type="button">設定JSONを出力</button><label class="button ghost pc-import">設定JSONを読込<input id="pcImport" type="file" accept="application/json"></label><button id="pcShare" class="button ghost" type="button">共有URLをコピー</button><button id="pcReset" class="button danger" type="button">すべて初期値へ</button></div><div id="pcImportError" class="pc-message error" role="alert" hidden></div><div id="pcManagementStatus" class="pc-message" aria-live="polite"></div>`;
}
function tabContent(tab) {
  return ({ screening:screeningPanel, fundamental:fundamentalPanel, technical:technicalPanel, risk:riskPanel, display:displayPanel, management:managementPanel })[tab]?.() ?? screeningPanel();
}

function waitForScreeningLab(timeoutMs = 12000) {
  const existing = $('#screeningLab');
  if (existing) return Promise.resolve(existing);
  return new Promise(resolve => {
    const timer = setTimeout(() => { observer.disconnect(); resolve($('.ranking') ?? $('main')); }, timeoutMs);
    const observer = new MutationObserver(() => {
      const node = $('#screeningLab');
      if (!node) return;
      clearTimeout(timer); observer.disconnect(); resolve(node);
    });
    observer.observe(document.documentElement,{childList:true,subtree:true});
  });
}

function inject(host) {
  if ($('#parameterControl')) return $('#parameterControl');
  const panel = document.createElement('section');
  panel.id = 'parameterControl';
  panel.className = 'parameter-control adaptive-ordered';
  panel.style.setProperty('--adaptive-order','29');
  panel.innerHTML = `<div class="pc-header"><div><p class="eyebrow">PARAMETER CONTROL CENTER</p><h2>パラメータコントロール</h2><p>スクリーニング、Fundamental、Technical、リスク、表示を一か所で管理します。</p></div><div class="pc-save-state"><span id="pcDirty" class="clean">保存済み</span><button id="pcSave" class="button primary" type="button">設定を保存</button></div></div><div class="pc-presets" aria-label="設定プリセット">${Object.entries(PARAMETER_PRESETS).map(([key,preset])=>`<button type="button" data-parameter-preset="${key}" title="${escapeHtml(preset.description)}"><strong>${escapeHtml(preset.label)}</strong><span>${escapeHtml(preset.description)}</span></button>`).join('')}</div><div class="pc-tabs" role="tablist" aria-label="パラメータ分類">${TABS.map(([key,label],index)=>`<button type="button" role="tab" data-parameter-tab="${key}" aria-selected="${index===0}">${escapeHtml(label)}</button>`).join('')}</div><div id="pcPanel" class="pc-panel" role="tabpanel"></div><aside class="pc-impact" aria-label="変更影響プレビュー"><div><span>条件通過</span><strong id="pcImpactIncluded">–</strong><small id="pcImpactUniverse">データ読込中</small></div><div><span>Fundamental通過</span><strong id="pcImpactFundamental">–</strong><small>詳細条件を反映</small></div><div><span>リスク上限違反</span><strong id="pcImpactRisk">–</strong><small id="pcImpactRiskState">確認中</small></div><div class="pc-no-order"><strong>実注文なし</strong><span>画面分析・警告・研究設定だけを変更します。</span></div></aside>`;
  if (host?.id === 'screeningLab') host.before(panel); else host?.prepend?.(panel);
  const anchor = $('#screeningSection');
  if (anchor && anchor.nextElementSibling !== panel) panel.before(anchor);
  bind(panel);
  render();
  addQuickLink();
  return panel;
}

function bind(panel) {
  panel.addEventListener('click', event => {
    const tab = event.target.closest('[data-parameter-tab]');
    if (tab) { activeTab = tab.dataset.parameterTab; render(); return; }
    const preset = event.target.closest('[data-parameter-preset]');
    if (preset) { draftBundle = applyParameterPreset(preset.dataset.parameterPreset,draftBundle); applyDisplay(); render(); return; }
  });
  panel.addEventListener('input', event => {
    const control = event.target.closest('[data-parameter-path]');
    if (!control) return;
    const value = control.type === 'checkbox' ? control.checked : control.type === 'number' ? numeric(control.value) : control.value;
    setPath(draftBundle,control.dataset.parameterPath,value);
    draftBundle.preset = 'custom';
    applyDisplay();
    updateDirty();
    updateImpact();
  });
  $('#pcSave')?.addEventListener('click',save);
}

function bindPanelActions() {
  $('#pcExport')?.addEventListener('click',exportSettings);
  $('#pcImport')?.addEventListener('change',importSettings);
  $('#pcShare')?.addEventListener('click',shareSettings);
  $('#pcReset')?.addEventListener('click',resetAll);
}

function render() {
  const panel = $('#pcPanel');
  if (!panel) return;
  document.querySelectorAll('[data-parameter-tab]').forEach(button=>button.setAttribute('aria-selected',String(button.dataset.parameterTab===activeTab)));
  document.querySelectorAll('[data-parameter-preset]').forEach(button=>button.classList.toggle('active',button.dataset.parameterPreset===draftBundle.preset));
  panel.innerHTML = tabContent(activeTab);
  bindPanelActions();
  updateDirty();
  updateImpact();
}

function updateDirty() {
  const dirty = parameterChanges(savedBundle,draftBundle).length > 0;
  const node = $('#pcDirty');
  if (!node) return;
  node.textContent = dirty ? '未保存' : '保存済み';
  node.className = dirty ? 'dirty' : 'clean';
}

function applyDisplay() {
  const display = draftBundle.display;
  document.documentElement.dataset.fontScale = display.fontScale;
  document.documentElement.dataset.displayDensity = display.density;
  document.documentElement.dataset.displayContrast = display.contrast;
  document.documentElement.dataset.reduceMotion = String(display.reducedMotion);
}

function writeStorage(bundle) {
  for (const [key,value] of Object.entries(storagePayloads(bundle))) {
    if ([PARAMETER_STORAGE_KEYS.density,PARAMETER_STORAGE_KEYS.fontScale].includes(key)) localStorage.setItem(key,String(value));
    else localStorage.setItem(key,JSON.stringify(value));
  }
}

function setLegacyValue(selector,value,type='value') {
  const control = $(selector);
  if (!control) return;
  if (type === 'checked') control.checked = Boolean(value); else control.value = String(value ?? '');
}
function syncLegacyControls() {
  const s=draftBundle.screening,f=draftBundle.fundamental,r=draftBundle.risk;
  const screeningMap={slMinOverall:s.minOverall,slMinFundamental:s.minFundamental,slMinValue:s.minValue,slMinQuality:s.minQuality,slMinGrowth:s.minGrowth,slMinCompleteness:s.minCompleteness,slMinTechnical:s.minTechnical,slMaxTrap:s.maxTrap,slMinRsi:s.minRsi,slMaxRsi:s.maxRsi,slMinMomentum20:s.minMomentum20,slMinMomentum60:s.minMomentum60,slMaxVolatility:s.maxVolatility,slMinDrawdown:s.minDrawdown,slHolding:s.holding,slAction:s.action,slMissing:s.missingPolicy,slTopN:s.topN,slMarket:s.market,slSector:s.sector,slWeightFundamental:s.weights.fundamental,slWeightValue:s.weights.value,slWeightQuality:s.weights.quality,slWeightGrowth:s.weights.growth,slWeightTechnical:s.weights.technical,slWeightLiquidity:s.weights.liquidity,slWeightTrap:s.weights.trapPenalty};
  for(const[id,value]of Object.entries(screeningMap))setLegacyValue(`#${id}`,value);
  setLegacyValue('#slPriceAbove',s.requirePriceAboveSma20,'checked');setLegacyValue('#slSmaTrend',s.requireSma20AboveSma60,'checked');
  $('#slMinOverall')?.dispatchEvent(new Event('input',{bubbles:true}));
  const fundamentalMap={ftValue:f.minValueScore,ftQuality:f.minQualityScore,ftGrowth:f.minGrowthScore,ftTrap:f.maxTrapRisk,ftCompleteness:f.minCompleteness,ftEarnings:f.minEarningsYieldPct,ftBook:f.minBookToMarketPct,ftFcf:f.minFcfYieldPct,ftRoe:f.minRoePct,ftMargin:f.minOperatingMarginPct,ftDisclosure:f.maxDisclosureAgeDays,ftMissing:f.missingPolicy,ftWeightValue:f.weights.value,ftWeightQuality:f.weights.quality,ftWeightGrowth:f.weights.growth,ftWeightTrap:f.weights.trapSafety,ftWeightCompleteness:f.weights.completeness};
  for(const[id,value]of Object.entries(fundamentalMap))setLegacyValue(`#${id}`,value);
  $('#ftValue')?.dispatchEvent(new Event('input',{bubbles:true}));
  const riskMap={rdMaxDd:r.maxPortfolioDrawdownPct,rdTotalPct:r.maxTotalUnrealizedLossPct,rdTotalYen:r.maxTotalUnrealizedLossYen,rdPosPct:r.maxPositionLossPct,rdPosYen:r.maxPositionLossYen,rdWeight:r.maxPositionWeightPct};
  for(const[id,value]of Object.entries(riskMap))setLegacyValue(`#${id}`,value);
  $('#rdSave')?.click();
}

function save() {
  const normalized = normalizeParameterBundle(draftBundle);
  draftBundle = clone(normalized);
  writeStorage(draftBundle);
  applyDisplay();
  syncLegacyControls();
  savedBundle = clone(draftBundle);
  window.dispatchEvent(new CustomEvent('valuescope:parameters-changed',{detail:clone(draftBundle)}));
  const status=$('#pcManagementStatus');if(status){status.textContent='設定をこの端末に保存し、既存の条件画面へ反映しました。';status.className='pc-message success';}
  render();
}

function resetAll() {
  draftBundle = clone(DEFAULT_PARAMETER_BUNDLE);
  draftBundle.preset='balanced';
  applyDisplay();render();
  const status=$('#pcManagementStatus');if(status)status.textContent='初期値を表示しています。「設定を保存」で確定します。';
}

function download(content,name,type) {
  if(importObjectUrl)URL.revokeObjectURL(importObjectUrl);
  const blob=new Blob([content],{type});importObjectUrl=URL.createObjectURL(blob);const link=document.createElement('a');link.href=importObjectUrl;link.download=name;link.click();setTimeout(()=>{URL.revokeObjectURL(importObjectUrl);importObjectUrl=null;},1000);
}
function exportSettings() {
  download(JSON.stringify(normalizeParameterBundle(draftBundle),null,2),'valuescope-parameters-v1.json','application/json');
}
async function importSettings(event) {
  const file=event.target.files?.[0];if(!file)return;const error=$('#pcImportError');
  try{const parsed=JSON.parse(await file.text());const result=validateParameterBundle(parsed);if(!result.valid)throw new Error(result.errors.join(' '));draftBundle=clone(result.value);applyDisplay();render();const status=$('#pcManagementStatus');if(status){status.textContent='設定JSONを読み込みました。「設定を保存」で確定します。';status.className='pc-message success';}}
  catch(importError){if(error){error.hidden=false;error.textContent=`設定JSONを読み込めません: ${importError.message}`;}}
  finally{event.target.value='';}
}
async function shareSettings() {
  const encoded=encodeParameterBundle(draftBundle);const url=new URL(location.href);url.hash=`parameters=${encoded}`;
  try{await navigator.clipboard.writeText(url.toString());const status=$('#pcManagementStatus');if(status){status.textContent='共有URLをクリップボードへコピーしました。';status.className='pc-message success';}}
  catch{history.replaceState(null,'',url);const status=$('#pcManagementStatus');if(status)status.textContent='共有URLをアドレス欄へ反映しました。';}
}

async function loadSourceData() {
  const data=window.ValueScopeData;
  try{
    const [ranking,report,metrics,demo]=await Promise.all([
      data?.getRanking?.()??fetch('./jquants-ranking.json').then(response=>response.json()),
      data?.getDailyReport?.()??fetch('./data/paper-trading/latest-report.json').then(response=>response.json()),
      data?.getPerformanceMetrics?.()??fetch('./data/paper-trading/performance-metrics.json').then(response=>response.json()),
      data?.getDemoPortfolio?.()??fetch('./demo-portfolio.json').then(response=>response.json()),
    ]);
    sourceData={ranking:ranking??{rows:[]},report:report??{},metrics:metrics??{},demo:demo??{positions:[]}};
  }catch{sourceData={ranking:{rows:[]},report:{},metrics:{},demo:{positions:[]}};}
  render();
}

function updateImpact() {
  const result=impactPreview(draftBundle,sourceData.ranking,sourceData.report,sourceData.metrics,sourceData.demo);
  if($('#pcImpactIncluded'))$('#pcImpactIncluded').textContent=result.available?result.screeningIncluded:'–';
  if($('#pcImpactUniverse'))$('#pcImpactUniverse').textContent=result.available?`母集団 ${result.universeCount} / 除外 ${result.screeningExcluded}`:'分析データ待ち';
  if($('#pcImpactFundamental'))$('#pcImpactFundamental').textContent=result.available?result.fundamentalIncluded:'–';
  if($('#pcImpactRisk'))$('#pcImpactRisk').textContent=result.available?result.riskBreaches:'–';
  if($('#pcImpactRiskState'))$('#pcImpactRiskState').textContent=result.available?`状態 ${result.riskStatus}`:'確認待ち';
}

function addQuickLink() {
  const install=()=>{const host=$('#overviewSection .adaptive-overview-heading')??$('#overviewSection');if(!host||$('#parameterQuickLink'))return false;const button=document.createElement('button');button.id='parameterQuickLink';button.type='button';button.className='button ghost pc-quick-link';button.textContent='パラメータを調整';button.addEventListener('click',()=>{document.querySelector('[data-adaptive-target="screening"]')?.click();setTimeout(()=>$('#parameterControl')?.scrollIntoView({behavior:'smooth',block:'start'}),50);});host.append(button);return true;};if(!install()){const observer=new MutationObserver(()=>{if(install())observer.disconnect();});observer.observe(document.documentElement,{childList:true,subtree:true});setTimeout(()=>observer.disconnect(),10000);}}

function readSharedHash() {
  const match=location.hash.match(/(?:^#|&)parameters=([^&]+)/);if(!match)return;const result=decodeParameterBundle(match[1]);if(result.valid){draftBundle=clone(result.value);applyDisplay();}else{setTimeout(()=>{const error=$('#pcImportError');if(error){error.hidden=false;error.textContent=result.errors.join(' ');}},0);}}

async function start() {
  readSharedHash();applyDisplay();const host=await waitForScreeningLab();inject(host);await loadSourceData();
}
if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',start,{once:true});else start();
