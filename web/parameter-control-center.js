import {
  DEFAULT_UI_PREFERENCES,
  FONT_SCALES,
  PARAMETER_PRESETS,
  PARAMETER_STORAGE_KEYS,
  applyParameterPreset,
  defaultParameterBundle,
  fontSizePx,
  getPath,
  normalizeParameterBundle,
  parameterWarnings,
  parseParameterBundle,
  serializeParameterBundle,
  setPath,
} from './parameter-control-center-core.js';

const $ = selector => document.querySelector(selector);
const escapeHtml = value => String(value ?? '').replace(/[&<>'"]/g, character => ({
  '&':'&amp;','<':'&lt;','>':'&gt;',"'":'&#39;','"':'&quot;',
})[character]);
let bundle = loadBundle();
let dirty = false;

function safeParse(key) {
  try { return JSON.parse(localStorage.getItem(key) ?? 'null'); } catch { return null; }
}

function loadBundle() {
  const central = safeParse(PARAMETER_STORAGE_KEYS.bundle);
  if (central) return normalizeParameterBundle(central);
  return normalizeParameterBundle({
    ...defaultParameterBundle(),
    screening: safeParse(PARAMETER_STORAGE_KEYS.screening) ?? undefined,
    fundamental: safeParse(PARAMETER_STORAGE_KEYS.fundamental) ?? undefined,
    risk: safeParse(PARAMETER_STORAGE_KEYS.risk) ?? undefined,
    ui: safeParse(PARAMETER_STORAGE_KEYS.ui) ?? DEFAULT_UI_PREFERENCES,
  });
}

function pairedField({ label, path, id, min, max, step = 1, unit = '', help = '' }) {
  return `<label class="pcc-field" for="${id}Number"><span><b>${escapeHtml(label)}</b>${help ? `<small>${escapeHtml(help)}</small>` : ''}</span><div class="pcc-paired"><input id="${id}Range" data-path="${path}" data-pair="${id}" type="range" min="${min}" max="${max}" step="${step}"><input id="${id}Number" data-path="${path}" data-pair="${id}" type="number" min="${min}" max="${max}" step="${step}"><em>${escapeHtml(unit)}</em></div></label>`;
}

function selectField({ label, path, id, options, help = '' }) {
  return `<label class="pcc-field" for="${id}"><span><b>${escapeHtml(label)}</b>${help ? `<small>${escapeHtml(help)}</small>` : ''}</span><select id="${id}" data-path="${path}">${options.map(([value, text]) => `<option value="${escapeHtml(value)}">${escapeHtml(text)}</option>`).join('')}</select></label>`;
}

function checkboxField({ label, path, id, help = '' }) {
  return `<label class="pcc-check" for="${id}"><input id="${id}" data-path="${path}" type="checkbox"><span><b>${escapeHtml(label)}</b>${help ? `<small>${escapeHtml(help)}</small>` : ''}</span></label>`;
}

function panelButton(id, label) {
  return `<button type="button" role="tab" data-pcc-panel="${id}" aria-selected="${id === 'screening'}">${label}</button>`;
}

