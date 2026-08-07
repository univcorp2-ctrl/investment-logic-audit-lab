import {
  AI_BROWSER_PREFERENCES_KEY,
  DEFAULT_AI_BROWSER_PREFERENCES,
  groupedImportance,
  learningProgress,
  learningStatusLabel,
  mapAiProposalToParameterBundle,
  normalizeAiPreferences,
  proposalChanges,
} from './ai-learning-core.js';
import {
  PARAMETER_STORAGE_KEYS,
  bundleFromStorage,
  normalizeParameterBundle,
  storagePayloads,
} from './parameter-control-core.js';

const $ = selector => document.querySelector(selector);
const esc = value => String(value ?? '').replace(/[&<>'"]/g, char => ({'&':'&amp;','<':'&lt;','>':'&gt;',"'":'&#39;','"':'&quot;'}[char]));
const pct = value => Number.isFinite(Number(value)) ? `${(Number(value)*100).toFixed(1)}%` : '–';
let latest = null;
let proposals = {proposals:[]};
let preferences = normalizeAiPreferences(JSON.parse(localStorage.getItem(AI_BROWSER_PREFERENCES_KEY) ?? 'null') ?? DEFAULT_AI_BROWSER_PREFERENCES);

async function getJson(path, fallback) {
  try { const response=await fetch(path); return response.ok?await response.json():fallback; } catch { return fallback; }
}

function ensurePanel() {
  if ($('#aiLearningPanel')) return;
  const panel=document.createElement('section');
  panel.id='aiLearningPanel';
  panel.className='ai-learning-panel adaptive-ordered';
  panel.style.setProperty('--adaptive-order','18.5');
  panel.innerHTML=`<div class="ai-head"><div><p class="eyebrow">GUARDED ADAPTIVE LEARNING</p><h2>AI学習・自動補正</h2><p>日次デモの特徴量を蓄積し、時系列OOS検証を通過した小幅な変更だけをデモ戦略候補にします。</p></div><span id="aiStatus" class="ai-status">読込中</span></div><div class="ai-safety"><strong>実注文なし・過学習防止</strong><span>履歴不足時は収集のみ。提案と自動適用には厳格なゲートとロールバック条件があります。</span></div><div id="aiOverview" class="ai-overview"></div><div id="aiProgress" class="ai-progress"></div><div class="ai-grid"><article><header><span class="fundamental">Fundamental</span><h3>重要度</h3></header><div id="aiFundamentalImportance"></div></article><article><header><span class="technical">Technical</span><h3>重要度</h3></header><div id="aiTechnicalImportance"></div></article></div><section class="ai-proposals"><h3>提案されたパラメータ変更</h3><div id="aiProposalList"></div><button id="aiCopyProposal" type="button" class="button primary" disabled>AI提案をブラウザ条件へ適用</button><small>ブラウザ内の比較条件だけを変更します。GitHubの日次デモ戦略や実注文には直接反映しません。</small></section><details class="ai-browser-settings"><summary>ブラウザ内のAI比較設定</summary><div class="ai-setting-grid"><label>収益ウェイト %<input id="aiWeightReturn" type="number" min="0" max="100"></label><label>DD改善ウェイト %<input id="aiWeightDrawdown" type="number" min="0" max="100"></label><label>安定性ウェイト %<input id="aiWeightStability" type="number" min="0" max="100"></label><label>回転率ペナルティ %<input id="aiWeightTurnover" type="number" min="0" max="100"></label><label>最低確信度 %<input id="aiMinConfidence" type="number" min="50" max="100"></label><label>週次最大変更 %<input id="aiMaxChange" type="number" min="1" max="20"></label></div><button id="aiSavePreferences" type="button" class="button ghost">比較設定を保存</button><p id="aiPreferenceStatus" aria-live="polite"></p></details><details class="ai-audit"><summary>ガードレールと監査履歴</summary><div id="aiGuardrails"></div></details>`;
  const anchor=$('#strategySection')??$('#dataPlanSection')??$('#parameterControl')??$('main');
  anchor?.before(panel);
  bind();
}

function importanceRows(rows) {
  if (!rows.length) return '<p class="ai-empty">学習完了後に表示します。</p>';
  const max=Math.max(...rows.map(row=>Number(row.importance)||0),1e-9);
  return rows.slice(0,8).map(row=>`<div class="ai-importance"><span>${esc(row.feature)}</span><i><em style="width:${(Number(row.importance)||0)/max*100}%"></em></i><b>${pct(row.importance)}</b></div>`).join('');
}

function render() {
  if (!latest) return;
  $('#aiStatus').textContent=learningStatusLabel(latest.status);
  $('#aiStatus').className=`ai-status status-${esc(latest.status)}`;
  const oos=latest.oos??{};
  $('#aiOverview').innerHTML=`<article><span>モード</span><strong>${esc(latest.mode)}</strong></article><article><span>設定version</span><strong>${latest.active_config_version??1}</strong></article><article><span>OOS fold</span><strong>${oos.folds??0}</strong></article><article><span>OOS日数</span><strong>${oos.days??0}</strong></article><article><span>確信度</span><strong>${oos.confidence===undefined?'–':pct(oos.confidence)}</strong></article><article><span>自動適用</span><strong>${latest.applied?'適用済み':'未適用'}</strong></article>`;
  $('#aiProgress').innerHTML=learningProgress(latest).map(row=>`<article><div><span>${row.label}</span><b>${row.value} / ${row.target}</b></div><i><em style="width:${row.pct}%"></em></i></article>`).join('');
  const groups=groupedImportance(latest);
  $('#aiFundamentalImportance').innerHTML=importanceRows(groups.Fundamental);
  $('#aiTechnicalImportance').innerHTML=importanceRows(groups.Technical);
  const changes=proposalChanges(latest,proposals);
  $('#aiProposalList').innerHTML=changes.length?changes.map(row=>`<article><strong>${esc(row.parameter)}</strong><span>${esc(row.old)} → ${esc(row.new)}</span><small>相対変更 ${Number(row.relative_change??0)>=0?'+':''}${(Number(row.relative_change??0)*100).toFixed(2)}%</small></article>`).join(''):'<p class="ai-empty">現在は提案なし。必要な履歴を収集しています。</p>';
  $('#aiCopyProposal').disabled=!changes.length;
  const gates=latest.gates??{};
  const checks=Object.entries(gates.checks??{}).map(([key,value])=>`<li class="${value?'pass':'wait'}">${esc(key)}: ${value?'通過':'未達'}</li>`).join('');
  const warnings=(latest.warnings??[]).map(item=>`<li>${esc(item)}</li>`).join('');
  $('#aiGuardrails').innerHTML=`<h4>学習開始条件</h4><ul>${checks}</ul><h4>警告</h4><ul>${warnings||'<li>なし</li>'}</ul><p>自動適用後は10営業日のシャドー比較を行い、旧設定比で2ポイント以上悪化した場合はロールバック対象です。</p>`;
  setPreferenceFields();
  installCompactCard();
}

function setPreferenceFields(){const w=preferences.objectiveWeights;$('#aiWeightReturn').value=w.return;$('#aiWeightDrawdown').value=w.drawdown;$('#aiWeightStability').value=w.stability;$('#aiWeightTurnover').value=w.turnoverPenalty;$('#aiMinConfidence').value=preferences.minimumConfidence;$('#aiMaxChange').value=preferences.maximumWeeklyChange;}
function readPreferences(){return normalizeAiPreferences({objectiveWeights:{return:$('#aiWeightReturn').value,drawdown:$('#aiWeightDrawdown').value,stability:$('#aiWeightStability').value,turnoverPenalty:$('#aiWeightTurnover').value},minimumConfidence:$('#aiMinConfidence').value,maximumWeeklyChange:$('#aiMaxChange').value});}
function copyProposal(){const current=bundleFromStorage(localStorage);const updated=normalizeParameterBundle(mapAiProposalToParameterBundle(current,latest,proposals));for(const[key,value]of Object.entries(storagePayloads(updated))){if(typeof value==='string')localStorage.setItem(key,value);else localStorage.setItem(key,JSON.stringify(value));}window.dispatchEvent(new CustomEvent('valuescope:parameters-changed',{detail:updated}));$('#aiCopyProposal').textContent='ブラウザ条件へ適用しました';window.setTimeout(()=>{$('#aiCopyProposal').textContent='AI提案をブラウザ条件へ適用';},1800);}
function installCompactCard(){const host=$('#parameterControl');if(!host||$('#aiParameterSummary'))return;const card=document.createElement('aside');card.id='aiParameterSummary';card.className='ai-parameter-summary';card.innerHTML=`<span>AI学習</span><strong>${esc(learningStatusLabel(latest.status))}</strong><small>${latest.gates?.actual?.matured_rows??0}/${latest.gates?.required?.matured_rows??500} 成熟行 · version ${latest.active_config_version??1}</small><button type="button">詳細を見る</button>`;card.querySelector('button').addEventListener('click',()=>{window.ValueScopeMobileRouter?.open?.('data');$('#aiLearningPanel')?.scrollIntoView({block:'start'});});host.prepend(card);}
function bind(){$('#aiCopyProposal').addEventListener('click',copyProposal);$('#aiSavePreferences').addEventListener('click',()=>{preferences=readPreferences();localStorage.setItem(AI_BROWSER_PREFERENCES_KEY,JSON.stringify(preferences));setPreferenceFields();$('#aiPreferenceStatus').textContent='ブラウザ内の比較設定を保存しました。サーバーの学習ポリシーは変更しません。';});}
async function start(){ensurePanel();[latest,proposals]=await Promise.all([getJson('./data/adaptive-learning/latest.json',null),getJson('./data/adaptive-learning/proposals.json',{proposals:[]})]);if(!latest){$('#aiStatus').textContent='未実行';$('#aiOverview').innerHTML='<p class="ai-empty">AI学習結果がまだありません。</p>';return;}render();}
if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',start,{once:true});else start();
