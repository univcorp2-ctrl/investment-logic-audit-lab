export const FUNDAMENTAL_METRICS = Object.freeze({
  earnings_yield:{label:'利益利回り',direction:'high',unit:'%',scale:100,defaultWeight:15,defaultEnabled:true},
  book_to_market:{label:'Book-to-Market',direction:'high',unit:'x',scale:1,defaultWeight:10,defaultEnabled:true},
  fcf_yield:{label:'FCF利回り',direction:'high',unit:'%',scale:100,defaultWeight:18,defaultEnabled:true},
  roe:{label:'ROE',direction:'high',unit:'%',scale:100,defaultWeight:14,defaultEnabled:true},
  operating_margin:{label:'営業利益率',direction:'high',unit:'%',scale:100,defaultWeight:10,defaultEnabled:true},
  revenue_growth:{label:'売上成長率',direction:'high',unit:'%',scale:100,defaultWeight:8,defaultEnabled:false},
  eps_growth:{label:'EPS成長率',direction:'high',unit:'%',scale:100,defaultWeight:8,defaultEnabled:false},
  fcf_growth:{label:'FCF成長率',direction:'high',unit:'%',scale:100,defaultWeight:8,defaultEnabled:false},
  operating_margin_change:{label:'営業利益率変化',direction:'high',unit:'pt',scale:100,defaultWeight:6,defaultEnabled:false},
  fcf_conversion:{label:'FCF変換率',direction:'high',unit:'x',scale:1,defaultWeight:8,defaultEnabled:false},
  accrual_quality:{label:'アクルーアル品質',direction:'high',unit:'x',scale:1,defaultWeight:7,defaultEnabled:false},
  earnings_stability:{label:'利益安定性',direction:'high',unit:'score',scale:100,defaultWeight:8,defaultEnabled:false},
  fcf_stability:{label:'FCF安定性',direction:'high',unit:'score',scale:100,defaultWeight:8,defaultEnabled:false},
  negative_earnings_years:{label:'赤字年数',direction:'low',unit:'years',scale:1,defaultWeight:9,defaultEnabled:false},
  negative_fcf_years:{label:'負のFCF年数',direction:'low',unit:'years',scale:1,defaultWeight:9,defaultEnabled:false},
  data_completeness:{label:'データ充足率',direction:'high',unit:'%',scale:1,defaultWeight:15,defaultEnabled:true},
  value_trap_risk:{label:'Value Trap Risk',direction:'low',unit:'score',scale:1,defaultWeight:18,defaultEnabled:true},
});

const baseMetricConfig = () => Object.fromEntries(Object.entries(FUNDAMENTAL_METRICS).map(([key,definition]) => [key,{enabled:definition.defaultEnabled,weight:definition.defaultWeight,threshold:null,missingPolicy:'inherit'}]));

export const DEFAULT_FUNDAMENTAL_MODEL = Object.freeze({
  preset:'balancedFundamental',
  minimumScore:0,
  globalMissingPolicy:'allow',
  topN:10,
  metrics:baseMetricConfig(),
});

export const FUNDAMENTAL_PRESETS = Object.freeze({
  balancedFundamental:{label:'バランス',metrics:{earnings_yield:12,book_to_market:10,fcf_yield:16,roe:14,operating_margin:10,data_completeness:15,value_trap_risk:18}},
  cashFlow:{label:'キャッシュフロー重視',metrics:{earnings_yield:8,fcf_yield:28,fcf_conversion:20,fcf_growth:12,fcf_stability:12,data_completeness:10,value_trap_risk:18}},
  highRoe:{label:'高ROE品質',metrics:{roe:30,operating_margin:20,earnings_stability:15,accrual_quality:10,data_completeness:12,value_trap_risk:15}},
  stability:{label:'財務安定',metrics:{earnings_stability:20,fcf_stability:20,negative_earnings_years:15,negative_fcf_years:15,data_completeness:15,value_trap_risk:20}},
  trapAvoid:{label:'バリュートラップ回避',metrics:{value_trap_risk:35,negative_earnings_years:18,negative_fcf_years:18,fcf_yield:12,quality_score:0,data_completeness:17}},
});

export const finiteFundamental = value => {
  if(value===null||value===undefined||value==='')return null;
  const parsed=Number(value);
  return Number.isFinite(parsed)?parsed:null;
};

const normalizeCode = value => {
  const raw=String(value??'').replace(/\.T$/i,'');
  return raw.length===5&&raw.endsWith('0')?raw.slice(0,-1):raw;
};

export function mergeFundamentalRows(rankingPayload,reportPayload){
  const decisions=new Map((reportPayload?.decisions??[]).map(item=>[normalizeCode(item.code??item.symbol),item]));
  return (rankingPayload?.rows??[]).map(row=>{
    const code=normalizeCode(row.code??row.symbol),decision=decisions.get(code)??{},fundamental=decision.fundamental??{};
    const merged={...row,...fundamental,code,company_name:row.company_name??decision.company_name??code,action:decision.decision?.action??'WATCH',holding_quantity:finiteFundamental(decision.holding?.quantity)??0};
    for(const key of Object.keys(FUNDAMENTAL_METRICS))merged[key]=finiteFundamental(fundamental[key]??row[key]);
    return merged;
  });
}

