export const FUNDAMENTAL_METRICS = Object.freeze([
  { key:'earnings_yield', label:'利益利回り', group:'valuation', direction:'higher', unit:'ratio', scale:100, help:'1株利益または純利益を株価・時価総額で割った値。高いほど割安の目安です。' },
  { key:'book_to_market', label:'純資産／時価総額', group:'valuation', direction:'higher', unit:'ratio', scale:100, help:'純資産を時価総額で割った値。高いほど資産価値に対して割安です。' },
  { key:'fcf_yield', label:'FCF利回り', group:'valuation', direction:'higher', unit:'ratio', scale:100, help:'フリーキャッシュフローを時価総額で割った値。高いほど現金創出力に対して割安です。' },
  { key:'dividend_yield', label:'配当利回り', group:'valuation', direction:'higher', unit:'ratio', scale:100, help:'1株配当を株価で割った値。配当の継続性は別途確認が必要です。' },
  { key:'roe', label:'ROE', group:'quality', direction:'higher', unit:'ratio', scale:100, help:'純利益を自己資本で割った資本効率。高いほど良い一方、過大な負債にも注意します。' },
  { key:'operating_margin', label:'営業利益率', group:'quality', direction:'higher', unit:'ratio', scale:100, help:'営業利益を売上高で割った本業の収益性です。' },
  { key:'fcf_conversion', label:'FCF変換率', group:'quality', direction:'higher', unit:'ratio', scale:100, help:'利益が実際のFCFへ変換される度合いです。' },
  { key:'accrual_quality', label:'アクルーアル品質', group:'quality', direction:'higher', unit:'ratio', scale:100, help:'会計利益と営業CFの差を使う利益品質の目安です。' },
  { key:'revenue_growth', label:'売上成長率', group:'growth', direction:'higher', unit:'ratio', scale:100, help:'前年同期・前年度比の売上成長率です。' },
  { key:'eps_growth', label:'EPS成長率', group:'growth', direction:'higher', unit:'ratio', scale:100, help:'1株利益の成長率です。赤字転換時は解釈に注意します。' },
  { key:'fcf_growth', label:'FCF成長率', group:'growth', direction:'higher', unit:'ratio', scale:100, help:'フリーキャッシュフローの成長率です。' },
  { key:'earnings_stability', label:'利益安定性', group:'stability', direction:'higher', unit:'score', scale:100, help:'利益の変動が小さいほど高くなる安定性指標です。' },
  { key:'fcf_stability', label:'FCF安定性', group:'stability', direction:'higher', unit:'score', scale:100, help:'FCFの変動が小さいほど高くなる安定性指標です。' },
  { key:'negative_earnings_years', label:'赤字年数', group:'balanceRisk', direction:'lower', unit:'count', scale:1, help:'観測期間内の赤字年数。少ないほど良い指標です。' },
  { key:'negative_fcf_years', label:'負のFCF年数', group:'balanceRisk', direction:'lower', unit:'count', scale:1, help:'観測期間内でFCFがマイナスだった年数です。' },
  { key:'earnings_volatility', label:'利益変動率', group:'balanceRisk', direction:'lower', unit:'ratio', scale:100, help:'利益の変動の大きさ。低いほど安定的です。' },
  { key:'debt_to_equity', label:'負債／自己資本', group:'balanceRisk', direction:'lower', unit:'ratio', scale:1, help:'負債を自己資本で割った財務レバレッジ。業種差があります。' },
  { key:'value_trap_risk', label:'Value Trap Risk', group:'balanceRisk', direction:'lower', unit:'score', scale:1, help:'割安に見えて業績・CF悪化を抱える可能性。低いほど良い指標です。' },
  { key:'data_completeness', label:'データ充足率', group:'dataQuality', direction:'higher', unit:'score', scale:1, help:'評価に必要な項目がどの程度揃っているかを示します。' },
  { key:'technical_score', label:'Technical確認', group:'technicalConfirmation', direction:'higher', unit:'score', scale:1, help:'現在のトレンド・モメンタムによる確認値。ファンダメンタルとは別に扱います。' },
]);

