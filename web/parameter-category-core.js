export const PARAMETER_CATEGORIES = Object.freeze(['Universe','Fundamental','Technical','Risk','Display']);

export function parameterCategory(path = '') {
  const value = String(path);
  if (value.startsWith('fundamental.')) return 'Fundamental';
  if (value.startsWith('risk.')) return 'Risk';
  if (value.startsWith('display.')) return 'Display';
  if (value.startsWith('screening.')) {
    if (/minRsi|maxRsi|minMomentum|maxVolatility|minDrawdown|requirePriceAboveSma20|requireSma20AboveSma60|minTechnical|weights\.technical/.test(value)) return 'Technical';
    if (/minFundamental|minValue|minQuality|minGrowth|minCompleteness|maxTrap|weights\.(fundamental|value|quality|growth|trapPenalty)/.test(value)) return 'Fundamental';
    return 'Universe';
  }
  return 'Universe';
}

export function categoryCounts(paths = []) {
  const counts = Object.fromEntries(PARAMETER_CATEGORIES.map(category => [category, 0]));
  paths.forEach(path => { counts[parameterCategory(path)] += 1; });
  return counts;
}
