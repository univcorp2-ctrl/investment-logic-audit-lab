export const DEFAULT_ANALYSIS_SETTINGS = Object.freeze({
  riskFreeRateAnnualPct: 0,
  targetReturnAnnualPct: 0,
  annualizationDays: 252,
  varConfidence: 0.95,
  scenarioTargetPct: 16,
  scenarioStopPct: -8,
});

export const RANGE_DAYS = Object.freeze({
  '1W': 7,
  '1M': 31,
  '3M': 93,
  '6M': 186,
  '1Y': 366,
  ALL: Infinity,
});

export const CHART_MODES = Object.freeze({
  equity: { label:'資産額', field:'equity', unit:'JPY' },
  cumulative_pnl: { label:'累積損益', field:'cumulative_pnl', unit:'JPY' },
  daily_pnl: { label:'日次損益', field:'daily_pnl', unit:'JPY' },
  drawdown: { label:'ドローダウン', field:'drawdown_pct', unit:'%' },
  benchmark: { label:'ベンチマーク比較', field:'cumulative_return_pct', secondary:'benchmark_cumulative_return_pct', unit:'%' },
});

export const METRIC_DEFINITIONS = Object.freeze({
  total_return_pct: '投下元本に対する現在までの累積収益率。',
  cagr_pct: '複利ベースの年率成長率。短い履歴では算出しません。',
  annualized_volatility_pct: '日次収益率の標準偏差を年率換算した総変動。',
  downside_deviation_pct: '目標収益を下回った日だけを使う下方変動。',
  max_drawdown_pct: '過去の最高評価額から最も深く下落した割合。',
  current_drawdown_pct: '現在の評価額が直近ピークから何％下にあるか。',
  max_drawdown_duration_days: 'ピークを回復できなかった最長観測日数。',
  max_recovery_duration_days: 'ドローダウンの谷から元のピークへ戻るまでの最長日数。',
  ulcer_index: 'ドローダウンの深さと継続を二乗平均で表す下方リスク。',
  historical_var_pct: '指定信頼水準における過去の日次損失分位点。',
  cvar_expected_shortfall_pct: 'VaRを超えた悪い日だけの平均損失。',
  sharpe_ratio: '年率超過収益を総変動で割った値。',
  sortino_ratio: '年率超過収益を下方変動だけで割った値。',
  calmar_ratio: 'CAGRを最大ドローダウンの絶対値で割った値。',
  omega_ratio: '目標を上回る利益総額を下回る損失総額で割った値。',
  information_ratio: 'ベンチマーク超過収益をTracking Errorで割った値。',
  tracking_error_pct: 'ベンチマークとの差分収益率の年率標準偏差。',
  beta: 'ベンチマーク変動に対する感応度。',
  annualized_alpha_pct: 'Betaで説明できない年率超過収益。',
  daily_win_rate_pct: '日次収益率がプラスだった日の割合。',
  payoff_ratio: '平均利益日を平均損失日の絶対値で割った値。',
  profit_factor: '利益日の収益合計を損失日の損失合計で割った値。',
  expectancy_pct: '1観測日あたりの平均収益率。',
  reward_risk_ratio: '平均利益と平均損失の比率。',
  turnover: '売買金額累計を平均評価額で割った値。',
  exposure_pct: '評価額のうち株式ポジションに投下されている割合。',
  cash_ratio_pct: '評価額のうち現金が占める割合。',
  largest_position_weight_pct: '最大保有銘柄の評価額比率。',
  hhi_concentration: '保有比率の二乗和。高いほど集中。',
  effective_positions: 'HHIの逆数で表した実効分散銘柄数。',
});

export const finite = value => {
  if (value === null || value === undefined || value === '') return null;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
};

const mean = values => values.length ? values.reduce((sum,value)=>sum+value,0) / values.length : null;
const standardDeviation = values => {
  if (!values.length) return null;
  const average = mean(values);
  return Math.sqrt(values.reduce((sum,value)=>sum+(value-average)**2,0) / values.length);
};
const quantile = (values, probability) => {
  if (!values.length) return null;
  const sorted=[...values].sort((a,b)=>a-b),index=(sorted.length-1)*probability,lower=Math.floor(index),upper=Math.ceil(index);
  return lower===upper?sorted[lower]:sorted[lower]+(sorted[upper]-sorted[lower])*(index-lower);
};

export function filterSeriesByRange(series, range = 'ALL') {
  const rows = (series ?? []).filter(row => row?.date).sort((a,b)=>String(a.date).localeCompare(String(b.date)));
  if (!rows.length || range === 'ALL' || !Number.isFinite(RANGE_DAYS[range])) return rows;
  const end = new Date(`${rows.at(-1).date}T00:00:00Z`);
  const start = new Date(end.getTime() - RANGE_DAYS[range] * 86_400_000);
  return rows.filter(row => new Date(`${row.date}T00:00:00Z`) >= start);
}

export function seriesReturns(series) {
  const rows=(series??[]).filter(row=>finite(row.equity)!==null);
  const returns=[];
  for(let index=1;index<rows.length;index+=1){const previous=finite(rows[index-1].equity),current=finite(rows[index].equity);if(previous>0&&current!==null)returns.push(current/previous-1)}
  return returns;
}