export const FUNDAMENTAL_GROUPS = Object.freeze({
  valuation:'バリュエーション', quality:'企業品質', growth:'成長', stability:'安定性',
  balanceRisk:'財務・バリュートラップ', dataQuality:'データ品質', technicalConfirmation:'テクニカル確認',
});

export const DEFAULT_FUNDAMENTAL_CONFIG = Object.freeze({
  mode:'simple',
  preset:'custom',
  missingPolicy:'allow',
  thresholds:{},
  weights:{ valuation:25, quality:25, growth:12, stability:10, balanceRisk:13, dataQuality:10, technicalConfirmation:5 },
  topN:10,
});

export const FUNDAMENTAL_PRESETS = Object.freeze({
  dividend:{ label:'高配当', thresholds:{dividend_yield:3,data_completeness:45,value_trap_risk:55}, weights:{valuation:35,quality:20,growth:5,stability:10,balanceRisk:15,dataQuality:10,technicalConfirmation:5} },
  highRoe:{ label:'高ROE', thresholds:{roe:12,operating_margin:5,data_completeness:45}, weights:{valuation:15,quality:40,growth:10,stability:10,balanceRisk:10,dataQuality:10,technicalConfirmation:5} },
  fcf:{ label:'FCF重視', thresholds:{fcf_yield:2,fcf_conversion:50,data_completeness:45,negative_fcf_years:1}, weights:{valuation:25,quality:35,growth:8,stability:10,balanceRisk:12,dataQuality:7,technicalConfirmation:3} },
  growthValue:{ label:'成長割安', thresholds:{earnings_yield:2,revenue_growth:3,eps_growth:3,value_trap_risk:55}, weights:{valuation:25,quality:15,growth:30,stability:8,balanceRisk:10,dataQuality:7,technicalConfirmation:5} },
  lowTrap:{ label:'低バリュートラップ', thresholds:{value_trap_risk:35,negative_earnings_years:0,negative_fcf_years:1,data_completeness:50}, weights:{valuation:15,quality:25,growth:8,stability:15,balanceRisk:25,dataQuality:10,technicalConfirmation:2} },
  conservativeFree:{ label:'保守的Free', missingPolicy:'exclude', thresholds:{data_completeness:55,value_trap_risk:35,roe:8,operating_margin:3,negative_earnings_years:0,negative_fcf_years:1}, weights:{valuation:15,quality:25,growth:5,stability:15,balanceRisk:20,dataQuality:18,technicalConfirmation:2} },
});

const numeric = value => {
  if (value === null || value === undefined || value === '') return null;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
};

export function mergeFundamentalData(rankingPayload, reportPayload) {
  const decisionMap = new Map((reportPayload?.decisions ?? []).map(item => [String(item.code), item]));
  return (rankingPayload?.rows ?? []).map(row => {
    const raw = String(row.code ?? row.symbol ?? '').replace(/\.T$/i,'');
    const code = raw.length === 5 && raw.endsWith('0') ? raw.slice(0,-1) : raw;
    const decision = decisionMap.get(code) ?? {};
    const fundamental = decision.fundamental ?? {};
    const technical = decision.technical ?? {};
    const merged = { ...row, ...fundamental, technical_score:technical.score ?? row.technical_score };
    const values = {};
    for (const metric of FUNDAMENTAL_METRICS) values[metric.key] = numeric(merged[metric.key]);
    return { code, company_name:row.company_name ?? decision.company_name ?? code, sector:row.sector ?? '', market:row.market ?? '', values };
  });
}

function percentile(values, value, direction) {
  const clean = values.filter(item => item !== null).sort((a,b)=>a-b);
  if (value === null || !clean.length) return null;
  const below = clean.filter(item => item <= value).length;
  const pct = clean.length === 1 ? 50 : (below - 1) / (clean.length - 1) * 100;
  return direction === 'higher' ? pct : 100 - pct;
}

export function applyFundamentalPreset(name, current = DEFAULT_FUNDAMENTAL_CONFIG) {
  const preset = FUNDAMENTAL_PRESETS[name];
  if (!preset) return structuredClone(current);
  return {
    ...structuredClone(DEFAULT_FUNDAMENTAL_CONFIG), ...current, ...preset, mode:'detailed', preset:name,
    thresholds:{...(preset.thresholds ?? {})}, weights:{...DEFAULT_FUNDAMENTAL_CONFIG.weights,...(preset.weights ?? {})},
  };
}

