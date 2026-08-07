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
const esc = value => String(value ?? '').replace(/[&<>'"]/g, character => ({
  '&':'&amp;','<':'&lt;','>':'&gt;',"'":'&#39;','"':'&quot;',
})[character]);

const GROUPS = Object.freeze({
  screening: {
    title: '総合スクリーニング条件',
    description: '候補に残す最低スコア、欠損処理、表示件数、再計算ウェイトを変更します。',
    fields: [
      ['number','最低 総合スコア','screening.minOverall','pcMinOverall',0,100,1,''],
      ['number','最低 Fundamental','screening.minFundamental','pcMinFundamental',0,100,1,''],
      ['number','最低 割安性','screening.minValue','pcMinValue',0,100,1,''],
      ['number','最低 品質','screening.minQuality','pcMinQuality',0,100,1,''],
      ['number','最低 成長安定性','screening.minGrowth','pcMinGrowth',0,100,1,''],
      ['number','最低 データ充足率','screening.minCompleteness','pcMinCompleteness',0,100,1,'%'],
      ['number','最大 Value Trap Risk','screening.maxTrap','pcMaxTrap',0,100,1,''],
      ['number','表示上位件数','screening.topN','pcTopN',1,100,1,'件'],
      ['select','欠損データの扱い','screening.missingPolicy','pcMissingPolicy',[['allow','許容'],['neutral','中立50点'],['exclude','除外']]],
      ['heading','総合スコアのウェイト'],
      ['number','Fundamental','screening.weights.fundamental','pcWeightFundamental',0,50,1,''],
      ['number','割安','screening.weights.value','pcWeightValue',0,50,1,''],
      ['number','品質','screening.weights.quality','pcWeightQuality',0,50,1,''],
      ['number','成長','screening.weights.growth','pcWeightGrowth',0,50,1,''],
      ['number','Technical','screening.weights.technical','pcWeightTechnical',0,50,1,''],
      ['number','流動性','screening.weights.liquidity','pcWeightLiquidity',0,50,1,''],
      ['number','Trap安全性','screening.weights.trapPenalty','pcWeightTrap',0,50,1,''],
    ],
  },
  fundamental: {
    title: 'Fundamental条件',
    description: '企業価値、収益性、キャッシュフロー、開示鮮度を個別に設定します。',
    fields: [
      ['number','最低 割安スコア','fundamental.minValueScore','pcFundValue',0,100,1,''],
      ['number','最低 品質スコア','fundamental.minQualityScore','pcFundQuality',0,100,1,''],
      ['number','最低 成長スコア','fundamental.minGrowthScore','pcFundGrowth',0,100,1,''],
      ['number','最大 Trap Risk','fundamental.maxTrapRisk','pcFundTrap',0,100,1,''],
      ['number','最低 データ充足率','fundamental.minCompleteness','pcFundCompleteness',0,100,1,'%'],
      ['number','最低 利益利回り','fundamental.minEarningsYieldPct','pcEarningsYield',-20,30,.5,'%'],
      ['number','最低 純資産 / 時価','fundamental.minBookToMarketPct','pcBookToMarket',-20,200,1,'%'],
      ['number','最低 FCF利回り','fundamental.minFcfYieldPct','pcFcfYield',-30,50,.5,'%'],
      ['number','最低 ROE','fundamental.minRoePct','pcRoe',-30,60,.5,'%'],
      ['number','最低 営業利益率','fundamental.minOperatingMarginPct','pcOperatingMargin',-30,60,.5,'%'],
      ['number','最大 開示経過日','fundamental.maxDisclosureAgeDays','pcDisclosureAge',1,999,1,'日'],
      ['select','Fundamental欠損の扱い','fundamental.missingPolicy','pcFundMissing',[['allow','許容'],['neutral','中立50点'],['exclude','除外']]],
      ['heading','Fundamental再計算ウェイト'],
      ['number','割安','fundamental.weights.value','pcFundWeightValue',0,60,1,''],
      ['number','品質','fundamental.weights.quality','pcFundWeightQuality',0,60,1,''],
      ['number','成長','fundamental.weights.growth','pcFundWeightGrowth',0,60,1,''],
      ['number','Trap安全性','fundamental.weights.trapSafety','pcFundWeightTrap',0,60,1,''],
      ['number','データ充足率','fundamental.weights.completeness','pcFundWeightCompleteness',0,60,1,''],
    ],
  },
  technical: {
    title: 'Technical条件',
    description: 'トレンド、RSI、モメンタム、変動率、ドローダウンでタイミングを絞ります。',
    fields: [
      ['number','最低 Technicalスコア','screening.minTechnical','pcMinTechnical',0,100,1,''],
      ['number','最低 RSI','screening.minRsi','pcMinRsi',0,100,1,''],
      ['number','最大 RSI','screening.maxRsi','pcMaxRsi',0,100,1,''],
      ['number','最低 20日モメンタム','screening.minMomentum20','pcMomentum20',-50,50,.5,'%'],
      ['number','最低 60日モメンタム','screening.minMomentum60','pcMomentum60',-80,80,.5,'%'],
      ['number','最大 年率ボラティリティ','screening.maxVolatility','pcMaxVolatility',1,200,1,'%'],
      ['number','最小 20日ドローダウン','screening.minDrawdown','pcMinDrawdown',-50,0,.5,'%'],
      ['checkbox','株価 > SMA20 を必須','screening.requirePriceAboveSma20','pcPriceAboveSma20'],
      ['checkbox','SMA20 > SMA60 を必須','screening.requireSma20AboveSma60','pcSmaTrend'],
    ],
  },
  risk: {
    title: '損失上限・集中上限',
    description: '画面上の警告基準です。設定を超えても実注文や強制売却は行いません。',
    fields: [
      ['number','最大 ポートフォリオDD','risk.maxPortfolioDrawdownPct','pcMaxDd',1,50,.5,'%'],
      ['number','全体 最大含み損率','risk.maxTotalUnrealizedLossPct','pcTotalLossPct',1,50,.5,'%'],
      ['number','全体 最大含み損額','risk.maxTotalUnrealizedLossYen','pcTotalLossYen',10000,10000000,10000,'円'],
      ['number','1銘柄 最大含み損率','risk.maxPositionLossPct','pcPositionLossPct',1,50,.5,'%'],
      ['number','1銘柄 最大含み損額','risk.maxPositionLossYen','pcPositionLossYen',10000,5000000,10000,'円'],
      ['number','最大 ポジション比率','risk.maxPositionWeightPct','pcPositionWeight',5,100,1,'%'],
      ['number','最大 業種比率','risk.maxSectorWeightPct','pcSectorWeight',5,100,1,'%'],
    ],
  },
});

