export const DEFAULT_RISK_POLICY = Object.freeze({
  maxPortfolioDrawdownPct: 8,
  maxTotalUnrealizedLossPct: 5,
  maxTotalUnrealizedLossYen: 1500000,
  maxPositionLossPct: 8,
  maxPositionLossYen: 500000,
  maxPositionWeightPct: 20,
  maxSectorWeightPct: 35,
  alertMode: 'warn',
});

const num = value => {
  if (value === null || value === undefined || value === '') return null;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
};

export function normalizeRiskPolicy(input = {}) {
  const policy = { ...DEFAULT_RISK_POLICY, ...input };
  for (const key of Object.keys(DEFAULT_RISK_POLICY)) {
    if (key === 'alertMode') continue;
    const value = Number(policy[key]);
    policy[key] = Number.isFinite(value) && value >= 0 ? value : DEFAULT_RISK_POLICY[key];
  }
  if (!['warn','strict'].includes(policy.alertMode)) policy.alertMode = 'warn';
  return policy;
}

export function currentRiskSnapshot(metrics, quotes, demoPortfolio, report) {
  const entryBasis = num(metrics?.sample?.seed_cost_basis) ?? num(demoPortfolio?.total_entry_value) ?? 0;
  const currentEquity = num(quotes?.portfolio?.total_current_value) ?? num(metrics?.sample?.current_equity) ?? num(report?.summary?.equity) ?? 0;
  const unrealized = num(quotes?.portfolio?.total_unrealized_pnl) ?? num(report?.summary?.unrealized_pnl) ?? 0;
  const recordedEquity = (metrics?.series?.equity ?? []).map(row => num(row.equity)).filter(value => value !== null);
  const peak = Math.max(entryBasis || 0, currentEquity || 0, ...recordedEquity);
  const liveDrawdownPct = peak > 0 ? (currentEquity / peak - 1) * 100 : null;
  const positionsByCode = new Map((quotes?.positions ?? []).map(position => [String(position.code), position]));
  const demoByCode = new Map((demoPortfolio?.positions ?? []).map(position => [String(position.code), position]));
  const positions = [...new Set([...positionsByCode.keys(), ...demoByCode.keys()])].map(code => {
    const quote = positionsByCode.get(code) ?? {};
    const demo = demoByCode.get(code) ?? {};
    const quantity = num(demo.quantity) ?? 100;
    const entryPrice = num(quote.entry_price) ?? num(demo.entry_price) ?? 0;
    const currentPrice = num(quote.current_price) ?? entryPrice;
    const currentValue = currentPrice * quantity;
    const entryValue = entryPrice * quantity;
    const pnl = num(quote.unrealized_pnl) ?? currentValue - entryValue;
    const returnPct = num(quote.return_pct) ?? (entryValue ? pnl / entryValue * 100 : null);
    return {
      code,
      name: quote.name ?? demo.company_name ?? code,
      quantity,
      entryPrice,
      currentPrice,
      entryValue,
      currentValue,
      pnl,
      returnPct,
      weightPct: currentEquity > 0 ? currentValue / currentEquity * 100 : null,
      usable: quote.usable !== false,
      verification: quote.verification ?? 'unknown',
    };
  });
  return {
    entryBasis,
    currentEquity,
    unrealized,
    unrealizedPct: entryBasis > 0 ? unrealized / entryBasis * 100 : null,
    peakEquity: peak,
    liveDrawdownPct,
    positions,
  };
}

export function evaluateRiskPolicy(snapshot, policyInput) {
  const policy = normalizeRiskPolicy(policyInput);
  const breaches = [];
  const push = (code, severity, title, actual, limit, detail) => breaches.push({ code, severity, title, actual, limit, detail });
  if (snapshot.liveDrawdownPct !== null && snapshot.liveDrawdownPct <= -policy.maxPortfolioDrawdownPct) {
    push('portfolio_drawdown','high','ポートフォリオDD上限',snapshot.liveDrawdownPct,-policy.maxPortfolioDrawdownPct,'現在評価額が直近ピークから設定上限を超えて下落');
  }
  if (snapshot.unrealizedPct !== null && snapshot.unrealizedPct <= -policy.maxTotalUnrealizedLossPct) {
    push('total_unrealized_pct','high','全体含み損率上限',snapshot.unrealizedPct,-policy.maxTotalUnrealizedLossPct,'元本に対する含み損率が上限超過');
  }
  if (snapshot.unrealized <= -policy.maxTotalUnrealizedLossYen) {
    push('total_unrealized_yen','high','全体含み損額上限',snapshot.unrealized,-policy.maxTotalUnrealizedLossYen,'全体の含み損額が上限超過');
  }
  for (const position of snapshot.positions) {
    if (position.returnPct !== null && position.returnPct <= -policy.maxPositionLossPct) {
      push(`position_pct:${position.code}`,'medium',`${position.name} 損失率上限`,position.returnPct,-policy.maxPositionLossPct,'1銘柄の含み損率が上限超過');
    }
    if (position.pnl <= -policy.maxPositionLossYen) {
      push(`position_yen:${position.code}`,'medium',`${position.name} 損失額上限`,position.pnl,-policy.maxPositionLossYen,'1銘柄の含み損額が上限超過');
    }
    if (position.weightPct !== null && position.weightPct >= policy.maxPositionWeightPct) {
      push(`weight:${position.code}`,'low',`${position.name} 集中上限`,position.weightPct,policy.maxPositionWeightPct,'1銘柄の評価額比率が上限超過');
    }
  }
  return { policy, breaches, status: breaches.some(item => item.severity === 'high') ? 'high' : breaches.length ? 'warning' : 'ok' };
}

export function mobileDateRange(rows, period = 'all') {
  const usable = (rows ?? []).filter(row => row?.date).map(row => ({ ...row, parsed:new Date(row.date) })).filter(row => !Number.isNaN(row.parsed.getTime()));
  if (!usable.length) return { start:null, end:null, calendarDays:0, points:0, period };
  const start = usable[0].parsed;
  const end = usable.at(-1).parsed;
  return {
    start: start.toISOString(),
    end: end.toISOString(),
    calendarDays: Math.max(1, Math.round((end-start)/86400000)+1),
    points: usable.length,
    period,
  };
}
