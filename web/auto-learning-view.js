import { browserBundlePatch, gateProgress, groupOverrides, learningModeInfo, mergeBundle } from './auto-learning-core.js';

const STORAGE_KEY = 'valuescope-parameter-bundle-v1';
const $ = selector => document.querySelector(selector);
const escapeHtml = value => String(value ?? '').replace(/[&<>"']/g, character => ({ '&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;' })[character]);
const number = (value, digits = 2) => Number.isFinite(Number(value)) ? Number(value).toFixed(digits) : '–';
let payload = null;
let observer = null;

async function getJson(path) {
  if (window.ValueScopeData?.getJson) return window.ValueScopeData.getJson(path);
  const response = await fetch(path, { cache:'default' });
  if (!response.ok) throw new Error(`HTTP ${response.status}`);
  return response.json();
}

function install() {
  if ($('#autoLearningPanel')) return true;
  const anchor = $('#investmentDecisionReport') ?? $('#strategyLab') ?? $('#screeningLab');
  if (!anchor) return false;
  const panel = document.createElement('section');
  panel.id = 'autoLearningPanel';
  panel.className = 'auto-learning-panel adaptive-ordered';
  panel.style.setProperty('--adaptive-order', '55');
  panel.innerHTML = `<div class="al-loading">自動学習の状態を読み込んでいます。</div>`;
  anchor.before(panel);
  load();
  return true;
}

function gateCard(gate) {
  return `<article class="al-gate ${gate.passed ? 'passed' : 'failed'}"><header><span>${gate.passed ? '✓' : '–'}</span><strong>${escapeHtml(gate.name)}</strong></header><p>${escapeHtml(gate.explanation ?? '')}</p><small>現在: ${escapeHtml(JSON.stringify(gate.actual))} / 基準: ${escapeHtml(JSON.stringify(gate.required))}</small></article>`;
}

function overrideGroup(label, values, category) {
  const entries = Object.entries(values ?? {});
  return `<article class="al-override category-${category}"><header><span>${category}</span><strong>${escapeHtml(label)}</strong></header>${entries.length ? `<dl>${entries.map(([key, value]) => `<div><dt>${escapeHtml(key)}</dt><dd>${number(value)}</dd></div>`).join('')}</dl>` : '<p>変更候補なし</p>'}</article>`;
}

function render() {
  const mode = learningModeInfo(payload.mode);
  const progress = gateProgress(payload);
  const candidate = payload.candidate ?? {};
  const groups = groupOverrides(candidate.proposed_overrides ?? {});
  const active = payload.active ?? {};
  const obs = payload.observations ?? {};
  $('#autoLearningPanel').innerHTML = `<div class="al-heading"><div><p class="eyebrow">ADAPTIVE PAPER LEARNING</p><h2>自動学習・自動修正</h2><p>過去とデモ実績をwalk-forwardで評価し、安全ゲート通過時だけデモ用パラメータを期限付き変更します。</p></div><span class="al-mode ${mode.tone}">${escapeHtml(mode.label)}</span></div><div class="al-safety"><strong>実注文には接続しません</strong><span>${escapeHtml(mode.description)}</span></div><div class="al-progress"><article><span>運用可能データ</span><strong>${obs.operational ?? 0} / ${obs.required_operational ?? 169}</strong><small>営業日</small></article><article><span>OOS検証</span><strong>${obs.oos ?? 0} / ${obs.required_oos ?? 42}</strong><small>未使用期間</small></article><article><span>安全ゲート</span><strong>${progress.passed} / ${progress.total}</strong><small>全通過が必要</small></article><article><span>連続確認</span><strong>${payload.confirmation?.current ?? 0} / ${payload.confirmation?.required ?? 2}</strong><small>週次確認</small></article></div><div class="al-candidate"><div><span>現在の研究候補</span><strong>${escapeHtml(candidate.strategy ?? '候補なし')}</strong><small>Objective ${number(candidate.objective_score)} · Baseline差 ${number(candidate.baseline_excess_pct)}%</small></div><div><span>現在のデモ設定</span><strong>${escapeHtml(active.strategy ?? '既定ルール')}</strong><small>${escapeHtml(active.reason ?? '')}</small></div></div><h3>候補パラメータの分類</h3><div class="al-overrides">${overrideGroup('何を保有するか', groups.Fundamental, 'f')}${overrideGroup('いつ入る・出るか', groups.Technical, 't')}${overrideGroup('損失をどう抑えるか', groups.Risk, 'r')}</div><details class="al-gates"><summary>安全ゲートを確認</summary><div>${(payload.gates ?? []).map(gateCard).join('') || '<p>次回の週次学習で評価します。</p>'}</div></details><div class="al-actions"><button id="alCopy" class="button ghost" type="button" ${Object.keys(candidate.proposed_overrides ?? {}).length ? '' : 'disabled'}>候補をブラウザ条件へコピー</button><button id="alOpenParameters" class="button primary" type="button">パラメータ画面を開く</button></div><p id="alStatus" class="al-status">${escapeHtml(payload.next_action ?? '')}</p><p class="al-disclaimer">${escapeHtml(payload.disclaimer ?? '')}</p>`;
  $('#alCopy')?.addEventListener('click', copyCandidate);
  $('#alOpenParameters')?.addEventListener('click', openParameters);
}

function readBundle() {
  try { return JSON.parse(localStorage.getItem(STORAGE_KEY) ?? '{}'); } catch { return {}; }
}

function copyCandidate() {
  const overrides = payload.candidate?.proposed_overrides ?? {};
  if (!Object.keys(overrides).length) return;
  const updated = mergeBundle(readBundle(), browserBundlePatch(overrides));
  updated.preset = 'custom';
  localStorage.setItem(STORAGE_KEY, JSON.stringify(updated));
  window.dispatchEvent(new CustomEvent('valuescope:parameters-changed', { detail:updated }));
  $('#alStatus').textContent = '候補をブラウザ内パラメータへコピーしました。日次デモルールには未反映です。';
}

function openParameters() {
  const button = $('#adaptiveLargeNav [data-adaptive-target="screening"],#adaptiveMobileNav [data-adaptive-target="screening"]');
  button?.click();
  setTimeout(() => $('#parameterControl')?.scrollIntoView({ behavior:'smooth', block:'start' }), 120);
}

async function load() {
  try {
    payload = await getJson('./data/auto-learning/latest.json');
    render();
  } catch (error) {
    $('#autoLearningPanel').innerHTML = `<div class="al-error"><strong>自動学習データを読み込めません。</strong><p>${escapeHtml(error.message)}</p></div>`;
  }
}

function start() {
  if (install()) return;
  observer = new MutationObserver(() => { if (install()) observer.disconnect(); });
  observer.observe(document.documentElement, { childList:true, subtree:true });
  setTimeout(() => observer?.disconnect(), 20000);
}

if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', start, { once:true }); else start();