let bundle = loadBundle();

function safeParse(key) {
  try { return JSON.parse(localStorage.getItem(key) ?? 'null'); } catch { return null; }
}

function loadBundle() {
  const central = safeParse(PARAMETER_STORAGE_KEYS.bundle);
  if (central) return normalizeParameterBundle(central);
  const defaults = defaultParameterBundle();
  return normalizeParameterBundle({
    ...defaults,
    screening: safeParse(PARAMETER_STORAGE_KEYS.screening) ?? defaults.screening,
    fundamental: safeParse(PARAMETER_STORAGE_KEYS.fundamental) ?? defaults.fundamental,
    risk: safeParse(PARAMETER_STORAGE_KEYS.risk) ?? defaults.risk,
    ui: safeParse(PARAMETER_STORAGE_KEYS.ui) ?? DEFAULT_UI_PREFERENCES,
  });
}

function numberField(label, path, id, min, max, step, unit) {
  return `<label class="pcc-field" for="${id}Number"><span><b>${esc(label)}</b></span><div class="pcc-paired"><input id="${id}Range" data-path="${path}" data-pair="${id}" type="range" min="${min}" max="${max}" step="${step}"><input id="${id}Number" data-path="${path}" data-pair="${id}" type="number" min="${min}" max="${max}" step="${step}"><em>${esc(unit)}</em></div></label>`;
}

