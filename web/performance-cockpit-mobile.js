import { correctedEquitySeries, finite, liveLedgerMark } from './performance-cockpit-core.js';
import { combinedRiskHero, extractChartPointLabels, graphSizePx, nextGraphSize } from './performance-cockpit-mobile-core.js';

const SIZE_KEY='valuescope-performance-chart-size-v1';
const ZOOM_KEY='valuescope-performance-chart-zoom-v1';
const $=s=>document.querySelector(s);
const yen=v=>finite(v)===null?'–':new Intl.NumberFormat('ja-JP',{style:'currency',currency:'JPY',maximumFractionDigits:0}).format(Number(v));
const pct=(v,d=2)=>finite(v)===null?'–':`${Number(v)>=0?'+':''}${Number(v).toFixed(d)}%`;
const date=v=>v?String(v).slice(0,10).replaceAll('-','/'):'–';
const esc=v=>String(v??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
let size=localStorage.getItem(SIZE_KEY)||'normal';
let zoom=localStorage.getItem(ZOOM_KEY)||'all';
let portfolio=null,history=[],series=[],live=null;
let periodListenerInstalled=false;

async function getJson(path,fallback){try{const response=await fetch(path);return response.ok?await response.json():fallback}catch{return fallback}}

function activePeriod(){return document.querySelector('[data-pcock-period][aria-pressed="true"]')?.dataset?.pcockPeriod||zoom||'all'}
function periodLabel(period){return({all:'全期間','1y':'1Y','6m':'6M','3m':'3M','1m':'1M','1w':'1W'})[period]||period}
function sizeLabel(value){return({compact:'小',normal:'標準',large:'大'})[value]||'標準'}

function installUi(){
  const cockpit=$('#performanceCockpit');
  if(!cockpit||$('#pcockMobileHero'))return false;
  const hero=document.createElement('section');
  hero.id='pcockMobileHero';
  hero.className='pcock-mobile-hero';
  hero.setAttribute('aria-label','主要パフォーマンス');
  cockpit.querySelector('.pcock-header')?.after(hero);
  const chart=$('#pcockChart');
  if(chart&&!$('#pcockGraphTools')){
    const tools=document.createElement('div');
    tools.id='pcockGraphTools';
    tools.className='pcock-graph-tools';
    tools.innerHTML=`<div class="pcock-size-controls" role="group" aria-label="グラフ表示サイズ"><button type="button" id="pcockShrink">縮小</button><button type="button" id="pcockResetGraph">リセット</button><button type="button" id="pcockGrow">拡大</button></div><span id="pcockZoomStatus">グラフ: 標準 / 全期間</span>`;
    chart.before(tools);
    const readout=document.createElement('div');
    readout.id='pcockPointReadout';
    readout.className='pcock-point-readout';
    readout.setAttribute('aria-live','polite');
    readout.textContent='グラフ上の日付を選ぶと値を表示します。';
    chart.after(readout);
    const strip=document.createElement('nav');
    strip.id='pcockDateStrip';
    strip.className='pcock-date-strip';
    strip.setAttribute('aria-label','グラフの日付一覧');
    readout.after(strip);
    $('#pcockShrink').addEventListener('click',()=>changeGraphSize(-1));
    $('#pcockGrow').addEventListener('click',()=>changeGraphSize(1));
    $('#pcockResetGraph').addEventListener('click',resetGraph);
  }
  installPeriodListener();
  applyGraphSize();
  observeChart();
  return true;
}

function installPeriodListener(){
  if(periodListenerInstalled)return;
  periodListenerInstalled=true;
  document.addEventListener('click',event=>{
    const button=event.target.closest('[data-pcock-period]');
    if(!button)return;
    zoom=button.dataset.pcockPeriod||'all';
    localStorage.setItem(ZOOM_KEY,zoom);
    requestAnimationFrame(applyGraphSize);
  });
}

function applyGraphSize(){
  const cockpit=$('#performanceCockpit');
  if(!cockpit)return;
  cockpit.dataset.graphSize=size;
  cockpit.style.setProperty('--pcock-user-chart-height',`${graphSizePx(size,matchMedia('(max-width:767px)').matches)}px`);
  const status=$('#pcockZoomStatus');
  if(status)status.textContent=`グラフ: ${sizeLabel(size)} / ${periodLabel(activePeriod())}`;
}

function changeGraphSize(direction){
  size=nextGraphSize(size,direction);
  localStorage.setItem(SIZE_KEY,size);
  applyGraphSize();
}

function resetGraph(){
  size='normal';
  localStorage.setItem(SIZE_KEY,size);
  applyGraphSize();
  const all=document.querySelector('[data-pcock-period="all"]');
  if(all&&all.getAttribute('aria-pressed')!=='true'){
    zoom='all';
    localStorage.setItem(ZOOM_KEY,zoom);
    requestAnimationFrame(()=>all.click());
  }
}

function observeChart(){
  const chart=$('#pcockChart');if(!chart||chart.dataset.mobileEnhanced)return;
  chart.dataset.mobileEnhanced='true';
  new MutationObserver(rebuildDateStrip).observe(chart,{childList:true,subtree:true});
  chart.addEventListener('focusin',event=>showPoint(event.target));
  chart.addEventListener('click',event=>showPoint(event.target));
  chart.addEventListener('pointerover',event=>showPoint(event.target));
  rebuildDateStrip();
}

function showPoint(target){
  const group=target.closest('circle,rect');
  const text=group?.querySelector('title')?.textContent;
  const label=extractChartPointLabels([text])[0];
  if(label)$('#pcockPointReadout').textContent=label.fullText;
}

function rebuildDateStrip(){
  const strip=$('#pcockDateStrip'),chart=$('#pcockChart');if(!strip||!chart)return;
  const nodes=[...chart.querySelectorAll('circle title,rect title')];
  const labels=extractChartPointLabels(nodes.map(node=>node.textContent));
  strip.innerHTML=labels.map((item,index)=>`<button type="button" data-date-index="${index}" aria-label="${esc(item.fullText)}"><b>${esc(item.shortDate)}</b><small>${esc(item.valueText)}</small></button>`).join('');
  [...strip.querySelectorAll('button')].forEach((button,index)=>button.addEventListener('click',()=>{
    const point=nodes[index]?.parentElement;point?.focus?.();
    $('#pcockPointReadout').textContent=labels[index]?.fullText??'';
  }));
}

function renderHero(){
  const host=$('#pcockMobileHero');if(!host||!portfolio)return;
  const last=series.at(-1);
  const profitReturn=live?.total_return_pct??last?.cumulative_return_pct??null;
  const profitPnl=live?.total_pnl??last?.total_pnl??null;
  const source=live?`現在値 · ${live.accepted_quotes}/${portfolio.positions?.length??0}銘柄照合`:`日次確定 ${date(last?.date)}`;
  const risk=combinedRiskHero(history,portfolio.seed_cost_basis,live?.current_equity??last?.equity??null);
  const loss=risk.max_unrealized_loss;
  const riskLabel=risk.includes_live?'場中含む':'日次確定';
  const lossText=loss.amount===null?'最大含み損: 履歴なし':`最大含み損 ${yen(loss.amount)} (${pct(loss.pct)}) · ${date(loss.date)}`;
  host.innerHTML=`<article class="pcock-focus-card profit"><span>累積利益率</span><strong>${pct(profitReturn)}</strong><small>${yen(profitPnl)} · ${esc(source)}</small></article><article class="pcock-focus-card risk"><span>最大DD / 最大含み損</span><strong>${pct(risk.worse_drawdown_pct)}</strong><small>${esc(lossText)} · ${riskLabel}</small></article>`;
}

async function refreshLive(){
  if(!portfolio)return;
  try{
    const quotes=window.ValueScopeData?.refreshQuotes?await window.ValueScopeData.refreshQuotes(true):await (await fetch('/api/quotes?compact=1&force=1')).json();
    live=liveLedgerMark(portfolio,quotes,new Date());
    renderHero();
  }catch{renderHero()}
}

async function start(){
  const ready=installUi();
  if(!ready){const observer=new MutationObserver(()=>{if(installUi()){observer.disconnect();startData()}});observer.observe(document.documentElement,{childList:true,subtree:true});return}
  await startData();
}

async function startData(){
  const [p,h]=await Promise.all([getJson('./data/paper-trading/portfolio.json',{}),getJson('./data/paper-trading/equity-history.json',{history:[]})]);
  portfolio=p;history=h.history??[];series=correctedEquitySeries(history,p.seed_cost_basis);renderHero();
  const saved=localStorage.getItem(ZOOM_KEY);
  if(saved&&saved!=='all'){
    const button=document.querySelector(`[data-pcock-period="${saved}"]`);
    if(button&&button.getAttribute('aria-pressed')!=='true')requestAnimationFrame(()=>button.click());
  }
  refreshLive();
}

if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',start,{once:true});else start();