function createMarkup() {
  return `<div class="pcc-head"><div><p class="eyebrow">PARAMETER CONTROL CENTER</p><h2 id="parameterControlTitle">パラメータコントロール</h2><p>銘柄選定、Fundamental、Technical、損失上限、文字サイズを一か所で変更します。設定はこの端末だけに保存され、実注文や日次サーバールールは変更しません。</p></div><span id="pccStatus" class="pcc-status" aria-live="polite">未変更</span></div>
  <div class="pcc-toolbar"><div class="pcc-presets" aria-label="総合プリセット">${Object.entries(PARAMETER_PRESETS).map(([key, item]) => `<button type="button" data-pcc-preset="${key}"><b>${item.label}</b><small>${item.description}</small></button>`).join('')}</div><div class="pcc-actions"><button id="pccReset" class="button ghost" type="button">初期値</button><button id="pccExport" class="button ghost" type="button">設定を書き出す</button><label class="button ghost pcc-import">設定を読み込む<input id="pccImport" type="file" accept="application/json"></label><button id="pccApply" class="button primary" type="button">画面へ適用</button></div></div>
  <div class="pcc-layout"><nav class="pcc-tabs" role="tablist" aria-label="パラメータ分類">${panelButton('screening','総合条件')}${panelButton('fundamental','Fundamental')}${panelButton('technical','Technical')}${panelButton('risk','損失上限')}${panelButton('display','表示')}</nav><div class="pcc-panels">
    <section data-pcc-content="screening" role="tabpanel"><div class="pcc-panel-title"><h3>総合スクリーニング条件</h3><p>候補に残す最低スコアと欠損データの扱いを変更します。</p></div><div class="pcc-grid">${pairedField({label:'最低 総合スコア',path:'screening.minOverall',id:'pcMinOverall',min:0,max:100})}${pairedField({label:'最低 Fundamental',path:'screening.minFundamental',id:'pcMinFundamental',min:0,max:100})}${pairedField({label:'最低 割安性',path:'screening.minValue',id:'pcMinValue',min:0,max:100})}${pairedField({label:'最低 品質',path:'screening.minQuality',id:'pcMinQuality',min:0,max:100})}${pairedField({label:'最低 成長安定性',path:'screening.minGrowth',id:'pcMinGrowth',min:0,max:100})}${pairedField({label:'最低 データ充足率',path:'screening.minCompleteness',id:'pcMinCompleteness',min:0,max:100,unit:'%'})}${pairedField({label:'最大 Value Trap Risk',path:'screening.maxTrap',id:'pcMaxTrap',min:0,max:100})}${pairedField({label:'表示上位件数',path:'screening.topN',id:'pcTopN',min:1,max:100})}${selectField({label:'欠損データの扱い',path:'screening.missingPolicy',id:'pcMissingPolicy',options:[['allow','許容'],['neutral','中立50点'],['exclude','除外']]})}</div><h4>総合スコアのウェイト</h4><div class="pcc-grid compact">${pairedField({label:'Fundamental',path:'screening.weights.fundamental',id:'pcWeightFundamental',min:0,max:50})}${pairedField({label:'割安',path:'screening.weights.value',id:'pcWeightValue',min:0,max:50})}${pairedField({label:'品質',path:'screening.weights.quality',id:'pcWeightQuality',min:0,max:50})}${pairedField({label:'成長',path:'screening.weights.growth',id:'pcWeightGrowth',min:0,max:50})}${pairedField({label:'Technical',path:'screening.weights.technical',id:'pcWeightTechnical',min:0,max:50})}${pairedField({label:'流動性',path:'screening.weights.liquidity',id:'pcWeightLiquidity',min:0,max:50})}${pairedField({label:'Trap安全性',path:'screening.weights.trapPenalty',id:'pcWeightTrap',min:0,max:50})}</div></section>
    <section data-pcc-content="fundamental" role="tabpanel" hidden><div class="pcc-panel-title"><h3>Fundamental条件</h3><p>企業価値、収益性、キャッシュフロー、開示鮮度を個別に設定します。</p></div><div class="pcc-grid">${pairedField({label:'最低 割安スコア',path:'fundamental.minValueScore',id:'pcFundValue',min:0,max:100})}${pairedField({label:'最低 品質スコア',path:'fundamental.minQualityScore',id:'pcFundQuality',min:0,max:100})}${pairedField({label:'最低 成長スコア',path:'fundamental.minGrowthScore',id:'pcFundGrowth',min:0,max:100})}${pairedField({label:'最大 Trap Risk',path:'fundamental.maxTrapRisk',id:'pcFundTrap',min:0,max:100})}${pairedField({label:'最低 利益利回り',path:'fundamental.minEarningsYieldPct',id:'pcEarningsYield',min:-20,max:30,step:.5,unit:'%'})}${pairedField({label:'最低 純資産 / 時価',path:'fundamental.minBookToMarketPct',id:'pcBookToMarket',min:-20,max:200,unit:'%'})}${pairedField({label:'最低 FCF利回り',path:'fundamental.minFcfYieldPct',id:'pcFcfYield',min:-30,max:50,step:.5,unit:'%'})}${pairedField({label:'最低 ROE',path:'fundamental.minRoePct',id:'pcRoe',min:-30,max:60,step:.5,unit:'%'})}${pairedField({label:'最低 営業利益率',path:'fundamental.minOperatingMarginPct',id:'pcOperatingMargin',min:-30,max:60,step:.5,unit:'%'})}${pairedField({label:'最大 開示経過日',path:'fundamental.maxDisclosureAgeDays',id:'pcDisclosureAge',min:1,max:999,unit:'日'})}${selectField({label:'Fundamental欠損の扱い',path:'fundamental.missingPolicy',id:'pcFundMissing',options:[['allow','許容'],['neutral','中立50点'],['exclude','除外']]})}</div><h4>Fundamental再計算ウェイト</h4><div class="pcc-grid compact">${pairedField({label:'割安',path:'fundamental.weights.value',id:'pcFundWeightValue',min:0,max:60})}${pairedField({label:'品質',path:'fundamental.weights.quality',id:'pcFundWeightQuality',min:0,max:60})}${pairedField({label:'成長',path:'fundamental.weights.growth',id:'pcFundWeightGrowth',min:0,max:60})}${pairedField({label:'Trap安全性',path:'fundamental.weights.trapSafety',id:'pcFundWeightTrap',min:0,max:60})}${pairedField({label:'データ充足率',path:'fundamental.weights.completeness',id:'pcFundWeightCompleteness',min:0,max:60})}</div></section>
    <section data-pcc-content="technical" role="tabpanel" hidden><div class="pcc-panel-title"><h3>Technical条件</h3><p>トレンド、RSI、モメンタム、変動率、ドローダウンで売買タイミングを絞ります。</p></div><div class="pcc-grid">${pairedField({label:'最低 Technicalスコア',path:'screening.minTechnical',id:'pcMinTechnical',min:0,max:100})}${pairedField({label:'最低 RSI',path:'screening.minRsi',id:'pcMinRsi',min:0,max:100})}${pairedField({label:'最大 RSI',path:'screening.maxRsi',id:'pcMaxRsi',min:0,max:100})}${pairedField({label:'最低 20日モメンタム',path:'screening.minMomentum20',id:'pcMomentum20',min:-50,max:50,step:.5,unit:'%'})}${pairedField({label:'最低 60日モメンタム',path:'screening.minMomentum60',id:'pcMomentum60',min:-80,max:80,step:.5,unit:'%'})}${pairedField({label:'最大 年率ボラティリティ',path:'screening.maxVolatility',id:'pcMaxVolatility',min:1,max:200,unit:'%'})}${pairedField({label:'最小 20日ドローダウン',path:'screening.minDrawdown',id:'pcMinDrawdown',min:-50,max:0,step:.5,unit:'%'})}${checkboxField({label:'株価 > SMA20 を必須',path:'screening.requirePriceAboveSma20',id:'pcPriceAboveSma20'})}${checkboxField({label:'SMA20 > SMA60 を必須',path:'screening.requireSma20AboveSma60',id:'pcSmaTrend'})}</div></section>
    <section data-pcc-content="risk" role="tabpanel" hidden><div class="pcc-panel-title"><h3>損失上限・集中上限</h3><p>画面上の警告基準です。設定値を超えても実注文や強制売却は行いません。</p></div><div class="pcc-grid">${pairedField({label:'最大 ポートフォリオDD',path:'risk.maxPortfolioDrawdownPct',id:'pcMaxDd',min:1,max:50,step:.5,unit:'%'})}${pairedField({label:'全体 最大含み損率',path:'risk.maxTotalUnrealizedLossPct',id:'pcTotalLossPct',min:1,max:50,step:.5,unit:'%'})}${pairedField({label:'全体 最大含み損額',path:'risk.maxTotalUnrealizedLossYen',id:'pcTotalLossYen',min:10000,max:10000000,step:10000,unit:'円'})${pairedField({label:'1銘柄 最大含み損率',path:'risk.maxPositionLossPct',id:'pcPositionLossPct',min:1,max:50,step:.5,unit:'%'})}${pairedField({label:'1銘柄 最大含み損額',path:'risk.maxPositionLossYen',id:'pcPositionLossYen',min:10000,max:5000000,step:10000,unit:'円'})}${pairedField({label:'最大 ポジション比率',path:'risk.maxPositionWeightPct',id:'pcPositionWeight',min:5,max:100,unit:'%'})}${pairedField({label:'最大 業種比率',path:'risk.maxSectorWeightPct',id:'pcSectorWeight',min:5,max:100,unit:'%'})}</div><div class="pcc-note"><strong>安全設計</strong><p>この設定はブラウザ内の警告と比較にだけ使います。日次デモ売買ルールへ採用するには、十分な履歴とOOS検証が必要です。</p></div></section>
    <section data-pcc-content="display" role="tabpanel" hidden><div class="pcc-panel-title"><h3>表示と文字サイズ</h3><p>小さい文字が読みにくい場合は「大きめ」または「最大」を選択してください。</p></div><fieldset class="pcc-font-options"><legend>文字サイズ</legend>${Object.entries(FONT_SCALES).map(([key, item]) => `<label for="pcFontScale${key}"><input id="pcFontScale${key}" name="pcFontScale" data-path="ui.fontScale" type="radio" value="${key}"><span><b>${item.label}</b><small>${item.px}px基準</small></span></label>`).join('')}</fieldset><div class="pcc-grid">${selectField({label:'PC / iPad 表示密度',path:'ui.density',id:'pcDensity',options:[['comfortable','標準'],['compact','コンパクト']]})}${checkboxField({label:'高コントラスト表示',path:'ui.highContrast',id:'pcHighContrast',help:'境界線と補助文字を強調'})}</div><div class="pcc-font-preview"><span>表示例</span><strong>東京エレクトロン　+12.34%</strong><p>Fundamental、Technical、損益、リスク理由をこの大きさで表示します。</p></div></section>
  </div><aside class="pcc-summary"><h3>現在の設定</h3><dl><div><dt>プリセット</dt><dd id="pccSummaryPreset">–</dd></div><div><dt>最低品質</dt><dd id="pccSummaryQuality">–</dd></div><div><dt>最低Technical</dt><dd id="pccSummaryTechnical">–</dd></div><div><dt>最大DD</dt><dd id="pccSummaryDd">–</dd></div><div><dt>文字サイズ</dt><dd id="pccSummaryFont">–</dd></div></dl><div id="pccWarnings" class="pcc-warnings"></div><div class="pcc-impact"><span>既存スクリーナー結果</span><strong id="pccImpactCount">適用後に表示</strong><small>条件設定画面内で即時再計算</small></div></aside></div>`;
}