function selectField(label, path, id, options) {
  return `<label class="pcc-field" for="${id}"><span><b>${esc(label)}</b></span><select id="${id}" data-path="${path}">${options.map(([value, text]) => `<option value="${esc(value)}">${esc(text)}</option>`).join('')}</select></label>`;
}

function checkboxField(label, path, id) {
  return `<label class="pcc-check" for="${id}"><input id="${id}" data-path="${path}" type="checkbox"><span><b>${esc(label)}</b><small>有効にすると条件を満たさない銘柄を除外</small></span></label>`;
}

function groupFields(group) {
  let html = '<div class="pcc-grid">';
  for (const field of group.fields) {
    const [type, label, path, id, min, max, step, unit] = field;
    if (type === 'heading') {
      html += `</div><h4>${esc(label)}</h4><div class="pcc-grid compact">`;
    } else if (type === 'number') {
      html += numberField(label, path, id, min, max, step, unit);
    } else if (type === 'select') {
      html += selectField(label, path, id, field[4]);
    } else if (type === 'checkbox') {
      html += checkboxField(label, path, id);
    }
  }
  return `${html}</div>`;
}

function displayPanel() {
  return `<section data-pcc-content="display" role="tabpanel" hidden><div class="pcc-panel-title"><h3>表示と文字サイズ</h3><p>小さい文字が読みにくい場合は「大きめ」または「最大」を選択してください。</p></div><fieldset class="pcc-font-options"><legend>文字サイズ</legend>${Object.entries(FONT_SCALES).map(([key, item]) => `<label for="pcFontScale${key}"><input id="pcFontScale${key}" name="pcFontScale" data-path="ui.fontScale" type="radio" value="${key}"><span><b>${item.label}</b><small>${item.px}px基準</small></span></label>`).join('')}</fieldset><div class="pcc-grid">${selectField('PC / iPad 表示密度','ui.density','pcDensity',[['comfortable','標準'],['compact','コンパクト']])}${checkboxField('高コントラスト表示','ui.highContrast','pcHighContrast')}</div><div class="pcc-font-preview"><span>表示例</span><strong>東京エレクトロン　+12.34%</strong><p>Fundamental、Technical、損益、リスク理由をこの大きさで表示します。</p></div></section>`;
}

