import {
  actionLabel,
  filterChartBars,
  financialSeries,
  finiteNumber,
  normalizeStockCode,
  recommendationExplanation,
  splitRecommendationReasons,
  stockChartGeometry,
  stockChartSummary,
} from './stock-detail-core.js';

const $ = selector => document.querySelector(selector);
const escapeHtml = value => String(value ?? '').replace(/[&<>'"]/g, character => ({ '&':'&amp;','<':'&lt;','>':'&gt;',"'":'&#39;','"':'&quot;' })[character]);
const yen = value => finiteNumber(value) === null ? 'データなし' : new Intl.NumberFormat('ja-JP',{style:'currency',currency:'JPY',maximumFractionDigits:0}).format(Number(value));
const number = (value,digits=1) => finiteNumber(value) === null ? 'データなし' : Number(value).toLocaleString('ja-JP',{maximumFractionDigits:digits});
const percent = (value,digits=2) => finiteNumber(value) === null ? 'データなし' : `${Number(value)>=0?'+':''}${Number(value).toFixed(digits)}%`;
const dateText = value => { if(!value)return'データなし'; const parsed=new Date(value); return Number.isNaN(parsed.getTime())?String(value):new Intl.DateTimeFormat('ja-JP',{year:'numeric',month:'2-digit',day:'2-digit',hour:String(value).includes('T')?'2-digit':undefined,minute:String(value).includes('T')?'2-digit':undefined,timeZone:'Asia/Tokyo'}).format(parsed); };
const cache = new Map();
let activeCode = null;
let activeTab = 'overview';
let activePayload = null;
let previousFocus = null;
let chartPeriod = '6m';
let chartOptions = { sma20:true, sma60:true, volume:true };
let rowObserver = null;

function ensureSheet() {
  if ($('#stockDetailSheet')) return;
  const backdrop = document.createElement('div');
  backdrop.id = 'stockDetailBackdrop';
  backdrop.className = 'stock-detail-backdrop';
  backdrop.hidden = true;
  backdrop.innerHTML = `<section id="stockDetailSheet" class="stock-detail-sheet" role="dialog" aria-modal="true" aria-labelledby="stockDetailTitle" hidden><header class="stock-detail-header"><button id="stockDetailBack" type="button" class="stock-detail-back">戻る</button><div><small id="stockDetailCode">STOCK RESEARCH</small><h2 id="stockDetailTitle">銘柄詳細</h2></div><button id="stockDetailClose" type="button" class="stock-detail-close" aria-label="銘柄詳細を閉じる">×</button></header><nav id="stockDetailTabs" class="stock-detail-tabs" role="tablist" aria-label="銘柄詳細の分類">${[['overview','概要'],['reasons','推奨理由'],['financials','決算'],['news','開示・ニュース'],['chart','チャート']].map(([key,label],index)=>`<button type="button" role="tab" data-stock-tab="${key}" aria-selected="${index===0}">${label}</button>`).join('')}</nav><div id="stockDetailStatus" class="stock-detail-status" aria-live="polite"></div><div id="stockDetailBody" class="stock-detail-body"></div></section>`;
  document.body.append(backdrop);
  $('#stockDetailClose').addEventListener('click', closeStockDetail);
  $('#stockDetailBack').addEventListener('click', closeStockDetail);
  backdrop.addEventListener('click', event => { if(event.target===backdrop)closeStockDetail(); });
  $('#stockDetailTabs').addEventListener('click', event => { const button=event.target.closest('[data-stock-tab]'); if(button){activeTab=button.dataset.stockTab;renderActiveTab();} });
  $('#stockDetailSheet').addEventListener('keydown', trapFocus);
}

function trapFocus(event) {
  if(event.key==='Escape'){event.preventDefault();closeStockDetail();return;}
  if(event.key!=='Tab')return;
  const focusable=[...$('#stockDetailSheet').querySelectorAll('button:not([disabled]),a[href],input:not([disabled]),select:not([disabled]),[tabindex="0"]')].filter(node=>!node.hidden&&node.offsetParent!==null);
  if(!focusable.length)return;
  const first=focusable[0],last=focusable.at(-1);
  if(event.shiftKey&&document.activeElement===first){event.preventDefault();last.focus();}
  else if(!event.shiftKey&&document.activeElement===last){event.preventDefault();first.focus();}
}

function localDataPath(code){return`./data/stock-details/${code}.json`;}
async function json(path,fallback={}){try{const response=await fetch(path);return response.ok?await response.json():fallback;}catch{return fallback;}}

async function loadLocal(code) {
  const data=window.ValueScopeData;
  const [ranking,report,index,detail]=await Promise.all([
    data?.getRanking?.()??json('./jquants-ranking.json',{rows:[]}),
    data?.getDailyReport?.()??json('./data/paper-trading/latest-report.json',{decisions:[]}),
    json('./data/stock-details/index.json',{securities:[]}),
    json(localDataPath(code),{}),
  ]);
  const normalize=value=>normalizeStockCode(value);
  const rankingRow=(ranking.rows??[]).find(row=>normalize(row.code)===code)??null;
  const decision=(report.decisions??[]).find(item=>normalize(item.code??item.symbol)===code)??null;
  const security=(index.securities??[]).find(item=>normalize(item.code)===code)??{};
  return { code,company_name:security.company_name??rankingRow?.company_name??decision?.company_name??code,security:{...security,market:rankingRow?.market??security.market,sector:rankingRow?.sector??security.sector},ranking:rankingRow,decision,data_cutoff:report.fundamental_source?.effective_data_cutoff??ranking.metadata?.effective_data_cutoff??null,plan:report.fundamental_source?.plan??ranking.metadata?.plan??'free',financial_history_status:detail.financial_history_status??'unavailable_until_jquants_refresh',financial_capabilities:detail.financial_capabilities??{summary:true,full_statements:false},financial_summaries:detail.financial_summaries??[],next_earnings_date:detail.next_earnings_date??null,official_disclosures:detail.official_disclosures??[],official_disclosure_status:detail.official_disclosure_status??'tdnet_addon_not_configured',chart:[],news:[],source_status:{local:{ok:true},chart:{ok:false,status:'loading'},news:{ok:false,status:'loading'}},paper_only:true };
}

async function loadRemote(code) {
  const cached=cache.get(code);
  if(cached&&cached.expiresAt>Date.now())return cached.payload;
  const storageKey=`valuescope-stock-detail:${code}`;
  try{
    const response=await fetch(`/api/stock-detail?code=${encodeURIComponent(code)}`);
    if(!response.ok)throw new Error(`HTTP ${response.status}`);
    const payload=await response.json();
    cache.set(code,{payload,expiresAt:Date.now()+300000});
    try{sessionStorage.setItem(storageKey,JSON.stringify(payload));}catch{}
    return payload;
  }catch(error){
    try{const fallback=JSON.parse(sessionStorage.getItem(storageKey)??'null');if(fallback)return{...fallback,_stale:true,_load_error:String(error.message??error)};}catch{}
    throw error;
  }
}

function mergePayload(local,remote){return{...local,...remote,security:{...(local.security??{}),...(remote.security??{})},ranking:remote.ranking??local.ranking,decision:remote.decision??local.decision,financial_summaries:remote.financial_summaries?.length?remote.financial_summaries:local.financial_summaries,official_disclosures:remote.official_disclosures?.length?remote.official_disclosures:local.official_disclosures,source_status:{...(local.source_status??{}),...(remote.source_status??{})}};}

function decisionInfo(payload){const decision=payload?.decision??{};const action=decision.decision?.action??decision.action??'WATCH';return{action,label:actionLabel(action),confidence:finiteNumber(decision.decision?.confidence??decision.confidence),holding:decision.holding??{},technical:decision.technical??{},fundamental:decision.fundamental??{},quote:decision.quote??{}};}
function list(items,empty='該当する理由はありません。'){return items?.length?`<ul>${items.map(item=>`<li>${escapeHtml(item)}</li>`).join('')}</ul>`:`<p class="stock-detail-empty">${escapeHtml(empty)}</p>`;}

function renderOverview(payload) {
  const info=decisionInfo(payload);const rank=payload.ranking??{};const holding=info.holding??{};const entry=finiteNumber(holding.avg_cost??holding.entry_price);const quantity=finiteNumber(holding.quantity)??0;const current=finiteNumber(info.technical.price??info.quote.current_price??rank.last_price);const pnl=entry!==null&&current!==null?(current-entry)*quantity:null;
  return `<section class="stock-overview"><div class="stock-overview-hero"><div><span class="stock-action action-${escapeHtml(info.action.toLowerCase())}">${escapeHtml(info.label)}</span><h3>${escapeHtml(payload.company_name)}</h3><p>${escapeHtml(payload.code)} · ${escapeHtml(payload.security?.market??rank.market??'市場不明')} · ${escapeHtml(payload.security?.sector??rank.sector??'業種不明')}</p></div><div><span>確信度</span><strong>${info.confidence===null?'データなし':`${info.confidence.toFixed(1)}%`}</strong></div></div><div class="stock-overview-grid"><article><span>現在値</span><strong>${yen(current)}</strong><small>${dateText(info.quote.quote_time)} · ${escapeHtml(info.quote.verification??'保存値')}</small></article><article><span>保有</span><strong>${quantity.toLocaleString('ja-JP')}株</strong><small>取得 ${yen(entry)}</small></article><article><span>含み損益</span><strong class="${pnl!==null&&pnl<0?'negative':'positive'}">${pnl===null?'データなし':`${pnl>=0?'+':''}${yen(pnl)}`}</strong><small>${entry&&current?percent((current/entry-1)*100):'データなし'}</small></article><article><span>データcutoff</span><strong>${dateText(payload.data_cutoff)}</strong><small>J-Quants ${escapeHtml(typeof payload.plan==='object'?payload.plan.name??'free':payload.plan??'free')}</small></article></div><div class="stock-explanation"><strong>なぜこの判断か</strong><p>${escapeHtml(recommendationExplanation(payload))}</p></div><div class="stock-paper-note"><strong>デモ分析のみ</strong><p>この画面は投資判断の材料を整理するもので、実注文を送信しません。</p></div></section>`;
}

function renderReasons(payload){const groups=splitRecommendationReasons(payload);return`<section class="stock-reason-columns"><article class="stock-reason-card fundamental"><header><span>Fundamental</span><h3>企業価値・財務の理由</h3></header><div><h4>支持材料</h4>${list(groups.fundamental.positive)}</div><div><h4>リスク</h4>${list(groups.fundamental.risks,'明示的なFundamentalリスクは記録されていません。')}</div></article><article class="stock-reason-card technical"><header><span>Technical</span><h3>売買タイミングの理由</h3></header><div><h4>支持材料</h4>${list(groups.technical.positive)}</div><div><h4>リスク</h4>${list(groups.technical.risks,'明示的なTechnicalリスクは記録されていません。')}</div></article></section>`;}

function financialValue(label,value,type='number'){const display=type==='money'?yen(value):type==='percent'?percent(value):number(value);return`<div><dt>${escapeHtml(label)}</dt><dd>${display}</dd></div>`;}
function renderFinancials(payload){const rows=financialSeries(payload.financial_summaries??[]);const latest=rows[0];const capability=payload.financial_capabilities??{};const capabilityText=capability.full_statements?'BS/PL/CF詳細データを利用可能です。':'決算サマリーを表示します。BS/PL/CF詳細は現在の契約・出力では利用できません。';if(!rows.length)return`<section class="stock-financials"><div class="stock-capability"><strong>決算データ更新待ち</strong><p>${escapeHtml(capabilityText)}</p><small>状態: ${escapeHtml(payload.financial_history_status??'unavailable')}</small></div><div class="stock-empty-large"><h3>財務履歴は次回J-Quants更新後に表示されます</h3><p>ランキング上のFundamental指標と推奨理由は「推奨理由」タブで確認できます。</p></div></section>`;return`<section class="stock-financials"><div class="stock-capability"><strong>${escapeHtml(capabilityText)}</strong><small>次回決算予定: ${dateText(payload.next_earnings_date)}</small></div><div class="stock-financial-summary">${financialValue('売上高',latest.net_sales,'money')}${financialValue('営業利益',latest.operating_profit,'money')}${financialValue('営業利益率',latest.operating_margin_pct,'percent')}${financialValue('当期利益',latest.profit,'money')}${financialValue('EPS',latest.eps)}${financialValue('自己資本比率',latest.equity_ratio_pct,'percent')}</div><div class="stock-financial-periods">${rows.map(row=>`<details><summary><span>${dateText(row.disclosed_date)}</span><strong>${escapeHtml(row.document_type??row.period_end??'決算サマリー')}</strong></summary><dl>${financialValue('期間末',row.period_end)}${financialValue('売上高',row.net_sales,'money')}${financialValue('売上高YoY',row.yoy.net_sales,'percent')}${financialValue('営業利益',row.operating_profit,'money')}${financialValue('営業利益YoY',row.yoy.operating_profit,'percent')}${financialValue('経常利益',row.ordinary_profit,'money')}${financialValue('当期利益',row.profit,'money')}${financialValue('EPS',row.eps)}${financialValue('総資産',row.total_assets,'money')}${financialValue('自己資本',row.equity,'money')}${financialValue('営業CF',row.operating_cash_flow,'money')}${financialValue('投資CF',row.investing_cash_flow,'money')}${financialValue('財務CF',row.financing_cash_flow,'money')}</dl></details>`).join('')}</div></section>`;}

function renderNews(payload){const disclosures=payload.official_disclosures??[];const news=payload.news??[];return`<section class="stock-news"><article><header><span>公式</span><h3>適時開示・決算短信</h3></header>${disclosures.length?`<div class="stock-news-list">${disclosures.map(item=>`<a href="${escapeHtml(item.url??'#')}" target="_blank" rel="noreferrer"><time>${dateText(item.published_at??item.date)}</time><strong>${escapeHtml(item.title)}</strong></a>`).join('')}</div>`:`<div class="stock-source-unavailable"><strong>TDnet/Company Disclosure add-on未接続</strong><p>公式開示は取得できた場合だけ表示します。架空の決算短信は生成しません。</p><a href="https://www.release.tdnet.info/inbs/I_main_00.html" target="_blank" rel="noreferrer">TDnet公式検索を開く</a></div>`}</article><article><header><span>一般ニュース</span><h3>一般ニュース（公式開示ではありません）</h3></header>${news.length?`<div class="stock-news-list">${news.map(item=>`<a href="${escapeHtml(item.link)}" target="_blank" rel="noreferrer"><time>${dateText(item.published_at)}</time><strong>${escapeHtml(item.title)}</strong><small>${escapeHtml(item.source)}</small></a>`).join('')}</div>`:`<div class="stock-source-unavailable"><strong>ニュース取得なし</strong><p>${escapeHtml(payload.source_status?.news?.error??'現在取得できる一般ニュースがありません。')}</p></div>`}</article></section>`;}

function polyline(points){return points.map(point=>`${point.x.toFixed(2)},${point.y.toFixed(2)}`).join(' ');}
function renderChart(payload){const bars=filterChartBars(payload.chart??[],chartPeriod);if(!bars.length)return`<section class="stock-chart"><div class="stock-chart-controls">${chartControls()}</div><div class="stock-empty-large"><h3>チャートデータを取得できません</h3><p>${escapeHtml(payload.source_status?.chart?.error??'日足データがありません。')}</p></div></section>`;const geometry=stockChartGeometry(bars,900,360);const summary=stockChartSummary(bars);return`<section class="stock-chart"><div class="stock-chart-controls">${chartControls()}</div><div class="stock-chart-wrap"><svg id="stockCandlestickChart" viewBox="0 0 900 360" role="img" aria-labelledby="stockChartText"><line x1="${geometry.plot.left}" y1="${geometry.plot.priceBottom}" x2="882" y2="${geometry.plot.priceBottom}" class="chart-axis"/><line x1="${geometry.plot.left}" y1="${geometry.plot.top}" x2="${geometry.plot.left}" y2="${geometry.plot.priceBottom}" class="chart-axis"/>${chartOptions.volume?geometry.volumes.map((bar,index)=>`<rect x="${bar.x-bar.width/2}" y="${bar.y}" width="${bar.width}" height="${Math.max(1,bar.height)}" class="chart-volume ${bar.rising?'up':'down'}"/>`).join(''):''}${geometry.candles.map((candle,index)=>{const row=geometry.bars[index];const top=Math.min(candle.openY,candle.closeY),height=Math.max(1.5,Math.abs(candle.openY-candle.closeY));return`<g class="chart-candle ${candle.rising?'up':'down'}" tabindex="0" data-chart-index="${index}"><line x1="${candle.x}" y1="${candle.highY}" x2="${candle.x}" y2="${candle.lowY}"/><rect x="${candle.x-candle.width/2}" y="${top}" width="${candle.width}" height="${height}"/><title>${row.date} 始値${row.open} 高値${row.high} 安値${row.low} 終値${row.close}</title></g>`;}).join('')}${chartOptions.sma20?`<polyline points="${polyline(geometry.sma20)}" class="chart-sma sma20"/>`:''}${chartOptions.sma60?`<polyline points="${polyline(geometry.sma60)}" class="chart-sma sma60"/>`:''}<line id="stockChartCrosshair" x1="0" y1="${geometry.plot.top}" x2="0" y2="${geometry.plot.bottom}" class="chart-crosshair" hidden/><text x="${geometry.plot.left}" y="350" class="chart-label">${escapeHtml(geometry.bars[0].date)}</text><text x="882" y="350" text-anchor="end" class="chart-label">${escapeHtml(geometry.bars.at(-1).date)}</text></svg><div id="stockChartTooltip" class="stock-chart-tooltip" hidden></div></div><p id="stockChartText" class="stock-chart-summary">${escapeHtml(summary.text)}</p></section>`;}
function chartControls(){return`<div class="stock-periods" role="group" aria-label="チャート期間">${Object.entries({'1m':'1M','3m':'3M','6m':'6M','1y':'1Y'}).map(([key,label])=>`<button type="button" data-stock-period="${key}" class="${chartPeriod===key?'active':''}">${label}</button>`).join('')}</div><div class="stock-indicators" role="group" aria-label="チャート指標"><label><input type="checkbox" data-stock-indicator="sma20" ${chartOptions.sma20?'checked':''}>SMA20</label><label><input type="checkbox" data-stock-indicator="sma60" ${chartOptions.sma60?'checked':''}>SMA60</label><label><input type="checkbox" data-stock-indicator="volume" ${chartOptions.volume?'checked':''}>出来高</label></div>`;}

function renderActiveTab(){if(!activePayload)return;document.querySelectorAll('#stockDetailTabs [data-stock-tab]').forEach(button=>button.setAttribute('aria-selected',String(button.dataset.stockTab===activeTab)));const renderers={overview:renderOverview,reasons:renderReasons,financials:renderFinancials,news:renderNews,chart:renderChart};$('#stockDetailBody').innerHTML=(renderers[activeTab]??renderOverview)(activePayload);bindRenderedControls();}
function bindRenderedControls(){document.querySelectorAll('[data-stock-period]').forEach(button=>button.addEventListener('click',()=>{chartPeriod=button.dataset.stockPeriod;renderActiveTab();}));document.querySelectorAll('[data-stock-indicator]').forEach(input=>input.addEventListener('change',()=>{chartOptions={...chartOptions,[input.dataset.stockIndicator]:input.checked};renderActiveTab();}));const svg=$('#stockCandlestickChart'),tooltip=$('#stockChartTooltip'),crosshair=$('#stockChartCrosshair');if(svg&&tooltip&&crosshair){svg.querySelectorAll('[data-chart-index]').forEach(node=>{const show=()=>{const index=Number(node.dataset.chartIndex),bar=filterChartBars(activePayload.chart??[],chartPeriod)[index];if(!bar)return;const candle=stockChartGeometry(filterChartBars(activePayload.chart??[],chartPeriod),900,360).candles[index];crosshair.setAttribute('x1',candle.x);crosshair.setAttribute('x2',candle.x);crosshair.hidden=false;tooltip.hidden=false;tooltip.textContent=`${bar.date} O ${number(bar.open)} H ${number(bar.high)} L ${number(bar.low)} C ${number(bar.close)} SMA20 ${number(bar.sma20)} SMA60 ${number(bar.sma60)}`;};const hide=()=>{crosshair.hidden=true;tooltip.hidden=true;};node.addEventListener('pointerenter',show);node.addEventListener('focus',show);node.addEventListener('pointerleave',hide);node.addEventListener('blur',hide);});}}

async function openStockDetail(value){const code=normalizeStockCode(value);if(!code)return;ensureSheet();activeCode=code;activeTab='overview';chartPeriod='6m';previousFocus=document.activeElement;const sheet=$('#stockDetailSheet'),backdrop=$('#stockDetailBackdrop');backdrop.hidden=false;sheet.hidden=false;document.body.dataset.stockDetailOpen='true';$('#stockDetailCode').textContent=code;$('#stockDetailTitle').textContent='銘柄詳細を読み込み中';$('#stockDetailStatus').textContent='保存済み分析を表示しています。チャートとニュースを更新中です。';const local=await loadLocal(code);if(activeCode!==code)return;activePayload=local;$('#stockDetailTitle').textContent=local.company_name;renderActiveTab();$('#stockDetailClose').focus();try{const remote=await loadRemote(code);if(activeCode!==code)return;activePayload=mergePayload(local,remote);$('#stockDetailTitle').textContent=activePayload.company_name;$('#stockDetailStatus').textContent=remote._stale?'通信に失敗したため前回取得値を表示しています。':'決算・ニュース・チャートを更新しました。';renderActiveTab();}catch(error){if(activeCode!==code)return;$('#stockDetailStatus').textContent=`外部データを取得できません。保存済み分析を表示します。${error.message??error}`;}}
function closeStockDetail(){const sheet=$('#stockDetailSheet'),backdrop=$('#stockDetailBackdrop');if(!sheet)return;sheet.hidden=true;backdrop.hidden=true;delete document.body.dataset.stockDetailOpen;activeCode=null;previousFocus?.focus?.();}

function decorateRanking(){document.querySelectorAll('#rankingBody tr[data-code]').forEach(row=>{row.setAttribute('aria-label',`${row.querySelector('td:nth-child(2) strong')?.textContent??row.dataset.code}。ダブルクリックまたは詳細ボタンで銘柄詳細を開く`);if(row.querySelector('.stock-detail-trigger'))return;const cell=row.children[1]??row.children[0];const button=document.createElement('button');button.type='button';button.className='stock-detail-trigger';button.textContent=matchMedia('(max-width:767px)').matches?'銘柄詳細':'詳細';button.dataset.stockCode=row.dataset.code;cell?.append(button);});}
function interceptRows(event){const button=event.target.closest('.stock-detail-trigger');const row=event.target.closest('#rankingBody tr[data-code]');if(!row)return;if(event.type==='click'){event.stopImmediatePropagation();if(button){event.preventDefault();openStockDetail(button.dataset.stockCode??row.dataset.code);}else row.classList.toggle('stock-row-selected');}if(event.type==='dblclick'){event.preventDefault();event.stopImmediatePropagation();openStockDetail(row.dataset.code);}if(event.type==='keydown'&&(event.key==='Enter'||event.key===' ')){event.preventDefault();event.stopImmediatePropagation();openStockDetail(row.dataset.code);}}
function init(){ensureSheet();decorateRanking();rowObserver=new MutationObserver(decorateRanking);const body=$('#rankingBody');if(body)rowObserver.observe(body,{childList:true,subtree:true});else rowObserver.observe(document.documentElement,{childList:true,subtree:true});document.addEventListener('click',interceptRows,true);document.addEventListener('dblclick',interceptRows,true);document.addEventListener('keydown',interceptRows,true);window.addEventListener('resize',decorateRanking);}
if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',init,{once:true});else init();
window.ValueScopeStockDetail=Object.freeze({open:openStockDetail,close:closeStockDetail});