const metric = (value, status='ok', reason=null, required=0, available=0, unit=null) => ({ value:finite(value),status,reason,required_observations:required,available_observations:available,unit });
const unavailable = (label, required, available, unit=null) => metric(null,'unavailable',`${label}には${required}観測が必要です（現在${available}）。`,required,available,unit);

export function recalculateAnalysis(series, settings = DEFAULT_ANALYSIS_SETTINGS) {
  const returns=seriesReturns(series),count=returns.length,annualization=Math.max(1,Number(settings.annualizationDays)||252),minimum=30,longMinimum=126;
  const riskFreeDaily=(1+Number(settings.riskFreeRateAnnualPct||0)/100)**(1/annualization)-1;
  const targetDaily=(1+Number(settings.targetReturnAnnualPct||0)/100)**(1/annualization)-1;
  const average=mean(returns),std=standardDeviation(returns),excess=returns.map(value=>value-riskFreeDaily),excessMean=mean(excess);
  const downside=returns.map(value=>Math.min(0,value-targetDaily)),downsideRms=downside.length?Math.sqrt(mean(downside.map(value=>value**2))):null;
  const sharpe=count>=minimum&&std>0?excessMean/std*Math.sqrt(annualization):null;
  const sortino=count>=minimum&&downsideRms>0?excessMean/downsideRms*Math.sqrt(annualization):null;
  const gains=returns.map(value=>Math.max(0,value-targetDaily)).reduce((a,b)=>a+b,0),losses=-returns.map(value=>Math.min(0,value-targetDaily)).reduce((a,b)=>a+b,0);
  const omega=count>=minimum&&losses>0?gains/losses:null;
  const confidence=Math.min(.999,Math.max(.5,Number(settings.varConfidence)||.95)),varValue=count>=minimum?quantile(returns,1-confidence):null;
  const tail=varValue===null?[]:returns.filter(value=>value<=varValue),cvar=count>=minimum&&tail.length?mean(tail):null;
  const first=finite(series?.[0]?.equity),last=finite(series?.at(-1)?.equity),years=count/annualization,cagr=count>=longMinimum&&first>0&&last>0?(last/first)**(1/years)-1:null;
  return {
    risk_adjusted:{
      sharpe_ratio: count>=minimum?metric(sharpe,sharpe===null?'unavailable':'ok',sharpe===null?'収益率の変動がありません。':null,minimum,count):unavailable('Sharpe Ratio',minimum,count),
      sortino_ratio: count>=minimum?metric(sortino,sortino===null?'unavailable':'ok',sortino===null?'下方変動がありません。':null,minimum,count):unavailable('Sortino Ratio',minimum,count),
      omega_ratio: count>=minimum?metric(omega,omega===null?'unavailable':'ok',omega===null?'目標を下回る収益がありません。':null,minimum,count):unavailable('Omega Ratio',minimum,count),
    },
    risk:{
      annualized_volatility_pct: count>=minimum?metric(std*Math.sqrt(annualization)*100,'ok',null,minimum,count,'%'):unavailable('年率ボラティリティ',minimum,count,'%'),
      downside_deviation_pct: count>=minimum?metric(downsideRms*Math.sqrt(annualization)*100,'ok',null,minimum,count,'%'):unavailable('下方偏差',minimum,count,'%'),
      historical_var_pct: count>=minimum?metric(varValue*100,'ok',null,minimum,count,'%'):unavailable(`VaR ${Math.round(confidence*100)}%`,minimum,count,'%'),
      cvar_expected_shortfall_pct: count>=minimum?metric(cvar*100,'ok',null,minimum,count,'%'):unavailable(`CVaR ${Math.round(confidence*100)}%`,minimum,count,'%'),
    },
    basic:{
      cagr_pct: count>=longMinimum?metric(cagr*100,'ok',null,longMinimum,count,'%'):unavailable('CAGR',longMinimum,count,'%'),
    },
    scenario:{
      target_pct:Number(settings.scenarioTargetPct)||0,
      stop_pct:Number(settings.scenarioStopPct)||0,
      reward_risk_ratio:Number(settings.scenarioStopPct)<0?Math.abs(Number(settings.scenarioTargetPct)/Number(settings.scenarioStopPct)):null,
    },
  };
}

export function chartRows(series, range, mode) {
  const rows=filterSeriesByRange(series,range),definition=CHART_MODES[mode]??CHART_MODES.equity;
  return rows.map(row=>({date:row.date,primary:finite(row[definition.field]),secondary:definition.secondary?finite(row[definition.secondary]):null,raw:row}));
}

export function analyticsSeriesToCsv(series) {
  const columns=['date','equity','cumulative_pnl','cumulative_return_pct','daily_pnl','daily_return_pct','drawdown_pct','benchmark_cumulative_return_pct'];
  return [columns.join(','),...(series??[]).map(row=>columns.map(column=>row[column]??'').join(','))].join('\n');
}