export function evaluateFundamentals(records, config) {
  const populations = {};
  for (const metric of FUNDAMENTAL_METRICS) populations[metric.key] = records.map(row => row.values[metric.key]).filter(value => value !== null);
  const evaluated = records.map(record => {
    const exclusionReasons = [];
    const missing = [];
    const groupParts = {};
    for (const group of Object.keys(FUNDAMENTAL_GROUPS)) groupParts[group] = [];
    for (const metric of FUNDAMENTAL_METRICS) {
      const value = record.values[metric.key];
      const threshold = numeric(config.thresholds?.[metric.key]);
      if (value === null) {
        missing.push(metric.key);
        if (config.missingPolicy === 'exclude' && threshold !== null) exclusionReasons.push(`${metric.label}: 欠損`);
        if (config.missingPolicy === 'neutral') groupParts[metric.group].push(50);
        continue;
      }
      if (threshold !== null) {
        const displayValue = value * metric.scale;
        if (metric.direction === 'higher' && displayValue < threshold) exclusionReasons.push(`${metric.label} ${displayValue.toFixed(2)} < ${threshold}`);
        if (metric.direction === 'lower' && displayValue > threshold) exclusionReasons.push(`${metric.label} ${displayValue.toFixed(2)} > ${threshold}`);
      }
      const rank = percentile(populations[metric.key], value, metric.direction);
      if (rank !== null) groupParts[metric.group].push(rank);
    }
    const groupScores = {};
    let numerator = 0;
    let denominator = 0;
    for (const [group, parts] of Object.entries(groupParts)) {
      const groupScore = parts.length ? parts.reduce((sum,value)=>sum+value,0)/parts.length : null;
      groupScores[group] = groupScore;
      const weight = Math.max(0, Number(config.weights?.[group] ?? 0));
      if (groupScore !== null && weight > 0) { numerator += groupScore * weight; denominator += weight; }
    }
    return { ...record, groupScores, fundamentalLabScore:denominator ? numerator/denominator : null, missing, included:exclusionReasons.length===0, exclusionReasons };
  });
  const included = evaluated.filter(row=>row.included).sort((a,b)=>(b.fundamentalLabScore??-1)-(a.fundamentalLabScore??-1) || a.code.localeCompare(b.code,'ja',{numeric:true})).slice(0,Math.max(1,Number(config.topN??10)));
  const excluded = evaluated.filter(row=>!row.included);
  const avg = (rows, getter) => { const values=rows.map(getter).filter(value=>Number.isFinite(value)); return values.length?values.reduce((sum,value)=>sum+value,0)/values.length:null; };
  const sectors = new Map();
  for (const row of included) sectors.set(row.sector||'不明',(sectors.get(row.sector||'不明')??0)+1);
  const topSector = [...sectors.entries()].sort((a,b)=>b[1]-a[1])[0] ?? null;
  return { included, excluded, evaluated, sensitivity:{ passCount:included.length, totalCount:records.length, averageFundamental:avg(included,row=>row.fundamentalLabScore), averageTechnical:avg(included,row=>row.values.technical_score), averageTrap:avg(included,row=>row.values.value_trap_risk), topSector:topSector?.[0]??null, topSectorPct:topSector&&included.length?topSector[1]/included.length*100:null } };
}

export function fundamentalRowsToCsv(rows) {
  const metricKeys = FUNDAMENTAL_METRICS.map(metric=>metric.key);
  const columns = ['code','company_name','market','sector','fundamentalLabScore',...Object.keys(FUNDAMENTAL_GROUPS),...metricKeys,'missing'];
  const escape = value => { const text=Array.isArray(value)?value.join(' / '):String(value??''); return /[",\n]/.test(text)?`"${text.replaceAll('"','""')}"`:text; };
  return [columns.join(','),...rows.map(row=>columns.map(column=>escape(column in row?row[column]:column in row.groupScores?row.groupScores[column]:row.values[column])).join(','))].join('\n');
}
