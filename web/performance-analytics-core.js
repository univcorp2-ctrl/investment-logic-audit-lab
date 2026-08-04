export const DEFAULT_ANALYTICS_CONFIG = Object.freeze({
  annualization: 252,
  annualRiskFreeRate: 0.005,
  minimumVolatilityObservations: 20,
  minimumRiskAdjustedObservations: 42,
  minimumVarObservations: 60,
  minimumCagrObservations: 126,
  varLevels: [0.95, 0.99],
});

const EPSILON = 1e-12;

export function finiteNumber(value) {
  if (value === null || value === undefined || value === '') return null;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

function metric(value, status = 'ok', observations = 0, minimumRequired = 0, extra = {}) {
  return {
    value: finiteNumber(value),
    status,
    observations,
    minimum_required: minimumRequired,
    ...extra,
  };
}

function gated(value, observations, minimumRequired, extra = {}) {
  return observations >= minimumRequired
    ? metric(value, 'ok', observations, minimumRequired, extra)
    : metric(null, 'insufficient_history', observations, minimumRequired, extra);
}

function mean(values) {
  return values.length ? values.reduce((sum, value) => sum + value, 0) / values.length : null;
}

function sampleStd(values) {
  if (values.length < 2) return null;
  const average = mean(values);
  const variance = values.reduce((sum, value) => sum + (value - average) ** 2, 0) / (values.length - 1);
  return Math.sqrt(Math.max(0, variance));
}

function quantile(values, probability) {
  if (!values.length) return null;
  const sorted = [...values].sort((a, b) => a - b);
  const index = (sorted.length - 1) * probability;
  const lower = Math.floor(index);
  const upper = Math.ceil(index);
  if (lower === upper) return sorted[lower];
  return sorted[lower] + (sorted[upper] - sorted[lower]) * (index - lower);
}

function daysBetween(left, right) {
  const a = new Date(`${left}T00:00:00Z`);
  const b = new Date(`${right}T00:00:00Z`);
  return Math.max(0, Math.round((b - a) / 86_400_000));
}

function toDateKey(value) {
  if (!value) return null;
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return String(value).slice(0, 10);
  return date.toISOString().slice(0, 10);
}

export function normalizeEquityHistory(historyPayload, initialCapital = null, openedAt = null) {
  const source = Array.isArray(historyPayload) ? historyPayload : historyPayload?.history ?? [];
  const byDate = new Map();
  let duplicates = 0;
  for (const item of source) {
    const date = toDateKey(item?.date);
    const equity = finiteNumber(item?.equity);
    if (!date || equity === null || equity <= 0) continue;
    if (byDate.has(date)) duplicates += 1;
    byDate.set(date, {
      date,
      equity,
      realized_pnl: finiteNumber(item.realized_pnl),
      unrealized_pnl: finiteNumber(item.unrealized_pnl),
      total_pnl: finiteNumber(item.total_pnl),
      daily_return_pct: finiteNumber(item.daily_return_pct),
      cumulative_return_pct: finiteNumber(item.cumulative_return_pct),
    });
  }
  const rows = [...byDate.values()].sort((a, b) => a.date.localeCompare(b.date));
  const initial = finiteNumber(initialCapital);
  const openedDate = toDateKey(openedAt);
  if (initial !== null && openedDate && (!rows.length || openedDate < rows[0].date)) {
    rows.unshift({
      date: openedDate,
      equity: initial,
      realized_pnl: 0,
      unrealized_pnl: 0,
      total_pnl: 0,
      daily_return_pct: 0,
      cumulative_return_pct: 0,
      synthetic_opening_mark: true,
    });
  }
  return { rows, duplicates };
}

function returnSeries(rows) {
  const returns = [];
  for (let index = 1; index < rows.length; index += 1) {
    const previous = rows[index - 1].equity;
    const current = rows[index].equity;
    if (previous > 0) returns.push({ date: rows[index].date, value: current / previous - 1 });
  }
  return returns;
}

function periodReturn(rows, periodStart, initialCapital) {
  if (!rows.length) return metric(null, 'no_data');
  const end = rows.at(-1);
  const before = [...rows].reverse().find(row => row.date < periodStart);
  const startValue = before?.equity ?? finiteNumber(initialCapital);
  if (startValue === null || startValue <= 0) return metric(null, 'no_baseline', rows.length);
  const status = before ? 'ok' : 'partial_period';
  return metric((end.equity / startValue - 1) * 100, status, rows.length, 1, { period_start: periodStart });
}

function periodStarts(endDate) {
  const date = new Date(`${endDate}T00:00:00Z`);
  const year = date.getUTCFullYear();
  const month = date.getUTCMonth();
  const quarterMonth = Math.floor(month / 3) * 3;
  return {
    mtd: `${year}-${String(month + 1).padStart(2, '0')}-01`,
    qtd: `${year}-${String(quarterMonth + 1).padStart(2, '0')}-01`,
    ytd: `${year}-01-01`,
  };
}

export function computeDrawdown(rows) {
  if (!rows.length) {
    return {
      series: [],
      maximum_pct: metric(null, 'no_data'),
      maximum_amount: metric(null, 'no_data'),
      current_pct: metric(null, 'no_data'),
      peak_date: null,
      trough_date: null,
      recovery_date: null,
      maximum_duration_days: metric(null, 'no_data'),
      current_underwater_days: metric(null, 'no_data'),
    };
  }
  let runningPeak = rows[0].equity;
  let runningPeakDate = rows[0].date;
  let maxDrawdown = 0;
  let maxAmount = 0;
  let peakDate = rows[0].date;
  let troughDate = rows[0].date;
  let troughIndex = 0;
  let maxDuration = 0;
  let underwaterStart = null;
  const series = [];
  rows.forEach((row, index) => {
    if (row.equity >= runningPeak) {
      runningPeak = row.equity;
      runningPeakDate = row.date;
      underwaterStart = null;
    } else if (underwaterStart === null) {
      underwaterStart = index - 1;
    }
    const drawdown = runningPeak > 0 ? row.equity / runningPeak - 1 : 0;
    const amount = row.equity - runningPeak;
    series.push({ date: row.date, value: drawdown * 100, amount });
    if (drawdown < maxDrawdown) {
      maxDrawdown = drawdown;
      maxAmount = amount;
      peakDate = runningPeakDate;
      troughDate = row.date;
      troughIndex = index;
    }
    if (underwaterStart !== null) maxDuration = Math.max(maxDuration, index - underwaterStart);
  });
  const peakValue = rows.find(row => row.date === peakDate)?.equity ?? rows[0].equity;
  const recovery = rows.slice(troughIndex + 1).find(row => row.equity >= peakValue);
  const current = series.at(-1);
  const currentPeakIndex = [...series].reverse().findIndex(item => item.value === 0);
  const currentUnderwater = current.value < 0
    ? (currentPeakIndex < 0 ? rows.length - 1 : currentPeakIndex)
    : 0;
  return {
    series,
    maximum_pct: metric(maxDrawdown * 100, 'ok', rows.length, 1),
    maximum_amount: metric(maxAmount, 'ok', rows.length, 1),
    current_pct: metric(current.value, 'ok', rows.length, 1),
    peak_date: peakDate,
    trough_date: troughDate,
    recovery_date: recovery?.date ?? null,
    maximum_duration_days: metric(maxDuration, 'ok', rows.length, 1, { unit: 'trading_days' }),
    current_underwater_days: metric(currentUnderwater, 'ok', rows.length, 1, { unit: 'trading_days' }),
  };
}

function historicalRisk(returns, confidence, minimum) {
  if (returns.length < minimum) {
    return {
      var: metric(null, 'insufficient_history', returns.length, minimum),
      cvar: metric(null, 'insufficient_history', returns.length, minimum),
    };
  }
  const threshold = quantile(returns, 1 - confidence);
  const tail = returns.filter(value => value <= threshold);
  return {
    var: metric(Math.max(0, -threshold) * 100, 'ok', returns.length, minimum, { confidence }),
    cvar: metric(Math.max(0, -(mean(tail) ?? 0)) * 100, 'ok', returns.length, minimum, { confidence }),
  };
}

function higherMoments(returns, minimum) {
  if (returns.length < minimum) {
    return {
      skewness: metric(null, 'insufficient_history', returns.length, minimum),
      excess_kurtosis: metric(null, 'insufficient_history', returns.length, minimum),
    };
  }
  const average = mean(returns);
  const std = sampleStd(returns);
  if (!std || std < EPSILON) {
    return {
      skewness: metric(null, 'zero_variance', returns.length, minimum),
      excess_kurtosis: metric(null, 'zero_variance', returns.length, minimum),
    };
  }
  const skew = mean(returns.map(value => ((value - average) / std) ** 3));
  const kurtosis = mean(returns.map(value => ((value - average) / std) ** 4)) - 3;
  return {
    skewness: metric(skew, 'ok', returns.length, minimum),
    excess_kurtosis: metric(kurtosis, 'ok', returns.length, minimum),
  };
}

function inferClosedTrades(tradesPayload, demoPayload) {
  const trades = Array.isArray(tradesPayload) ? tradesPayload : tradesPayload?.trades ?? [];
  const seeds = new Map((demoPayload?.positions ?? []).map(position => [position.symbol, position]));
  return trades.filter(trade => trade.side === 'SIM_SELL').map(trade => {
    const seed = seeds.get(trade.symbol) ?? {};
    const entry = finiteNumber(seed.entry_price);
    const exit = finiteNumber(trade.price);
    const quantity = finiteNumber(trade.quantity) ?? 0;
    const pnl = entry !== null && exit !== null ? (exit - entry) * quantity : null;
    const returnPct = entry !== null && exit !== null && entry > 0 ? (exit / entry - 1) * 100 : null;
    const opened = toDateKey(seed.entry_time);
    const closed = toDateKey(trade.date);
    return {
      symbol: trade.symbol,
      entry_price: entry,
      exit_price: exit,
      quantity,
      pnl,
      return_pct: returnPct,
      opened_at: opened,
      closed_at: closed,
      holding_days: opened && closed ? daysBetween(opened, closed) : null,
    };
  });
}

export function computeTradeStatistics(tradesPayload, demoPayload) {
  const trades = inferClosedTrades(tradesPayload, demoPayload).filter(trade => trade.pnl !== null);
  const wins = trades.filter(trade => trade.pnl > 0);
  const losses = trades.filter(trade => trade.pnl < 0);
  const flat = trades.filter(trade => trade.pnl === 0);
  const averageWin = mean(wins.map(trade => trade.pnl));
  const averageLoss = mean(losses.map(trade => trade.pnl));
  const averageWinReturn = mean(wins.map(trade => trade.return_pct));
  const averageLossReturn = mean(losses.map(trade => trade.return_pct));
  const grossProfit = wins.reduce((sum, trade) => sum + trade.pnl, 0);
  const grossLoss = Math.abs(losses.reduce((sum, trade) => sum + trade.pnl, 0));
  const payoff = averageWin !== null && averageLoss !== null && averageLoss !== 0
    ? averageWin / Math.abs(averageLoss)
    : null;
  const riskReward = averageWinReturn !== null && averageLossReturn !== null && averageLossReturn !== 0
    ? averageWinReturn / Math.abs(averageLossReturn)
    : null;
  return {
    closed_trades: trades,
    count: metric(trades.length, 'ok', trades.length, 1),
    winning_trades: metric(wins.length, 'ok', trades.length, 1),
    losing_trades: metric(losses.length, 'ok', trades.length, 1),
    flat_trades: metric(flat.length, 'ok', trades.length, 1),
    win_rate_pct: trades.length ? metric(wins.length / trades.length * 100, 'ok', trades.length, 1) : metric(null, 'no_trades'),
    loss_rate_pct: trades.length ? metric(losses.length / trades.length * 100, 'ok', trades.length, 1) : metric(null, 'no_trades'),
    average_gain: wins.length ? metric(averageWin, 'ok', wins.length, 1) : metric(null, 'no_winning_trades'),
    average_loss: losses.length ? metric(averageLoss, 'ok', losses.length, 1) : metric(null, 'no_losing_trades'),
    payoff_ratio: payoff === null ? metric(null, 'requires_wins_and_losses', trades.length, 2) : metric(payoff, 'ok', trades.length, 2),
    risk_reward_ratio: riskReward === null ? metric(null, 'requires_wins_and_losses', trades.length, 2) : metric(riskReward, 'ok', trades.length, 2),
    profit_factor: grossLoss > 0 ? metric(grossProfit / grossLoss, 'ok', trades.length, 2) : metric(null, 'no_gross_loss', trades.length, 2),
    expectancy_per_trade: trades.length ? metric(mean(trades.map(trade => trade.pnl)), 'ok', trades.length, 1) : metric(null, 'no_trades'),
    average_holding_days: trades.some(trade => trade.holding_days !== null)
      ? metric(mean(trades.map(trade => trade.holding_days).filter(value => value !== null)), 'ok', trades.length, 1)
      : metric(null, 'no_holding_period'),
  };
}

export function computePositionAnalytics(portfolioPayload, latestReport, initialCapital = null) {
  const positions = portfolioPayload?.positions ?? [];
  const decisions = new Map((latestReport?.decisions ?? []).map(item => [item.symbol, item]));
  const cash = finiteNumber(portfolioPayload?.cash) ?? 0;
  const rows = positions.map(position => {
    const decision = decisions.get(position.symbol) ?? {};
    const price = decision.quote?.valid === false
      ? finiteNumber(position.avg_cost)
      : finiteNumber(decision.technical?.price) ?? finiteNumber(position.avg_cost);
    const quantity = finiteNumber(position.quantity) ?? 0;
    const averageCost = finiteNumber(position.avg_cost) ?? finiteNumber(position.entry_price) ?? 0;
    const costBasis = averageCost * quantity;
    const marketValue = (price ?? averageCost) * quantity;
    const pnl = marketValue - costBasis;
    return {
      symbol: position.symbol,
      code: position.code,
      company_name: position.company_name ?? decision.company_name ?? position.symbol,
      quantity,
      average_cost: averageCost,
      current_price: price,
      cost_basis: costBasis,
      market_value: marketValue,
      pnl,
      return_pct: costBasis > 0 ? pnl / costBasis * 100 : null,
      quote_valid: decision.quote?.valid ?? null,
    };
  });
  const marketValue = rows.reduce((sum, row) => sum + row.market_value, 0);
  const equity = marketValue + cash;
  rows.forEach(row => {
    row.weight_pct = equity > 0 ? row.market_value / equity * 100 : null;
  });
  rows.sort((a, b) => b.pnl - a.pnl);
  const totalPnl = rows.reduce((sum, row) => sum + row.pnl, 0);
  rows.forEach((row, index) => {
    row.contribution_rank = index + 1;
    row.pnl_contribution_pct = Math.abs(totalPnl) > EPSILON ? row.pnl / totalPnl * 100 : null;
  });
  const weights = rows.map(row => (row.weight_pct ?? 0) / 100).sort((a, b) => b - a);
  const base = finiteNumber(initialCapital) ?? equity;
  const turnoverAmount = (latestReport?.summary?.turnover_today ?? 0);
  return {
    positions: rows,
    equity,
    cash,
    market_value: marketValue,
    gross_exposure_pct: equity > 0 ? marketValue / equity * 100 : null,
    net_exposure_pct: equity > 0 ? marketValue / equity * 100 : null,
    cash_ratio_pct: equity > 0 ? cash / equity * 100 : null,
    position_count: rows.length,
    largest_position_pct: weights.length ? weights[0] * 100 : null,
    top3_concentration_pct: weights.slice(0, 3).reduce((sum, value) => sum + value, 0) * 100,
    hhi: weights.reduce((sum, value) => sum + value ** 2, 0),
    turnover_amount: finiteNumber(turnoverAmount) ?? 0,
    turnover_rate_pct: base > 0 ? (finiteNumber(turnoverAmount) ?? 0) / base * 100 : null,
  };
}

function alignedBenchmarkMetrics(rows, benchmarkPayload, config) {
  const benchmarkRows = Array.isArray(benchmarkPayload) ? benchmarkPayload : benchmarkPayload?.history ?? [];
  const benchmark = new Map(benchmarkRows.map(item => [toDateKey(item.date), finiteNumber(item.close ?? item.equity)]));
  const pairs = rows.map(row => ({ date: row.date, portfolio: row.equity, benchmark: benchmark.get(row.date) }))
    .filter(row => row.benchmark !== null && row.benchmark !== undefined);
  if (pairs.length < 2) return { status: 'benchmark_unavailable', observations: pairs.length };
  const portfolioReturns = [];
  const benchmarkReturns = [];
  for (let index = 1; index < pairs.length; index += 1) {
    portfolioReturns.push(pairs[index].portfolio / pairs[index - 1].portfolio - 1);
    benchmarkReturns.push(pairs[index].benchmark / pairs[index - 1].benchmark - 1);
  }
  const observations = portfolioReturns.length;
  const minimum = config.minimumRiskAdjustedObservations;
  const portfolioTotal = pairs.at(-1).portfolio / pairs[0].portfolio - 1;
  const benchmarkTotal = pairs.at(-1).benchmark / pairs[0].benchmark - 1;
  if (observations < minimum) {
    return {
      status: 'insufficient_history', observations,
      portfolio_total_return_pct: metric(portfolioTotal * 100, 'ok', observations, 1),
      benchmark_total_return_pct: metric(benchmarkTotal * 100, 'ok', observations, 1),
      excess_return_pct: metric((portfolioTotal - benchmarkTotal) * 100, 'ok', observations, 1),
      beta: metric(null, 'insufficient_history', observations, minimum),
      alpha_pct: metric(null, 'insufficient_history', observations, minimum),
      correlation: metric(null, 'insufficient_history', observations, minimum),
      tracking_error_pct: metric(null, 'insufficient_history', observations, minimum),
      information_ratio: metric(null, 'insufficient_history', observations, minimum),
      treynor_ratio: metric(null, 'insufficient_history', observations, minimum),
      up_capture_pct: metric(null, 'insufficient_history', observations, minimum),
      down_capture_pct: metric(null, 'insufficient_history', observations, minimum),
    };
  }
  const averageP = mean(portfolioReturns);
  const averageB = mean(benchmarkReturns);
  const varianceB = sampleStd(benchmarkReturns) ** 2;
  const covariance = portfolioReturns.reduce((sum, value, index) => sum + (value - averageP) * (benchmarkReturns[index] - averageB), 0) / (observations - 1);
  const beta = varianceB > EPSILON ? covariance / varianceB : null;
  const riskFreeDaily = (1 + config.annualRiskFreeRate) ** (1 / config.annualization) - 1;
  const alpha = beta === null ? null : (averageP - riskFreeDaily - beta * (averageB - riskFreeDaily)) * config.annualization;
  const correlation = covariance / ((sampleStd(portfolioReturns) ?? 0) * (sampleStd(benchmarkReturns) ?? 0));
  const active = portfolioReturns.map((value, index) => value - benchmarkReturns[index]);
  const trackingError = sampleStd(active) * Math.sqrt(config.annualization);
  const information = trackingError > EPSILON ? mean(active) * config.annualization / trackingError : null;
  const treynor = beta && Math.abs(beta) > EPSILON ? ((averageP - riskFreeDaily) * config.annualization) / beta : null;
  const upIndexes = benchmarkReturns.map((value, index) => value > 0 ? index : null).filter(value => value !== null);
  const downIndexes = benchmarkReturns.map((value, index) => value < 0 ? index : null).filter(value => value !== null);
  const capture = indexes => {
    if (!indexes.length) return null;
    const p = mean(indexes.map(index => portfolioReturns[index]));
    const b = mean(indexes.map(index => benchmarkReturns[index]));
    return Math.abs(b) > EPSILON ? p / b * 100 : null;
  };
  return {
    status: 'ok', observations,
    portfolio_total_return_pct: metric(portfolioTotal * 100, 'ok', observations, 1),
    benchmark_total_return_pct: metric(benchmarkTotal * 100, 'ok', observations, 1),
    excess_return_pct: metric((portfolioTotal - benchmarkTotal) * 100, 'ok', observations, 1),
    beta: metric(beta, 'ok', observations, minimum),
    alpha_pct: metric(alpha === null ? null : alpha * 100, alpha === null ? 'zero_variance' : 'ok', observations, minimum),
    correlation: metric(correlation, 'ok', observations, minimum),
    tracking_error_pct: metric(trackingError * 100, 'ok', observations, minimum),
    information_ratio: metric(information, information === null ? 'zero_tracking_error' : 'ok', observations, minimum),
    treynor_ratio: metric(treynor, treynor === null ? 'zero_beta' : 'ok', observations, minimum),
    up_capture_pct: metric(capture(upIndexes), upIndexes.length ? 'ok' : 'no_up_days', observations, minimum),
    down_capture_pct: metric(capture(downIndexes), downIndexes.length ? 'ok' : 'no_down_days', observations, minimum),
  };
}

export function buildPerformanceAnalytics({
  equityHistory,
  trades,
  portfolio,
  latestReport,
  demoPortfolio,
  benchmark = null,
  config = DEFAULT_ANALYTICS_CONFIG,
}) {
  const initialCapital = finiteNumber(demoPortfolio?.total_entry_value)
    ?? (demoPortfolio?.positions ?? []).reduce((sum, position) => sum + (finiteNumber(position.entry_price) ?? 0) * (finiteNumber(position.quantity) ?? 0), 0);
  const normalized = normalizeEquityHistory(equityHistory, initialCapital, demoPortfolio?.opened_at);
  const rows = normalized.rows;
  const returnRows = returnSeries(rows);
  const returns = returnRows.map(row => row.value);
  const observations = returns.length;
  const currentEquity = rows.at(-1)?.equity ?? initialCapital;
  const totalReturn = initialCapital > 0 ? currentEquity / initialCapital - 1 : null;
  const volatilityDaily = sampleStd(returns);
  const volatilityAnnual = volatilityDaily === null ? null : volatilityDaily * Math.sqrt(config.annualization);
  const riskFreeDaily = (1 + config.annualRiskFreeRate) ** (1 / config.annualization) - 1;
  const excess = returns.map(value => value - riskFreeDaily);
  const downside = excess.filter(value => value < 0);
  const downsideDeviation = downside.length ? Math.sqrt(mean(downside.map(value => value ** 2))) * Math.sqrt(config.annualization) : null;
  const sharpe = volatilityAnnual && volatilityAnnual > EPSILON ? mean(excess) * config.annualization / volatilityAnnual : null;
  const sortino = downsideDeviation && downsideDeviation > EPSILON ? mean(excess) * config.annualization / downsideDeviation : null;
  const drawdown = computeDrawdown(rows);
  const calendarDays = rows.length > 1 ? daysBetween(rows[0].date, rows.at(-1).date) : 0;
  const cagr = observations >= config.minimumCagrObservations && calendarDays > 0
    ? (currentEquity / initialCapital) ** (365.25 / calendarDays) - 1
    : null;
  const calmar = cagr !== null && Math.abs(drawdown.maximum_pct.value ?? 0) > EPSILON
    ? cagr / Math.abs(drawdown.maximum_pct.value / 100)
    : null;
  const ulcer = rows.length >= config.minimumVolatilityObservations
    ? Math.sqrt(mean(drawdown.series.map(item => item.value ** 2)))
    : null;
  const recovery = Math.abs(drawdown.maximum_pct.value ?? 0) > EPSILON && totalReturn !== null
    ? totalReturn / Math.abs(drawdown.maximum_pct.value / 100)
    : null;
  const starts = rows.length ? periodStarts(rows.at(-1).date) : null;
  const risk95 = historicalRisk(returns, 0.95, config.minimumVarObservations);
  const risk99 = historicalRisk(returns, 0.99, config.minimumVarObservations);
  const moments = higherMoments(returns, config.minimumVolatilityObservations);
  const positives = returns.filter(value => value > 0);
  const negatives = returns.filter(value => value < 0);
  const flats = returns.filter(value => value === 0);
  const tradeStats = computeTradeStatistics(trades, demoPortfolio);
  const positionStats = computePositionAnalytics(portfolio, latestReport, initialCapital);
  const businessDates = rows.length > 1 ? [] : [];
  if (rows.length > 1) {
    let cursor = new Date(`${rows[0].date}T00:00:00Z`);
    const end = new Date(`${rows.at(-1).date}T00:00:00Z`);
    const existing = new Set(rows.map(row => row.date));
    while (cursor <= end) {
      const day = cursor.getUTCDay();
      const key = cursor.toISOString().slice(0, 10);
      if (day !== 0 && day !== 6 && !existing.has(key)) businessDates.push(key);
      cursor = new Date(cursor.getTime() + 86_400_000);
    }
  }
  const quoteRows = latestReport?.decisions ?? [];
  const staleQuotes = quoteRows.filter(item => (item.quote?.risks ?? []).some(reason => String(reason).includes('古い'))).length;
  const unusableQuotes = quoteRows.filter(item => item.quote?.valid === false).length;
  return {
    schema_version: 1,
    generated_at: new Date().toISOString(),
    config,
    series: {
      equity: rows,
      returns: returnRows.map(row => ({ date: row.date, value: row.value * 100 })),
      drawdown: drawdown.series,
    },
    overview: {
      start_date: rows[0]?.date ?? null,
      end_date: rows.at(-1)?.date ?? null,
      calendar_days: metric(calendarDays, 'ok', observations, 0),
      trading_observations: metric(observations, 'ok', observations, 0),
      initial_equity: metric(initialCapital, initialCapital ? 'ok' : 'no_data', observations, 0),
      current_equity: metric(currentEquity, currentEquity ? 'ok' : 'no_data', observations, 0),
      total_pnl: metric(currentEquity - initialCapital, 'ok', observations, 1),
      total_return_pct: metric(totalReturn === null ? null : totalReturn * 100, 'ok', observations, 1),
      daily_return_pct: metric(returns.length ? returns.at(-1) * 100 : 0, returns.length ? 'ok' : 'opening_day', observations, 1),
      mtd_return_pct: starts ? periodReturn(rows, starts.mtd, initialCapital) : metric(null, 'no_data'),
      qtd_return_pct: starts ? periodReturn(rows, starts.qtd, initialCapital) : metric(null, 'no_data'),
      ytd_return_pct: starts ? periodReturn(rows, starts.ytd, initialCapital) : metric(null, 'no_data'),
      cagr_pct: gated(cagr === null ? null : cagr * 100, observations, config.minimumCagrObservations),
    },
    risk: {
      daily_volatility_pct: gated(volatilityDaily === null ? null : volatilityDaily * 100, observations, config.minimumVolatilityObservations),
      annualized_volatility_pct: gated(volatilityAnnual === null ? null : volatilityAnnual * 100, observations, config.minimumVolatilityObservations),
      downside_deviation_pct: gated(downsideDeviation === null ? null : downsideDeviation * 100, observations, config.minimumRiskAdjustedObservations),
      maximum_drawdown_pct: drawdown.maximum_pct,
      maximum_drawdown_amount: drawdown.maximum_amount,
      current_drawdown_pct: drawdown.current_pct,
      drawdown_peak_date: drawdown.peak_date,
      drawdown_trough_date: drawdown.trough_date,
      drawdown_recovery_date: drawdown.recovery_date,
      maximum_drawdown_duration: drawdown.maximum_duration_days,
      current_underwater_duration: drawdown.current_underwater_days,
      ulcer_index: gated(ulcer, observations, config.minimumVolatilityObservations),
      recovery_factor: Math.abs(drawdown.maximum_pct.value ?? 0) > EPSILON
        ? metric(recovery, 'ok', observations, 1)
        : metric(null, 'no_drawdown', observations, 1),
      var_95_pct: risk95.var,
      cvar_95_pct: risk95.cvar,
      var_99_pct: risk99.var,
      cvar_99_pct: risk99.cvar,
      skewness: moments.skewness,
      excess_kurtosis: moments.excess_kurtosis,
      best_day_pct: returns.length ? metric(Math.max(...returns) * 100, 'ok', observations, 1) : metric(null, 'no_returns'),
      worst_day_pct: returns.length ? metric(Math.min(...returns) * 100, 'ok', observations, 1) : metric(null, 'no_returns'),
      positive_days: metric(positives.length, 'ok', observations, 1),
      negative_days: metric(negatives.length, 'ok', observations, 1),
      flat_days: metric(flats.length, 'ok', observations, 1),
    },
    risk_adjusted: {
      sharpe_ratio: gated(sharpe, observations, config.minimumRiskAdjustedObservations, { annual_risk_free_rate: config.annualRiskFreeRate }),
      sortino_ratio: gated(sortino, observations, config.minimumRiskAdjustedObservations, { annual_risk_free_rate: config.annualRiskFreeRate }),
      calmar_ratio: gated(calmar, observations, config.minimumCagrObservations),
    },
    trades: tradeStats,
    positions: positionStats,
    benchmark: alignedBenchmarkMetrics(rows, benchmark, config),
    data_quality: {
      duplicate_dates: normalized.duplicates,
      missing_business_dates: businessDates,
      stale_quote_count: staleQuotes,
      unusable_quote_count: unusableQuotes,
      equity_observations: rows.length,
      return_observations: observations,
      source: latestReport?.quote_source ?? null,
    },
  };
}

export const PERFORMANCE_GLOSSARY = Object.freeze({
  sharpe_ratio: { label:'シャープレシオ', formula:'年率超過リターン ÷ 年率標準偏差', interpretation:'高いほど、取った総リスクに対する収益効率が高い。' },
  sortino_ratio: { label:'ソルティノレシオ', formula:'年率超過リターン ÷ 下方偏差', interpretation:'下落側の変動だけをリスクとして評価。高いほど良い。' },
  calmar_ratio: { label:'カルマーレシオ', formula:'CAGR ÷ |最大ドローダウン|', interpretation:'最大下落に対する長期収益効率。高いほど良い。' },
  maximum_drawdown_pct: { label:'最大ドローダウン', formula:'ピーク後の最小値 ÷ ピーク − 1', interpretation:'過去最大の資産下落率。0に近いほど下落が小さい。' },
  risk_reward_ratio: { label:'リスクリワード', formula:'平均利益率 ÷ |平均損失率|', interpretation:'平均的な損失1に対して得た平均利益。1超が一つの目安だが勝率と併読する。' },
  profit_factor: { label:'プロフィットファクター', formula:'総利益 ÷ |総損失|', interpretation:'1超なら総利益が総損失を上回る。取引数が少ない時は不安定。' },
  var_95_pct: { label:'VaR 95%', formula:'日次損失分布の下位5%点', interpretation:'通常95%の範囲で超えないと推定する一日損失。過去分布依存。' },
  cvar_95_pct: { label:'CVaR 95%', formula:'VaR 95%を超えた損失の平均', interpretation:'極端な下落時の平均損失。低いほど良い。' },
  beta: { label:'ベータ', formula:'Cov(運用, ベンチマーク) ÷ Var(ベンチマーク)', interpretation:'市場変動への感応度。1は市場並み。' },
  alpha_pct: { label:'アルファ', formula:'運用超過収益 − β×市場超過収益', interpretation:'市場感応度で説明されない年率超過収益。' },
  information_ratio: { label:'インフォメーションレシオ', formula:'年率アクティブ収益 ÷ トラッキングエラー', interpretation:'ベンチマークから外れたリスクに対する超過収益。' },
});