function waitForAnchor(timeoutMs = 15000) {
  const existing = $('#screeningLab') ?? $('.ranking') ?? $('.filters');
  if (existing) return Promise.resolve(existing);
  return new Promise(resolve => {
    const observer = new MutationObserver(() => {
      const anchor = $('#screeningLab') ?? $('.ranking') ?? $('.filters');
      if (!anchor) return;
      observer.disconnect();
      clearTimeout(timer);
      resolve(anchor);
    });
    const timer = setTimeout(() => { observer.disconnect(); resolve(null); }, timeoutMs);
    observer.observe(document.body, { childList: true, subtree: true });
  });
}

function activatePanel(name) {
  document.querySelectorAll('[data-pcc-panel]').forEach(button => button.setAttribute('aria-selected', String(button.dataset.pccPanel === name)));
  document.querySelectorAll('[data-pcc-content]').forEach(panel => { panel.hidden = panel.dataset.pccContent !== name; });
}

function valueForInput(input) {
  if (input.type === 'checkbox') return input.checked;
  if (input.type === 'radio') return input.value;
  if (input.type === 'number' || input.type === 'range') return Number(input.value);
  return input.value;
}

function applyUiPreview() {
  document.documentElement.dataset.fontScale = bundle.ui.fontScale;
  document.documentElement.dataset.highContrast = String(bundle.ui.highContrast);
  document.documentElement.dataset.uxDensity = bundle.ui.density;
  document.documentElement.style.setProperty('--pcc-root-font-size', `${fontSizePx(bundle.ui.fontScale)}px`);
}

