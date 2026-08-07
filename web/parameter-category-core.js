export const PARAMETER_CATEGORIES = Object.freeze({
  F:{ key:'F', label:'Fundamental', description:'何を保有するか—企業価値・品質・成長・CFを評価' },
  T:{ key:'T', label:'Technical', description:'いつ入る・出るか—価格・トレンド・勢いを評価' },
  R:{ key:'R', label:'Risk', description:'損失・ドローダウン・集中の上限' },
  S:{ key:'S', label:'Screening', description:'母集団・データ品質・表示候補を設定' },
  UI:{ key:'UI', label:'表示', description:'文字サイズ・密度・コントラスト' },
});

const TECHNICAL_PATHS = new Set([
  'screening.minTechnical','screening.minRsi','screening.maxRsi','screening.minMomentum20','screening.minMomentum60','screening.maxVolatility','screening.minDrawdown','screening.weights.technical','screening.requirePriceAboveSma20','screening.requireSma20AboveSma60',
]);
const FUNDAMENTAL_SCREENING_PATHS = new Set([
  'screening.minFundamental','screening.minValue','screening.minQuality','screening.minGrowth','screening.maxTrap','screening.weights.fundamental','screening.weights.value','screening.weights.quality','screening.weights.growth','screening.weights.trapPenalty',
]);

export function categoryForParameterPath(path = '') {
  if (String(path).startsWith('fundamental.')) return 'F';
  if (String(path).startsWith('risk.')) return 'R';
  if (String(path).startsWith('display.')) return 'UI';
  if (TECHNICAL_PATHS.has(path)) return 'T';
  if (FUNDAMENTAL_SCREENING_PATHS.has(path)) return 'F';
  if (String(path).startsWith('screening.')) return 'S';
  return 'S';
}

export function categorySummary(paths = []) {
  const counts = { F:0,T:0,R:0,S:0,UI:0 };
  for (const path of paths) counts[categoryForParameterPath(path)] += 1;
  return counts;
}