function percentileMap(rows,key,direction){
  const values=rows.map(row=>finiteFundamental(row[key])).filter(value=>value!==null).sort((a,b)=>a-b),map=new Map();
  if(!values.length)return map;
  const unique=[...new Set(values)];
  for(const value of unique){const positions=values.map((item,index)=>item===value?index:null).filter(index=>index!==null),average=positions.reduce((sum,index)=>sum+index,0)/positions.length,percentile=values.length===1?50:average/(values.length-1)*100;map.set(value,direction==='low'?100-percentile:percentile)}
  return map;
}

export function applyFundamentalPreset(name,current=DEFAULT_FUNDAMENTAL_MODEL){
  const preset=FUNDAMENTAL_PRESETS[name]??FUNDAMENTAL_PRESETS.balancedFundamental,metrics=baseMetricConfig();
  for(const [key,weight] of Object.entries(preset.metrics)){if(!metrics[key])continue;metrics[key]={...metrics[key],enabled:Number(weight)>0,weight:Number(weight)}}
  return{...structuredClone(DEFAULT_FUNDAMENTAL_MODEL),minimumScore:current.minimumScore??0,globalMissingPolicy:current.globalMissingPolicy??'allow',topN:current.topN??10,preset:name,metrics};
}

export function evaluateFundamentalModel(rows,config=DEFAULT_FUNDAMENTAL_MODEL){
  const enabled=Object.entries(config.metrics??{}).filter(([key,item])=>FUNDAMENTAL_METRICS[key]&&item.enabled&&Number(item.weight)>0),percentiles=Object.fromEntries(enabled.map(([key])=>[key,percentileMap(rows,key,FUNDAMENTAL_METRICS[key].direction)]));
  const evaluated=rows.map(row=>{
    const parts=[],reasons=[],missing=[];
    for(const [key,item] of enabled){const definition=FUNDAMENTAL_METRICS[key],raw=finiteFundamental(row[key]),policy=item.missingPolicy==='inherit'||!item.missingPolicy?config.globalMissingPolicy:item.missingPolicy,weight=Math.max(0,Number(item.weight)||0),threshold=finiteFundamental(item.threshold);let normalized=null,status='ok';if(raw===null){missing.push(key);if(policy==='exclude'){reasons.push(`${definition.label}が欠損`);status='excluded'}else if(policy==='neutral'){normalized=50;status='neutral'}else status='ignored'}else{normalized=percentiles[key].get(raw)??50;const display=raw*definition.scale;if(threshold!==null){const passed=definition.direction==='high'?display>=threshold:display<=threshold;if(!passed)reasons.push(`${definition.label} ${display.toFixed(2)} が閾値${threshold.toFixed(2)}を未達`)}}parts.push({key,label:definition.label,direction:definition.direction,unit:definition.unit,scale:definition.scale,raw,display:raw===null?null:raw*definition.scale,normalized,weight,status})}
    const usable=parts.filter(part=>part.normalized!==null&&part.weight>0),denominator=usable.reduce((sum,part)=>sum+part.weight,0);let score=null;if(denominator>0){score=usable.reduce((sum,part)=>sum+part.normalized*part.weight,0)/denominator;for(const part of parts)part.contribution_points=part.normalized===null?null:part.normalized*part.weight/denominator}else reasons.push('有効なファンダメンタル指標がありません');if(score!==null&&score<Number(config.minimumScore||0))reasons.push(`詳細Fundamental ${score.toFixed(1)} < ${Number(config.minimumScore).toFixed(1)}`);return{...row,custom_fundamental_score:score,fundamental_contributions:parts,fundamental_missing:missing,fundamental_included:reasons.length===0,fundamental_exclusion_reasons:reasons}});
  const included=evaluated.filter(row=>row.fundamental_included).sort((a,b)=>(b.custom_fundamental_score??-1)-(a.custom_fundamental_score??-1)||String(a.code).localeCompare(String(b.code),'ja',{numeric:true}));
  return{included:included.slice(0,Math.max(1,Number(config.topN)||10)),excluded:evaluated.filter(row=>!row.fundamental_included),evaluated,enabledMetrics:enabled.map(([key])=>key)};
}

export function fundamentalFormula(config){const entries=Object.entries(config.metrics??{}).filter(([key,item])=>FUNDAMENTAL_METRICS[key]&&item.enabled&&Number(item.weight)>0);if(!entries.length)return'有効な指標がありません';return entries.map(([key,item])=>`${FUNDAMENTAL_METRICS[key].label}×${Number(item.weight)}`).join(' + ')+' を有効ウェイト合計で正規化';}

export function fundamentalRowsToCsv(rows){const metricKeys=Object.keys(FUNDAMENTAL_METRICS),columns=['code','company_name','custom_fundamental_score','fundamental_included','action','holding_quantity',...metricKeys,...metricKeys.map(key=>`${key}_contribution`)];const escape=value=>{const text=String(value??'');return/[",\n]/.test(text)?`"${text.replaceAll('"','""')}"`:text};return[columns.join(','),...rows.map(row=>{const contributions=Object.fromEntries((row.fundamental_contributions??[]).map(item=>[item.key,item.contribution_points]));return columns.map(column=>column.endsWith('_contribution')?escape(contributions[column.replace('_contribution','')]):escape(row[column])).join(',')})].join('\n')}

export function encodeFundamentalConfig(config){return btoa(unescape(encodeURIComponent(JSON.stringify(config)))).replaceAll('+','-').replaceAll('/','_').replaceAll('=','')}
export function decodeFundamentalConfig(value){try{const normalized=value.replaceAll('-','+').replaceAll('_','/');return JSON.parse(decodeURIComponent(escape(atob(normalized))))}catch{return null}}
