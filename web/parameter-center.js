import {
  DEFAULT_USER_PARAMETERS,
  PARAMETER_PRESETS,
  PARAMETER_STORAGE_KEY,
  applyParameterPreset,
  countParameterChanges,
  fontScalePx,
  legacyStoresFromParameters,
  migrateLegacyParameters,
  normalizeParameters,
  validateParameters,
} from './parameter-center-core.js';

const LEGACY_KEYS = Object.freeze({
  screening: 'valuescope-screening-lab-v1',
  fundamental: 'valuescope-fundamental-tuning-v1',
  risk: 'valuescope-risk-policy-v1',
});
const $ = selector => document.querySelector(selector);
const $$ = selector => [...document.querySelectorAll(selector)];
const escapeHtml = value => String(value ?? '').replace(/[&<>'"]/g, character => ({
  '&':'&amp;','<':'&lt;','>':'&gt;',"'":'&#39;','"':'&quot;',
})[character]);
let state = normalizeParameters(DEFAULT_USER_PARAMETERS);
let activeTab = 'selection';
let observer = null;

function readJson(key) {
  try { return JSON.parse(localStorage.getItem(key) ?? 'null'); } catch { return null; }
}
function writeJson(key, value) {
  try { localStorage.setItem(key, JSON.stringify(value)); return true; } catch { return false; }
}
function clone(value) { return JSON.parse(JSON.stringify(value)); }
function getPath(object, path) { return path.split('.').reduce((value, key) => value?.[key], object); }
function setPath(object, path, value) {
  const keys = path.split('.');
  let cursor = object;
  keys.slice(0, -1).forEach(key => { cursor[key] ??= {}; cursor = cursor[key]; });
  cursor[keys.at(-1)] = value;
}
function numberField(path, label, min, max, step = 1, suffix = '', help = '') {
  const id = `pc-${path.replaceAll('.', '-')}`;
  return `<label class="pc-field" for="${id}"><span>${escapeHtml(label)}</span><div class="pc-input-wrap"><input id="${id}" data-param="${path}" type="number" min="${min}" max="${max}" step="${step}" aria-describedby="${id}-help"><b>${escapeHtml(suffix)}</b></div>${help ? `<small id="${id}-help">${escapeHtml(help)}</small>` : ''}</label>`;
}
function selectField(path, label, options, help = '') {
  const id = `pc-${path.replaceAll('.', '-')}`;
  return `<label class="pc-field" for="${id}"><span>${escapeHtml(label)}</span><select id="${id}" data-param="${path}" aria-describedby="${id}-help">${options.map(([value, text]) => `<option value="${escapeHtml(value)}">${escapeHtml(text)}</option>`).join('')}</select>${help ? `<small id="${id}-help">${escapeHtml(help)}</small>` : ''}</label>`;
}
function checkField(path, label, help = '') {
  const id = `pc-${path.replaceAll('.', '-')}`;
  return `<label class="pc-check" for="${id}"><input id="${id}" data-param="${path}" type="checkbox"><span><b>${escapeHtml(label)}</b>${help ? `<small>${escapeHtml(help)}</small>` : ''}</span></label>`;
}
function weightFields() {
  return [
    numberField('fundamental.weights.value', '割安', 0, 100, 1, '%'),
    numberField('fundamental.weights.quality', '品質', 0, 100, 1, '%'),
    numberField('fundamental.weights.growth', '成長', 0, 100, 1, '%'),
    numberField('fundamental.weights.trapSafety', 'Trap安全性', 0, 100, 1, '%'),
    numberField('fundamental.weights.completeness', 'データ充足率', 0, 100, 1, '%'),
  ].join('');
}
function optionsFrom(selector) {
  const select = $(selector);
  if (!select) return [['', 'すべて']];
  return [...select.options].map(option => [option.value, option.textContent.trim()]);
}
function tabButton(key, label) {
  return `<button type="button" role="tab" id="pc-tab-${key}" aria-controls="pc-panel-${key}" aria-selected="${key === activeTab}" data-pc-tab="${key}">${escapeHtml(label)}</button>`;
}
function panel(key, content) {
  return `<section role="tabpanel" id="pc-panel-${key}" aria-labelledby="pc-tab-${key}" data-pc-panel="${key}" ${key === activeTab ? '' : 'hidden'}>${content}</section>`;
}
function buildMarkup() {
  const marketOptions = optionsFrom('#slMarket');
  const sectorOptions = optionsFrom('#slSector');
  return `
    <div class="pc-heading">
      <div><p class="eyebrow">USER PARAMETER CONTROL</p><h2>パラメータ設定</h2><p>銘柄選定・Fundamental・Technical・リスク・表示を、ここでまとめて調整できます。</p></div>
      <div class="pc-heading-actions"><span id="pcViewportMode">表示判定中</span><strong id="pcChangedCount">変更 0項目</strong></div>
    </div>
    <div class="pc-scope-note" role="note"><strong>ブラウザ内の分析条件</strong><span>日次デモ売買ルールには自動反映されません。実注文も送信されません。</span></div>
    <div class="pc-presets" aria-label="設定プリセット">
      ${Object.entries(PARAMETER_PRESETS).map(([key, preset]) => `<button type="button" data-pc-preset="${key}">${escapeHtml(preset.label)}</button>`).join('')}
      <button type="button" data-pc-preset="default">初期値</button>
    </div>
    <div class="pc-tabs" role="tablist" aria-label="パラメータ分類">
      ${tabButton('selection', '銘柄選定')}${tabButton('fundamental', 'ファンダメンタル')}${tabButton('technical', 'テクニカル')}${tabButton('risk', 'リスク')}${tabButton('display', '表示')}
    </div>
    <div class="pc-panels">
      ${panel('selection', `<div class="pc-panel-intro"><strong>母集団と候補数</strong><p>まずデータ品質と表示件数を決めます。</p></div><div class="pc-grid">${numberField('selection.minOverall','最低 総合スコア',0,100,1,'点')}${numberField('selection.minCompleteness','最低 データ充足率',0,100,1,'%')}${numberField('selection.topN','上位表示件数',1,100,1,'件')}${selectField('selection.market','市場',marketOptions)}${selectField('selection.sector','業種',sectorOptions)}${selectField('selection.missingPolicy','欠損データの扱い',[['allow','許容'],['neutral','中立50点'],['exclude','除外']], '欠損を0点へ自動変換しません。')}</div>`)}
      ${panel('fundamental', `<div class="pc-panel-intro"><strong>企業価値と財務品質</strong><p>割安だけでなく、品質・キャッシュフロー・開示鮮度も条件化します。</p></div><div class="pc-grid">${numberField('fundamental.minValue','最低 割安スコア',0,100,1,'点')}${numberField('fundamental.minQuality','最低 品質スコア',0,100,1,'点')}${numberField('fundamental.minGrowth','最低 成長安定性',0,100,1,'点')}${numberField('fundamental.maxTrap','最大 Value Trap Risk',0,100,1,'点')}${numberField('fundamental.minEarningsYieldPct','最低 利益利回り',-100,100,.5,'%')}${numberField('fundamental.minBookToMarketPct','最低 純資産/時価',-100,500,1,'%')}${numberField('fundamental.minFcfYieldPct','最低 FCF利回り',-100,100,.5,'%')}${numberField('fundamental.minRoePct','最低 ROE',-100,100,.5,'%')}${numberField('fundamental.minOperatingMarginPct','最低 営業利益率',-100,100,.5,'%')}${numberField('fundamental.maxDisclosureAgeDays','最大 開示経過日数',1,3650,1,'日')}</div><h3 class="pc-subtitle">Fundamental再計算ウェイト</h3><div class="pc-grid pc-weight-grid">${weightFields()}</div><p class="pc-weight-note">ウェイトは適用時に合計100%へ自動正規化します。</p>`)}
      ${panel('technical', `<div class="pc-panel-intro"><strong>売買タイミング</strong><p>トレンド・RSI・モメンタム・変動率を個別に設定します。</p></div><div class="pc-grid">${numberField('technical.minScore','最低 Technicalスコア',0,100,1,'点')}${numberField('technical.minRsi','RSI下限',0,100,1)}${numberField('technical.maxRsi','RSI上限',0,100,1)}${numberField('technical.minMomentum20','最低 20日Momentum',-100,200,.5,'%')}${numberField('technical.minMomentum60','最低 60日Momentum',-100,300,.5,'%')}${numberField('technical.maxVolatility','最大 20日Volatility',1,500,1,'%')}${numberField('technical.minDrawdown','許容 20日Drawdown下限',-100,0,.5,'%')}</div><div class="pc-check-grid">${checkField('technical.requirePriceAboveSma20','株価 > SMA20','短期トレンド確認')}${checkField('technical.requireSma20AboveSma60','SMA20 > SMA60','中期上昇基調の確認')}</div>`)}
      ${panel('risk', `<div class="pc-panel-intro"><strong>損失予算と集中上限</strong><p>画面上の警告・研究条件です。証券会社の逆指値ではありません。</p></div><div class="pc-grid">${numberField('risk.maxPortfolioDrawdownPct','最大 ポートフォリオDD',.5,100,.5,'%')}${numberField('risk.maxTotalUnrealizedLossPct','全体 最大含み損率',.5,100,.5,'%')}${numberField('risk.maxTotalUnrealizedLossYen','全体 最大含み損額',10000,100000000,10000,'円')}${numberField('risk.maxPositionLossPct','1銘柄 最大含み損率',.5,100,.5,'%')}${numberField('risk.maxPositionLossYen','1銘柄 最大含み損額',10000,100000000,10000,'円')}${numberField('risk.maxPositionWeightPct','最大 1銘柄比率',1,100,1,'%')}${numberField('risk.maxSectorWeightPct','最大 業種比率',1,100,1,'%')}</div>`)}
      ${panel('display', `<div class="pc-panel-intro"><strong>読みやすさ</strong><p>小さい文字は選べません。設定はこのブラウザへ保存されます。</p></div><div class="pc-display-grid"><fieldset><legend>文字サイズ</legend><label><input type="radio" name="pc-font-scale" data-param="display.fontScale" value="standard"><span>標準</span><small>16px</small></label><label><input type="radio" name="pc-font-scale" data-param="display.fontScale" value="large"><span>大きめ</span><small>18px</small></label><label><input type="radio" name="pc-font-scale" data-param="display.fontScale" value="xlarge"><span>最大</span><small>20px</small></label></fieldset><fieldset><legend>表示密度</legend><label><input type="radio" name="pc-density" data-param="display.density" value="comfortable"><span>標準</span><small>余白を広く</small></label><label><input type="radio" name="pc-density" data-param="display.density" value="compact"><span>コンパクト</span><small>情報量を多く</small></label></fieldset><div class="pc-contrast">${checkField('display.highContrast','高コントラスト','文字・境界・フォーカスを強調')}</div></div><div class="pc-font-preview"><span>表示サンプル</span><strong>東京エレクトロン 8035</strong><p>Fundamental 78.4 / Technical 65.0 / 現在ドローダウン −2.4%</p></div>`)}
    </div>
    <div id="pcValidation" class="pc-validation" role="alert" aria-live="polite" hidden></div>
    <div class="pc-footer">
      <div><span id="pcStatus">未適用の変更はありません。</span><small>保存先: このブラウザのみ</small></div>
      <div class="pc-actions"><button type="button" id="pcReset" class="button ghost">初期値</button><button type="button" id="pcExport" class="button ghost">設定JSON保存</button><label class="button ghost pc-import">設定JSON読込<input id="pcImport" type="file" accept="application/json"></label><button type="button" id="pcApply" class="button primary">適用</button></div>
    </div>`;
}