function renderControls() {
  document.querySelectorAll('#parameterControlCenter [data-path]').forEach(input => {
    const value = getPath(bundle, input.dataset.path);
    if (input.type === 'checkbox') input.checked = Boolean(value);
    else if (input.type === 'radio') input.checked = input.value === String(value);
    else input.value = String(value ?? '');
  });
  document.querySelectorAll('#parameterControlCenter [data-pair]').forEach(input => {
    const pair = input.dataset.pair;
    const value = getPath(bundle, input.dataset.path);
    document.querySelectorAll(`[data-pair="${pair}"]`).forEach(item => { item.value = String(value ?? ''); });
  });
  $('#pccSummaryPreset').textContent = PARAMETER_PRESETS[bundle.preset]?.label ?? 'カスタム';
  $('#pccSummaryQuality').textContent = `${bundle.screening.minQuality}`;
  $('#pccSummaryTechnical').textContent = `${bundle.screening.minTechnical}`;
  $('#pccSummaryDd').textContent = `${bundle.risk.maxPortfolioDrawdownPct}%`;
  $('#pccSummaryFont').textContent = `${FONT_SCALES[bundle.ui.fontScale]?.label ?? '大きめ'} (${fontSizePx(bundle.ui.fontScale)}px)`;
  const warnings = parameterWarnings(bundle);
  $('#pccWarnings').innerHTML = warnings.length ? `<strong>設定確認</strong><ul>${warnings.map(item => `<li>${escapeHtml(item)}</li>`).join('')}</ul>` : '<span>設定の矛盾はありません。</span>';
  applyUiPreview();
}

