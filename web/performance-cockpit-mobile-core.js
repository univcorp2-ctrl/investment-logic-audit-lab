import { correctedEquitySeries, finite, liveDrawdown, maxDrawdownPct } from './performance-cockpit-core.js';

export const GRAPH_SIZES = Object.freeze(['compact', 'normal', 'large']);
export const ZOOM_PERIODS = Object.freeze(['all', '1y', '6m', '3m', '1m', '1w']);

export function graphSizePx(size = 'normal', phone = false) {
  const table = phone
    ? { compact: 220, normal: 300, large: 410 }
    : { compact: 260, normal: 360, large: 500 };
  return table[GRAPH_SIZES.includes(size) ? size : 'normal'];
}

export function nextGraphSize(size = 'normal', direction = 1) {
  const index = GRAPH_SIZES.indexOf(size);
  const current = index >= 0 ? index : 1;
  return GRAPH_SIZES[Math.max(0, Math.min(GRAPH_SIZES.length - 1, current + direction))];
}

export function nextZoomPeriod(period = 'all', direction = 1) {
  const index = ZOOM_PERIODS.indexOf(period);
  const current = index >= 0 ? index : 0;
  return ZOOM_PERIODS[Math.max(0, Math.min(ZOOM_PERIODS.length - 1, current + direction))];
}

export function historicalMaxUnrealizedLoss(rows = [], seedCostBasis = null) {
  const seed = finite(seedCostBasis);
  const candidates = rows
    .map(row => ({ date: String(row.date ?? '').slice(0, 10), amount: finite(row.unrealized_pnl) }))
    .filter(row => row.date && row.amount !== null && row.amount < 0);
  if (!candidates.length) return { amount: null, pct: null, date: null };
  const worst = candidates.reduce((a, b) => b.amount < a.amount ? b : a);
  return {
    amount: worst.amount,
    pct: seed && seed > 0 ? worst.amount / seed * 100 : null,
    date: worst.date,
  };
}

export function combinedRiskHero(rows = [], seedCostBasis = null, liveEquity = null) {
  const series = correctedEquitySeries(rows, seedCostBasis);
  const historical = maxDrawdownPct(series, seedCostBasis);
  const live = liveDrawdown(series, seedCostBasis, liveEquity);
  const current = finite(live.current_drawdown_pct);
  const worse = Math.min(historical ?? 0, current ?? 0);
  return {
    historical_max_drawdown_pct: historical,
    current_drawdown_pct: current,
    worse_drawdown_pct: worse,
    includes_live: current !== null && historical !== null && current < historical,
    max_unrealized_loss: historicalMaxUnrealizedLoss(rows, seedCostBasis),
  };
}

export function extractChartPointLabels(titles = []) {
  return titles.map((text, index) => {
    const match = String(text ?? '').trim().match(/^(\d{4}-\d{2}-\d{2})\s+(.*)$/);
    if (!match) return null;
    return {
      index,
      date: match[1],
      shortDate: match[1].slice(5).replace('-', '/'),
      valueText: match[2],
      fullText: `${match[1].replaceAll('-', '/')} · ${match[2]}`,
    };
  }).filter(Boolean);
}