function markup() {
  const tabs = [
    ['screening','総合条件'],['fundamental','Fundamental'],['technical','Technical'],['risk','損失上限'],['display','表示'],
  ].map(([id, label], index) => `<button type="button" role="tab" data-pcc-panel="${id}" aria-selected="${index === 0}">${label}</button>`).join('');
  const panels = Object.entries(GROUPS).map(([id, group], index) => `<section data-pcc-content="${id}" role="tabpanel" ${index === 0 ? '' : 'hidden'}><div class="pcc-panel-title"><h3>${esc(group.title)}</h3><p>${esc(group.description)}</p></div>${groupFields(group)}${id === 'risk' ? '<div class="pcc-note"><strong>安全設計</strong><p>この設定はブラウザ内の警告と比較にだけ使います。日次デモ売買ルールには自動採用しません。</p></div>' : ''}</section>`).join('');
  const presets = Object.entries(PARAMETER_PRESETS).map(([key, item]) => `<button type="button" data-pcc-preset="${key}"><b>${esc(item.label)}</b><small>${esc(item.description)}</small></button>`).join('');
  return `<div class="pcc-head"><div><p class="eyebrow">PARAMETER CONTROL CENTER</p><h2 id="parameterControlTitle">パラメータコントロール</h2><p>銘柄選定、Fundamental、Technical、損失上限、文字サイズを一か所で変更します。設定はこの端末だけに保存されます。</p></div><span id="pccStatus" class="pcc-status" aria-live="polite">未変更</span></div><div class="pcc-toolbar"><div class="pcc-presets" aria-label="総合プリセット">${presets}</div><div class="pcc-actions"><button id="pccReset" class="button ghost" type="button">初期値</button><button id="pccExport" class="button ghost" type="button">設定を書き出す</button><label class="button ghost pcc-import">設定を読み込む<input id="pccImport" type="file" accept="application/json"></label><button id="pccApply" class="button primary" type="button">画面へ適用</button></div></div><div class="pcc-layout"><nav class="pcc-tabs" role="tablist" aria-label="パラメータ分類">${tabs}</nav><div class="pcc-panels">${panels}${displayPanel()}</div><aside class="pcc-summary"><h3>現在の設定</h3><dl><div><dt>プリセット</dt><dd id="pccSummaryPreset">–</dd></div><div><dt>最低品質</dt><dd id="pccSummaryQuality">–</dd></div><div><dt>最低Technical</dt><dd id="pccSummaryTechnical">–</dd></div><div><dt>最大DD</dt><dd id="pccSummaryDd">–</dd></div><div><dt>文字サイズ</dt><dd id="pccSummaryFont">–</dd></div></dl><div id="pccWarnings" class="pcc-warnings"></div><div class="pcc-impact"><span>既存スクリーナー結果</span><strong id="pccImpactCount">適用後に表示</strong><small>条件設定画面内で即時再計算</small></div></aside></div>`;
}

function waitForAnchor(timeoutMs = 15000) {
  const existing = $('#screeningLab') ?? $('.ranking') ?? $('.filters');
  if (existing) return Promise.resolve(existing);
  return new Promise(resolve => {
    let timer;
    const observer = new MutationObserver(() => {
      const anchor = $('#screeningLab') ?? $('.ranking') ?? $('.filters');
      if (!anchor) return;
      observer.disconnect();
      clearTimeout(timer);
      resolve(anchor);
    });
    timer = setTimeout(() => { observer.disconnect(); resolve(null); }, timeoutMs);
    observer.observe(document.body, { childList: true, subtree: true });
  });
}

function valueOf(input) {
  if (input.type === 'checkbox') return input.checked;
  if (input.type === 'radio') return input.value;
  if (input.type === 'number' || input.type === 'range') return Number(input.value);
  return input.value;
}

function applyUi() {
  document.documentElement.dataset.fontScale = bundle.ui.fontScale;
  document.documentElement.dataset.highContrast = String(bundle.ui.highContrast);
  document.documentElement.dataset.uxDensity = bundle.ui.density;
  document.documentElement.style.setProperty('--pcc-root-font-size', `${fontSizePx(bundle.ui.fontScale)}px`);
}

function render() {
  document.querySelectorAll('#parameterControlCenter [data-path]').forEach(input => {
    const value = getPath(bundle, input.dataset.path);
    if (input.type === 'checkbox') input.checked = Boolean(value);
    else if (input.type === 'radio') input.checked = input.value === String(value);
    else input.value = String(value ?? '');
  });
  $('#pccSummaryPreset').textContent = PARAMETER_PRESETS[bundle.preset]?.label ?? 'カスタム';
  $('#pccSummaryQuality').textContent = `${bundle.screening.minQuality}`;
  $('#pccSummaryTechnical').textContent = `${bundle.screening.minTechnical}`;
  $('#pccSummaryDd').textContent = `${bundle.risk.maxPortfolioDrawdownPct}%`;
  $('#pccSummaryFont').textContent = `${FONT_SCALES[bundle.ui.fontScale]?.label ?? '大きめ'} (${fontSizePx(bundle.ui.fontScale)}px)`;
  const warnings = parameterWarnings(bundle);
  $('#pccWarnings').innerHTML = warnings.length ? `<strong>設定確認</strong><ul>${warnings.map(item => `<li>${esc(item)}</li>`).join('')}</ul>` : '<span>設定の矛盾はありません。</span>';
  applyUi();
}