function loadInitialState() {
  const unified = readJson(PARAMETER_STORAGE_KEY);
  if (unified) return normalizeParameters(unified);
  const legacy = {
    screening: readJson(LEGACY_KEYS.screening),
    fundamental: readJson(LEGACY_KEYS.fundamental),
    risk: readJson(LEGACY_KEYS.risk),
  };
  const hasLegacy = Object.values(legacy).some(Boolean);
  return hasLegacy ? migrateLegacyParameters(legacy) : normalizeParameters(DEFAULT_USER_PARAMETERS);
}

function renderControls() {
  $$('#parameterCenter [data-param]').forEach(control => {
    const value = getPath(state, control.dataset.param);
    if (control.type === 'checkbox') control.checked = Boolean(value);
    else if (control.type === 'radio') control.checked = control.value === value;
    else control.value = value ?? '';
  });
  updateSummary();
}

function collectControls() {
  const draft = clone(state);
  $$('#parameterCenter [data-param]').forEach(control => {
    if (control.type === 'radio' && !control.checked) return;
    let value;
    if (control.type === 'checkbox') value = control.checked;
    else if (control.type === 'number') value = Number(control.value);
    else value = control.value;
    setPath(draft, control.dataset.param, value);
  });
  return normalizeParameters(draft);
}