function markDirty() {
  dirty = true;
  const status = $('#pccStatus');
  status.textContent = '未適用の変更あり';
  status.className = 'pcc-status dirty';
}

function setExistingValue(selector, value, checked = false) {
  const input = $(selector);
  if (!input) return null;
  if (checked) input.checked = Boolean(value);
  else input.value = String(value);
  return input;
}

function syncExistingControls() {
  const screeningMap = {
    '#slMinOverall':'minOverall','#slMinFundamental':'minFundamental','#slMinValue':'minValue','#slMinQuality':'minQuality','#slMinGrowth':'minGrowth','#slMinCompleteness':'minCompleteness','#slMinTechnical':'minTechnical','#slMaxTrap':'maxTrap','#slMinRsi':'minRsi','#slMaxRsi':'maxRsi','#slMinMomentum20':'minMomentum20','#slMinMomentum60':'minMomentum60','#slMaxVolatility':'maxVolatility','#slMinDrawdown':'minDrawdown','#slTopN':'topN','#slMissing':'missingPolicy',
  };
  let screeningTrigger = null;
  for (const [selector, key] of Object.entries(screeningMap)) screeningTrigger = setExistingValue(selector, bundle.screening[key]) ?? screeningTrigger;
  setExistingValue('#slPriceAbove', bundle.screening.requirePriceAboveSma20, true);
  setExistingValue('#slSmaTrend', bundle.screening.requireSma20AboveSma60, true);
  const screeningWeights = { '#slWeightFundamental':'fundamental','#slWeightValue':'value','#slWeightQuality':'quality','#slWeightGrowth':'growth','#slWeightTechnical':'technical','#slWeightLiquidity':'liquidity','#slWeightTrap':'trapPenalty' };
  for (const [selector, key] of Object.entries(screeningWeights)) setExistingValue(selector, bundle.screening.weights[key]);
  screeningTrigger?.dispatchEvent(new Event('input', { bubbles: true }));

  const fundamentalMap = {
    '#ftValue':'minValueScore','#ftQuality':'minQualityScore','#ftGrowth':'minGrowthScore','#ftTrap':'maxTrapRisk','#ftCompleteness':'minCompleteness','#ftEarnings':'minEarningsYieldPct','#ftBook':'minBookToMarketPct','#ftFcf':'minFcfYieldPct','#ftRoe':'minRoePct','#ftMargin':'minOperatingMarginPct','#ftDisclosure':'maxDisclosureAgeDays','#ftMissing':'missingPolicy',
  };
  let fundamentalTrigger = null;
  for (const [selector, key] of Object.entries(fundamentalMap)) fundamentalTrigger = setExistingValue(selector, bundle.fundamental[key]) ?? fundamentalTrigger;
  const fundamentalWeights = { '#ftWeightValue':'value','#ftWeightQuality':'quality','#ftWeightGrowth':'growth','#ftWeightTrap':'trapSafety','#ftWeightCompleteness':'completeness' };
  for (const [selector, key] of Object.entries(fundamentalWeights)) setExistingValue(selector, bundle.fundamental.weights[key]);
  fundamentalTrigger?.dispatchEvent(new Event('input', { bubbles: true }));

  const riskMap = { '#rdMaxDd':'maxPortfolioDrawdownPct','#rdTotalPct':'maxTotalUnrealizedLossPct','#rdTotalYen':'maxTotalUnrealizedLossYen','#rdPosPct':'maxPositionLossPct','#rdPosYen':'maxPositionLossYen','#rdWeight':'maxPositionWeightPct' };
  for (const [selector, key] of Object.entries(riskMap)) setExistingValue(selector, bundle.risk[key]);
  $('#rdSave')?.click();

  window.setTimeout(() => {
    const included = $('#slIncluded')?.textContent ?? '–';
    const total = $('#slTotal')?.textContent ?? '–';
    if ($('#pccImpactCount')) $('#pccImpactCount').textContent = `${included} / ${total}銘柄`;
  }, 50);
}