function setValue(selector, value, checkbox = false) {
  const input = $(selector);
  if (!input) return null;
  if (checkbox) input.checked = Boolean(value);
  else input.value = String(value);
  return input;
}

function syncExistingControls() {
  const screen = {
    '#slMinOverall':'minOverall','#slMinFundamental':'minFundamental','#slMinValue':'minValue','#slMinQuality':'minQuality','#slMinGrowth':'minGrowth','#slMinCompleteness':'minCompleteness','#slMinTechnical':'minTechnical','#slMaxTrap':'maxTrap','#slMinRsi':'minRsi','#slMaxRsi':'maxRsi','#slMinMomentum20':'minMomentum20','#slMinMomentum60':'minMomentum60','#slMaxVolatility':'maxVolatility','#slMinDrawdown':'minDrawdown','#slTopN':'topN','#slMissing':'missingPolicy',
  };
  let screenTrigger = null;
  for (const [selector, key] of Object.entries(screen)) screenTrigger = setValue(selector, bundle.screening[key]) ?? screenTrigger;
  setValue('#slPriceAbove', bundle.screening.requirePriceAboveSma20, true);
  setValue('#slSmaTrend', bundle.screening.requireSma20AboveSma60, true);
  for (const [selector, key] of Object.entries({ '#slWeightFundamental':'fundamental','#slWeightValue':'value','#slWeightQuality':'quality','#slWeightGrowth':'growth','#slWeightTechnical':'technical','#slWeightLiquidity':'liquidity','#slWeightTrap':'trapPenalty' })) setValue(selector, bundle.screening.weights[key]);
  screenTrigger?.dispatchEvent(new Event('input', { bubbles: true }));

  const fundamental = {
    '#ftValue':'minValueScore','#ftQuality':'minQualityScore','#ftGrowth':'minGrowthScore','#ftTrap':'maxTrapRisk','#ftCompleteness':'minCompleteness','#ftEarnings':'minEarningsYieldPct','#ftBook':'minBookToMarketPct','#ftFcf':'minFcfYieldPct','#ftRoe':'minRoePct','#ftMargin':'minOperatingMarginPct','#ftDisclosure':'maxDisclosureAgeDays','#ftMissing':'missingPolicy',
  };
  let fundTrigger = null;
  for (const [selector, key] of Object.entries(fundamental)) fundTrigger = setValue(selector, bundle.fundamental[key]) ?? fundTrigger;
  for (const [selector, key] of Object.entries({ '#ftWeightValue':'value','#ftWeightQuality':'quality','#ftWeightGrowth':'growth','#ftWeightTrap':'trapSafety','#ftWeightCompleteness':'completeness' })) setValue(selector, bundle.fundamental.weights[key]);
  fundTrigger?.dispatchEvent(new Event('input', { bubbles: true }));

  for (const [selector, key] of Object.entries({ '#rdMaxDd':'maxPortfolioDrawdownPct','#rdTotalPct':'maxTotalUnrealizedLossPct','#rdTotalYen':'maxTotalUnrealizedLossYen','#rdPosPct':'maxPositionLossPct','#rdPosYen':'maxPositionLossYen','#rdWeight':'maxPositionWeightPct' })) setValue(selector, bundle.risk[key]);
  $('#rdSave')?.click();
  setTimeout(() => {
    const included = $('#slIncluded')?.textContent ?? '–';
    const total = $('#slTotal')?.textContent ?? '–';
    if ($('#pccImpactCount')) $('#pccImpactCount').textContent = `${included} / ${total}銘柄`;
  }, 60);
}