function updateSummary() {
  const count = countParameterChanges(state);
  $('#pcChangedCount').textContent = `変更 ${count}項目`;
  const result = validateParameters(state);
  const validation = $('#pcValidation');
  const messages = [...result.errors, ...result.warnings];
  if (!messages.length) {
    validation.hidden = true;
    validation.innerHTML = '';
  } else {
    validation.hidden = false;
    validation.className = `pc-validation ${result.errors.length ? 'error' : 'warning'}`;
    validation.innerHTML = `<strong>${result.errors.length ? '設定を修正してください' : '確認してください'}</strong><ul>${messages.map(item => `<li>${escapeHtml(item.message)}</li>`).join('')}</ul>`;
  }
}

function activateTab(key, focus = false) {
  activeTab = key;
  $$('[data-pc-tab]').forEach(button => {
    const active = button.dataset.pcTab === key;
    button.setAttribute('aria-selected', String(active));
    button.tabIndex = active ? 0 : -1;
    if (active && focus) button.focus();
  });
  $$('[data-pc-panel]').forEach(panel => { panel.hidden = panel.dataset.pcPanel !== key; });
}

function applyDisplay(config) {
  const root = document.documentElement;
  root.dataset.fontScale = config.display.fontScale;
  root.dataset.contentDensity = config.display.density;
  root.dataset.highContrast = String(config.display.highContrast);
  root.style.setProperty('--user-root-font-size', `${fontScalePx(config.display.fontScale)}px`);
}

