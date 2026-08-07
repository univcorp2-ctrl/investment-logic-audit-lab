import { PHONE_TASKS, adjacentTask, normalizePhoneTask, normalizePhoneView, parsePhoneState, phoneHash, taskDefinition } from './mobile-task-flow-core.js';

const PHONE_QUERY='(max-width: 767px)';
const media=window.matchMedia(PHONE_QUERY);
const STORAGE='valuescope-phone-task-v1';
const state={view:'overview',task:'summary',observer:null,scheduled:false,initialized:false};
const $=selector=>document.querySelector(selector);
const $$=selector=>[...document.querySelectorAll(selector)];

const MODULES=Object.freeze({
  overview:['#overviewSection','#demoTrade','#dataNotice','#dataError'],
  decision:['#investmentDecisionReport','.ranking','#securityDetailLauncher'],
  screening:['#parameterControl','#screeningLab','#fundamentalTuning','#adaptiveLegacyDetails'],
  performance:['#demoTrade','#performanceAnalytics','#riskDiagnostics'],
  data:['#investmentDecisionReport','#adaptiveLearning','#securityDetailLauncher'],
});

function savedState(){try{return JSON.parse(sessionStorage.getItem(STORAGE)??'null')}catch{return null}}
function remember(){try{sessionStorage.setItem(STORAGE,JSON.stringify({view:state.view,task:state.task}))}catch{/* optional */}}
function allModuleSelectors(){return [...new Set(Object.values(MODULES).flat())]}
function setVisible(node,visible){if(!node)return;node.hidden=!visible;node.setAttribute('aria-hidden',String(!visible));node.classList.toggle('phone-task-visible',visible)}
function click(selector){const node=$(selector);if(node instanceof HTMLElement)node.click()}

function selectedNodes(){
  const view=state.view,task=state.task;
  if(view==='overview')return task==='summary'?['#overviewSection']:task==='demo'?['#demoTrade']:['#dataNotice','#dataError'];
  if(view==='decision')return task==='recommendation'?['#investmentDecisionReport']:task==='ranking'?['.ranking']:['#securityDetailLauncher'];
  if(view==='screening')return task==='advanced'?['#screeningLab','#fundamentalTuning','#adaptiveLegacyDetails']:['#parameterControl'];
  if(view==='performance')return task==='current'?['#demoTrade']:task==='diagnosis'?['#riskDiagnostics']:['#performanceAnalytics'];
  if(view==='data')return task==='learning'?['#adaptiveLearning']:task==='strategy'||task==='plans'||task==='disclosure'?['#investmentDecisionReport']:['#securityDetailLauncher'];
  return ['#overviewSection'];
}

function activateInnerControls(){
  const definition=taskDefinition(state.view,state.task);
  if(definition.parameterTab)click(`[data-parameter-tab="${definition.parameterTab}"]`);
  if(definition.decisionTab)click(`.dr-tabs [data-tab="${definition.decisionTab}"]`);
  document.body.dataset.phoneView=state.view;
  document.body.dataset.phoneTask=state.task;
}

function applyVisibility(){
  if(!media.matches){
    allModuleSelectors().forEach(selector=>$$(selector).forEach(node=>{node.hidden=false;node.removeAttribute('aria-hidden');node.classList.remove('phone-task-visible')}));
    document.documentElement.removeAttribute('data-phone-task-flow');
    return;
  }
  document.documentElement.dataset.phoneTaskFlow='active';
  const selected=new Set(selectedNodes());
  allModuleSelectors().forEach(selector=>$$(selector).forEach(node=>setVisible(node,selected.has(selector))));
  activateInnerControls();
  updateBar();
}