function save() {
  bundle = normalizeParameterBundle(bundle);
  localStorage.setItem(PARAMETER_STORAGE_KEYS.bundle, JSON.stringify(bundle));
  localStorage.setItem(PARAMETER_STORAGE_KEYS.screening, JSON.stringify(bundle.screening));
  localStorage.setItem(PARAMETER_STORAGE_KEYS.fundamental, JSON.stringify(bundle.fundamental));
  localStorage.setItem(PARAMETER_STORAGE_KEYS.risk, JSON.stringify(bundle.risk));
  localStorage.setItem(PARAMETER_STORAGE_KEYS.ui, JSON.stringify(bundle.ui));
  localStorage.setItem(PARAMETER_STORAGE_KEYS.density, bundle.ui.density);
  applyUi();
  syncExistingControls();
  $('#pccStatus').textContent = '画面へ適用済み';
  $('#pccStatus').className = 'pcc-status applied';
  window.dispatchEvent(new CustomEvent('valuescope:parameters-applied', { detail: structuredClone(bundle) }));
}

function activatePanel(name) {
  document.querySelectorAll('[data-pcc-panel]').forEach(button => button.setAttribute('aria-selected', String(button.dataset.pccPanel === name)));
  document.querySelectorAll('[data-pcc-content]').forEach(panel => { panel.hidden = panel.dataset.pccContent !== name; });
}

function download() {
  const blob = new Blob([serializeParameterBundle(bundle)], { type: 'application/json;charset=utf-8' });
  const link = document.createElement('a');
  link.href = URL.createObjectURL(blob);
  link.download = 'valuescope-parameters.json';
  link.click();
  URL.revokeObjectURL(link.href);
}

function bind() {
  $('#parameterControlCenter').addEventListener('input', event => {
    const input = event.target.closest('[data-path]');
    if (!input || (input.type === 'radio' && !input.checked)) return;
    setPath(bundle, input.dataset.path, valueOf(input));
    bundle.preset = 'custom';
    if (input.dataset.pair) document.querySelectorAll(`[data-pair="${input.dataset.pair}"]`).forEach(item => { if (item !== input) item.value = input.value; });
    $('#pccStatus').textContent = '未適用の変更あり';
    $('#pccStatus').className = 'pcc-status dirty';
    render();
  });
  document.querySelectorAll('[data-pcc-panel]').forEach(button => button.addEventListener('click', () => activatePanel(button.dataset.pccPanel)));
  document.querySelectorAll('[data-pcc-preset]').forEach(button => button.addEventListener('click', () => {
    bundle = applyParameterPreset(button.dataset.pccPreset, bundle);
    $('#pccStatus').textContent = '未適用の変更あり';
    $('#pccStatus').className = 'pcc-status dirty';
    render();
  }));
  $('#pccApply').addEventListener('click', save);
  $('#pccReset').addEventListener('click', () => { bundle = defaultParameterBundle(); render(); $('#pccStatus').textContent = '未適用の変更あり'; $('#pccStatus').className = 'pcc-status dirty'; });
  $('#pccExport').addEventListener('click', download);
  $('#pccImport').addEventListener('change', async event => {
    try {
      const file = event.target.files?.[0];
      if (!file) return;
      bundle = parseParameterBundle(await file.text());
      render();
      $('#pccStatus').textContent = '未適用の変更あり';
      $('#pccStatus').className = 'pcc-status dirty';
    } catch {
      $('#pccStatus').textContent = '設定ファイルを読み込めません';
      $('#pccStatus').className = 'pcc-status error';
    }
  });
}

async function start() {
  applyUi();
  const anchor = await waitForAnchor();
  if (!anchor || $('#parameterControlCenter')) return;
  const section = document.createElement('section');
  section.id = 'parameterControlCenter';
  section.className = 'pcc-shell';
  section.setAttribute('aria-labelledby', 'parameterControlTitle');
  section.innerHTML = markup();
  anchor.before(section);
  bind();
  render();
  setTimeout(syncExistingControls, 250);
}

if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', start, { once: true });
else start();