function setExistingControl(id, value) {
  const control = document.getElementById(id);
  if (!control) return;
  if (control.type === 'checkbox') control.checked = Boolean(value);
  else control.value = String(value ?? '');
  control.dispatchEvent(new Event('input', { bubbles: true }));
  control.dispatchEvent(new Event('change', { bubbles: true }));
}

function syncExistingControls(config) {
  const mapping = {
    slMinOverall: config.selection.minOverall,
    slMinCompleteness: config.selection.minCompleteness,
    slTopN: config.selection.topN,
    slMarket: config.selection.market,
    slSector: config.selection.sector,
    slMissing: config.selection.missingPolicy,
    slMinValue: config.fundamental.minValue,
    slMinQuality: config.fundamental.minQuality,
    slMinGrowth: config.fundamental.minGrowth,
    slMaxTrap: config.fundamental.maxTrap,
    slMinTechnical: config.technical.minScore,
    slMinRsi: config.technical.minRsi,
    slMaxRsi: config.technical.maxRsi,
    slMinMomentum20: config.technical.minMomentum20,
    slMinMomentum60: config.technical.minMomentum60,
    slMaxVolatility: config.technical.maxVolatility,
    slMinDrawdown: config.technical.minDrawdown,
    slPriceAbove: config.technical.requirePriceAboveSma20,
    slSmaTrend: config.technical.requireSma20AboveSma60,
    ftValue: config.fundamental.minValue,
    ftQuality: config.fundamental.minQuality,
    ftGrowth: config.fundamental.minGrowth,
    ftTrap: config.fundamental.maxTrap,
    ftCompleteness: config.selection.minCompleteness,
    ftEarnings: config.fundamental.minEarningsYieldPct,
    ftBook: config.fundamental.minBookToMarketPct,
    ftFcf: config.fundamental.minFcfYieldPct,
    ftRoe: config.fundamental.minRoePct,
    ftMargin: config.fundamental.minOperatingMarginPct,
    ftDisclosure: config.fundamental.maxDisclosureAgeDays,
    ftMissing: config.selection.missingPolicy,
    ftWeightValue: config.fundamental.weights.value,
    ftWeightQuality: config.fundamental.weights.quality,
    ftWeightGrowth: config.fundamental.weights.growth,
    ftWeightTrap: config.fundamental.weights.trapSafety,
    ftWeightCompleteness: config.fundamental.weights.completeness,
    rdMaxDd: config.risk.maxPortfolioDrawdownPct,
    rdTotalPct: config.risk.maxTotalUnrealizedLossPct,
    rdTotalYen: config.risk.maxTotalUnrealizedLossYen,
    rdPosPct: config.risk.maxPositionLossPct,
    rdPosYen: config.risk.maxPositionLossYen,
    rdWeight: config.risk.maxPositionWeightPct,
  };
  Object.entries(mapping).forEach(([id, value]) => setExistingControl(id, value));
  const stores = legacyStoresFromParameters(config);
  Object.entries(LEGACY_KEYS).forEach(([name, key]) => {
    const existing = readJson(key) ?? {};
    writeJson(key, { ...existing, ...stores[name], weights: stores[name]?.weights ?? existing.weights });
  });
}

function applyState(config, announce = true) {
  const result = validateParameters(config);
  state = result.config;
  renderControls();
  if (!result.valid) {
    $('#pcStatus').textContent = '入力エラーがあるため適用していません。';
    return false;
  }
  writeJson(PARAMETER_STORAGE_KEY, state);
  applyDisplay(state);
  syncExistingControls(state);
  if (announce) $('#pcStatus').textContent = `適用しました（${countParameterChanges(state)}項目を初期値から変更）。`;
  window.dispatchEvent(new CustomEvent('valuescope:parameters-changed', { detail: clone(state) }));
  return true;
}