function saveBundle() {
  bundle = normalizeParameterBundle(bundle);
  localStorage.setItem(PARAMETER_STORAGE_KEYS.bundle, JSON.stringify(bundle));
  localStorage.setItem(PARAMETER_STORAGE_KEYS.screening, JSON.stringify(bundle.screening));
  localStorage.setItem(PARAMETER_STORAGE_KEYS.fundamental, JSON.stringify(bundle.fundamental));
  localStorage.setItem(PARAMETER_STORAGE_KEYS.risk, JSON.stringify(bundle.risk));
  localStorage.setItem(PARAMETER_STORAGE_KEYS.ui, JSON.stringify(bundle.ui));
  localStorage.setItem(PARAMETER_STORAGE_KEYS.density, bundle.ui.density);
  applyUiPreview();
  syncExistingControls();
  dirty = false;
  const status = $('#pccStatus');
  status.textContent = '画面へ適用済み';
  status.className = 'pcc-status applied';
  window.dispatchEvent(new CustomEvent('valuescope:parameters-applied', { detail: structuredClone(bundle) }));
}

function download(content, filename) {
  const blob = new Blob([content], { type: 'application/json;charset=utf-8' });
  const link = document.createElement('a');
  link.href = URL.createObjectURL(blob);
  link.download = filename;
  link.click();
  URL.revokeObjectURL(link.href);
}

function bind() {
  $('#parameterControlCenter').addEventListener('input', event => {
    const input = event.target.closest('[data-path]');
    if (!input) return;
    if (input.type === 'radio' && !input.checked) return;
    setPath(bundle, input.dataset.path, valueForInput(input));
    bundle.preset = 'custom';
    if (input.dataset.pair) document.querySelectorAll(`[data-pair="${input.dataset.pair}"]`).forEach(item => { if (item !== input) item.value = input.value; });
    markDirty();
    renderControls();
  });
  document.querySelectorAll('[data-pcc-panel]').forEach(button => button.addEventListener('click', () => activatePanel(button.dataset.pccPanel)));
  document.querySelectorAll('[data-pcc-preset]').forEach(button => button.addEventListener('click', () => {
    bundle = applyParameterPreset(button.dataset.pccPreset, bundle);
    markDirty();
    renderControls();
  }));
  $('#pccApply').addEventListener('click', saveBundle);
  $('#pccReset').addEventListener('click', () => { bundle = defaultParameterBundle(); markDirty(); renderControls(); });
  $('#pccExport').addEventListener('click', () => download(serializeParameterBundle(bundle), 'valuescope-parameters.json'));
  $('#pccImport').addEventListener('change', async event => {
    const file = event.target.files?.[0];
    if (!file) return;
    try {
      bundle = parseParameterBundle(await file.text());
      markDirty();
      renderControls();
    } catch {
      const status = $('#pccStatus');
      status.textContent = '設定ファイルを読み込めません';
      status.className = 'pcc-status error';
    }
  });
}

async function start() {
  applyUiPreview();
  const anchor = await waitForAnchor();
  if (!anchor || $('#parameterControlCenter')) return;
  const section = document.createElement('section');
  section.id = 'parameterControlCenter';
  section.className = 'pcc-shell';
  section.setAttribute('aria-labelledby', 'parameterControlTitle');
  section.innerHTML = createMarkup();
  anchor.before(section);
  bind();
  renderControls();
  window.setTimeout(syncExistingControls, 250);
}

if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', start, { once: true });
else start();