function updateBar(){
  const bar=$('#mobileTaskFlow');if(!bar)return;
  const tasks=PHONE_TASKS[state.view];
  bar.querySelector('.mobile-task-title strong').textContent=tasks.find(item=>item.key===state.task)?.label??'';
  bar.querySelector('.mobile-task-progress').textContent=`${tasks.findIndex(item=>item.key===state.task)+1} / ${tasks.length}`;
  const list=bar.querySelector('.mobile-task-list');
  list.innerHTML=tasks.map(item=>`<button type="button" data-mobile-task="${item.key}" aria-current="${item.key===state.task?'page':'false'}">${item.label}</button>`).join('');
  bar.querySelector('[data-mobile-prev]').disabled=tasks[0].key===state.task;
  bar.querySelector('[data-mobile-next]').disabled=tasks.at(-1).key===state.task;
}

function setState(view,task,{historyMode='push',scroll=true}={}){
  state.view=normalizePhoneView(view);state.task=normalizePhoneTask(state.view,task);remember();
  const nextHash=phoneHash(location.hash,state.view,state.task);
  if(historyMode==='replace')history.replaceState({phoneTask:true},'',nextHash);
  else if(historyMode==='push')history.pushState({phoneTask:true},'',nextHash);
  applyVisibility();
  if(scroll)requestAnimationFrame(()=>$('#mobileTaskFlow')?.scrollIntoView({behavior:matchMedia('(prefers-reduced-motion: reduce)').matches?'auto':'smooth',block:'start'}));
}

function installBar(){
  if($('#mobileTaskFlow'))return;
  const bar=document.createElement('nav');bar.id='mobileTaskFlow';bar.className='mobile-task-flow';bar.setAttribute('aria-label','iPhone画面内ナビゲーション');
  bar.innerHTML='<div class="mobile-task-title"><button type="button" data-mobile-prev aria-label="前の画面">‹</button><div><small>現在の画面</small><strong></strong></div><span class="mobile-task-progress"></span><button type="button" data-mobile-next aria-label="次の画面">›</button></div><div class="mobile-task-list"></div>';
  ($('#adaptiveMobileHeader')??document.body.firstElementChild)?.after(bar);
  bar.addEventListener('click',event=>{const task=event.target.closest('[data-mobile-task]');if(task){setState(state.view,task.dataset.mobileTask);return}if(event.target.closest('[data-mobile-prev]'))setState(state.view,adjacentTask(state.view,state.task,-1));if(event.target.closest('[data-mobile-next]'))setState(state.view,adjacentTask(state.view,state.task,1));});
}

function bindPrimaryNav(){
  document.addEventListener('click',event=>{const button=event.target.closest('[data-adaptive-target]');if(!button||!media.matches)return;const view=normalizePhoneView(button.dataset.adaptiveTarget);const stored=savedState();const task=stored?.view===view?stored.task:PHONE_TASKS[view][0].key;setTimeout(()=>setState(view,task,{historyMode:'push'}),0)},true);
  window.addEventListener('popstate',()=>{if(!media.matches)return;const parsed=parsePhoneState(location.hash);state.view=parsed.view;state.task=parsed.task;applyVisibility()});
}

function watch(){
  if(state.observer)return;
  state.observer=new MutationObserver(()=>{if(state.scheduled)return;state.scheduled=true;requestAnimationFrame(()=>{state.scheduled=false;applyVisibility()})});
  state.observer.observe(document.querySelector('main')??document.body,{childList:true,subtree:true});
}

function initializeState(){const parsed=parsePhoneState(location.hash);const stored=savedState();state.view=parsed.params.has('view')?parsed.view:normalizePhoneView(stored?.view);state.task=parsed.params.has('task')?parsed.task:normalizePhoneTask(state.view,stored?.task);history.replaceState({phoneTask:true},'',phoneHash(location.hash,state.view,state.task));}
function init(){if(state.initialized)return;state.initialized=true;installBar();initializeState();bindPrimaryNav();watch();applyVisibility();media.addEventListener('change',applyVisibility);window.addEventListener('orientationchange',()=>requestAnimationFrame(applyVisibility),{passive:true})}
if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',init,{once:true});else init();