function exportJson() {
  const blob = new Blob([JSON.stringify(state, null, 2)], { type: 'application/json' });
  const link = document.createElement('a');
  link.href = URL.createObjectURL(blob);
  link.download = 'valuescope-user-parameters-v2.json';
  link.click();
  URL.revokeObjectURL(link.href);
}

function updateViewportLabel() {
  const width = window.innerWidth;
  const label = width <= 767 ? 'iPhone表示' : width <= 1180 ? 'iPad表示' : 'PC表示';
  document.documentElement.dataset.viewportClass = width <= 767 ? 'phone' : width <= 1180 ? 'tablet' : 'desktop';
  const local = $('#pcViewportMode');
  if (local) local.textContent = label;
  const adaptive = $('#adaptiveModeIndicator');
  if (adaptive) adaptive.textContent = label;
  const mobile = $('#adaptiveMobileHeader > span');
  if (mobile) mobile.textContent = label;
}

function bindEvents() {
  $('#parameterCenter').addEventListener('input', () => {
    state = collectControls();
    updateSummary();
    $('#pcStatus').textContent = '未適用の変更があります。';
    if (event?.target?.dataset?.param?.startsWith('display.')) applyDisplay(state);
  });
  $('.pc-tabs').addEventListener('click', event => {
    const button = event.target.closest('[data-pc-tab]');
    if (button) activateTab(button.dataset.pcTab);
  });
  $('.pc-tabs').addEventListener('keydown', event => {
    if (!['ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(event.key)) return;
    const tabs = $$('[data-pc-tab]');
    const current = tabs.findIndex(tab => tab.dataset.pcTab === activeTab);
    let next = current;
    if (event.key === 'ArrowRight') next = (current + 1) % tabs.length;
    if (event.key === 'ArrowLeft') next = (current - 1 + tabs.length) % tabs.length;
    if (event.key === 'Home') next = 0;
    if (event.key === 'End') next = tabs.length - 1;
    event.preventDefault();
    activateTab(tabs[next].dataset.pcTab, true);
  });
  $$('.pc-presets [data-pc-preset]').forEach(button => button.addEventListener('click', () => {
    state = applyParameterPreset(button.dataset.pcPreset, state);
    renderControls();
    applyDisplay(state);
    $('#pcStatus').textContent = `${button.textContent.trim()}プリセットを選択しました。適用ボタンで確定します。`;
  }));
  $('#pcApply').addEventListener('click', () => applyState(collectControls()));
  $('#pcReset').addEventListener('click', () => {
    state = normalizeParameters(DEFAULT_USER_PARAMETERS);
    localStorage.removeItem(PARAMETER_STORAGE_KEY);
    renderControls();
    applyState(state);
    $('#pcStatus').textContent = '初期値へ戻しました。';
  });
  $('#pcExport').addEventListener('click', exportJson);
  $('#pcImport').addEventListener('change', async event => {
    const file = event.target.files?.[0];
    if (!file) return;
    try {
      const imported = JSON.parse(await file.text());
      state = normalizeParameters(imported);
      renderControls();
      $('#pcStatus').textContent = '設定JSONを読み込みました。適用ボタンで確定します。';
    } catch {
      $('#pcValidation').hidden = false;
      $('#pcValidation').className = 'pc-validation error';
      $('#pcValidation').innerHTML = '<strong>設定JSONを読み込めませんでした。</strong>';
    } finally {
      event.target.value = '';
    }
  });
  window.addEventListener('resize', updateViewportLabel, { passive: true });
  window.addEventListener('orientationchange', () => requestAnimationFrame(updateViewportLabel));
}

function insertCenter() {
  if ($('#parameterCenter')) return true;
  const screening = $('#screeningLab');
  if (!screening) return false;
  const center = document.createElement('section');
  center.id = 'parameterCenter';
  center.className = 'parameter-center adaptive-ordered';
  center.style.setProperty('--adaptive-order', '29.5');
  center.setAttribute('aria-labelledby', 'pc-title');
  center.innerHTML = buildMarkup().replace('<h2>パラメータ設定</h2>', '<h2 id="pc-title">パラメータ設定</h2>');
  screening.before(center);
  state = loadInitialState();
  renderControls();
  applyDisplay(state);
  bindEvents();
  updateViewportLabel();
  return true;
}

function start() {
  if (insertCenter()) return;
  observer = new MutationObserver(() => {
    if (!insertCenter()) return;
    observer.disconnect();
  });
  observer.observe(document.documentElement, { childList: true, subtree: true });
  window.setTimeout(() => observer?.disconnect(), 15000);
}

if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', start, { once: true });
else start();
