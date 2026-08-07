const TRANSIENT_PARAMS = new Set(['ts', 'refresh', 'cacheBust', '_', 'adaptive', 'final', 'verify', 'summary', 'count']);

export function normalizeDataUrl(input, base = 'https://valuescope.local/') {
  const url = new URL(typeof input === 'string' ? input : input.url, base);
  for (const key of [...url.searchParams.keys()]) {
    if (TRANSIENT_PARAMS.has(key)) url.searchParams.delete(key);
  }
  const entries = [...url.searchParams.entries()].sort(([aKey, aValue], [bKey, bValue]) =>
    aKey.localeCompare(bKey) || aValue.localeCompare(bValue));
  url.search = '';
  for (const [key, value] of entries) url.searchParams.append(key, value);
  return url.toString();
}

export function normalizeRequestKey(input, base = 'https://valuescope.local/') {
  const url = new URL(normalizeDataUrl(input, base));
  if (url.pathname === '/api/quotes' || url.pathname === '/api/portfolio-status') {
    return `${url.origin}/api/quotes?compact=1`;
  }
  return url.toString();
}

export function requestKind(input, base = 'https://valuescope.local/') {
  const url = new URL(typeof input === 'string' ? input : input.url, base);
  if (url.pathname === '/api/quotes') return 'quotes';
  if (url.pathname === '/api/portfolio-status') return 'portfolio-status';
  if (url.pathname.endsWith('.json')) return 'static-json';
  return 'other';
}

export function isForcedQuoteRefresh(input, base = 'https://valuescope.local/') {
  const url = new URL(typeof input === 'string' ? input : input.url, base);
  return url.searchParams.has('refresh') || url.searchParams.get('force') === '1';
}

const numberOrNull = value => {
  if (value === null || value === undefined || value === '') return null;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
};

export function staleAgeSeconds(generatedAt, nowMs = Date.now()) {
  const timestamp = Date.parse(generatedAt);
  return Number.isFinite(timestamp) ? Math.max(0, Math.round((nowMs - timestamp) / 1000)) : null;
}

export function summaryFromStatic(report = {}, metrics = {}) {
  return {
    totalPnl: numberOrNull(report?.summary?.total_pnl),
    totalReturnPct: numberOrNull(report?.summary?.cumulative_return_pct),
    unrealizedPnl: numberOrNull(report?.summary?.unrealized_pnl),
    currentDrawdownPct: numberOrNull(metrics?.risk?.current_drawdown_pct?.value ?? report?.summary?.max_drawdown_pct),
    plan: report?.fundamental_source?.plan?.name ?? report?.fundamental_source?.plan ?? null,
    effectiveDataCutoff: report?.fundamental_source?.effective_data_cutoff ?? null,
  };
}

export function deriveCompactQuotePayload(fullPayload = {}) {
  const source = Array.isArray(fullPayload.positions)
    ? fullPayload.positions
    : Array.isArray(fullPayload.quotes) ? fullPayload.quotes : [];
  return {
    generated_at: fullPayload.generated_at ?? null,
    timezone: fullPayload.timezone ?? 'Asia/Tokyo',
    refresh_seconds: fullPayload.refresh_seconds ?? 60,
    source_policy: fullPayload.source_policy ?? {},
    source_status: fullPayload.source_status ?? {},
    partial: Boolean(fullPayload.partial),
    portfolio: fullPayload.portfolio ?? {},
    positions: source.map(quote => ({
      symbol: quote.symbol,
      code: quote.code,
      name: quote.name ?? quote.company_name,
      entry_price: quote.entry_price,
      current_price: quote.current_price,
      quote_time: quote.quote_time,
      unrealized_pnl: quote.unrealized_pnl,
      return_pct: quote.return_pct,
      verification: quote.verification,
      usable: quote.usable,
      max_difference_pct: quote.max_difference_pct,
      primary_source: quote.primary_source,
      secondary_source: quote.secondary_source,
      secondary_price: quote.secondary_price,
      errors: quote.errors ?? [],
    })),
  };
}

export function buildSavedQuotePayload(report = {}, demo = {}, compact = false) {
  const decisions = new Map();
  for (const item of report?.decisions ?? []) {
    const code = String(item.code ?? '').replace(/\.T$/i, '');
    const symbol = String(item.symbol ?? (code ? `${code}.T` : ''));
    if (code) decisions.set(code, item);
    if (symbol) decisions.set(symbol, item);
  }
  const quotes = (demo?.positions ?? []).map(position => {
    const code = String(position.code ?? position.symbol ?? '').replace(/\.T$/i, '');
    const symbol = String(position.symbol ?? `${code}.T`);
    const decision = decisions.get(symbol) ?? decisions.get(code) ?? {};
    const quantity = numberOrNull(position.quantity) ?? 100;
    const entryPrice = numberOrNull(position.entry_price) ?? numberOrNull(decision?.holding?.avg_cost) ?? 0;
    const markedPrice = numberOrNull(decision?.technical?.price);
    const quoteValid = decision?.quote?.valid !== false && markedPrice !== null;
    const currentPrice = quoteValid ? markedPrice : entryPrice;
    const entryValue = entryPrice * quantity;
    const currentValue = currentPrice * quantity;
    const pnl = currentValue - entryValue;
    return {
      symbol,
      code,
      name: position.company_name ?? decision.company_name ?? code,
      current_price: currentPrice,
      quote_time: decision?.quote?.quote_time ?? report?.generated_at ?? null,
      primary_source: '日次保存スナップショット',
      primary_source_mode: 'saved-daily-snapshot',
      secondary_source: null,
      secondary_price: null,
      max_difference_pct: numberOrNull(decision?.quote?.max_difference_pct),
      verification: decision?.quote?.verification ?? 'saved-daily-snapshot',
      usable: quoteValid,
      entry_price: entryPrice,
      quantity,
      position_value: currentValue,
      unrealized_pnl: pnl,
      return_pct: entryValue ? pnl / entryValue * 100 : 0,
      errors: quoteValid ? [] : ['live_quote_pending'],
    };
  });
  const totalEntryValue = quotes.reduce((sum, quote) => sum + quote.entry_price * quote.quantity, 0);
  const totalCurrentValue = quotes.reduce((sum, quote) => sum + quote.position_value, 0);
  const totalPnl = totalCurrentValue - totalEntryValue;
  const full = {
    generated_at: report?.generated_at ?? new Date().toISOString(),
    timezone: 'Asia/Tokyo',
    refresh_seconds: 60,
    source_policy: {
      primary: '保存済み日次レポート',
      live_enhancement: '現在値はバックグラウンドで更新',
      warning: 'ライブ取得完了までは最新の日次保存値を表示します。',
    },
    source_status: {
      mode: 'saved-fallback',
      live_pending: true,
      usable: quotes.filter(quote => quote.usable).length,
      total: quotes.length,
    },
    partial: true,
    portfolio: {
      total_entry_value: totalEntryValue,
      total_current_value: totalCurrentValue,
      total_unrealized_pnl: totalPnl,
      total_return_pct: totalEntryValue ? totalPnl / totalEntryValue * 100 : 0,
      winners: quotes.filter(quote => quote.unrealized_pnl > 0).length,
      losers: quotes.filter(quote => quote.unrealized_pnl < 0).length,
      unchanged: quotes.filter(quote => quote.unrealized_pnl === 0).length,
      usable_quotes: quotes.filter(quote => quote.usable).length,
      double_checked: quotes.filter(quote => quote.verification === 'double-checked').length,
    },
    quotes,
  };
  return compact ? deriveCompactQuotePayload(full) : full;
}

export function portfolioStatusText(payload, offset = 0, limit = 10) {
  const start = Math.max(0, Number(offset) || 0);
  const size = Math.min(10, Math.max(1, Number(limit) || 10));
  const positions = (payload?.positions ?? []).slice(start, start + size);
  const portfolio = payload?.portfolio ?? {};
  const lines = [
    `generated_at\t${payload?.generated_at ?? ''}`,
    `total\t${portfolio.total_entry_value ?? ''}\t${portfolio.total_current_value ?? ''}\t${portfolio.total_unrealized_pnl ?? ''}\t${portfolio.total_return_pct ?? ''}\t${portfolio.winners ?? ''}\t${portfolio.losers ?? ''}\t${portfolio.unchanged ?? ''}\t${portfolio.usable_quotes ?? ''}\t${portfolio.double_checked ?? ''}`,
    `range\t${start}\t${start + positions.length}`,
    'code\tname\tentry\tcurrent\tpnl\treturn_pct\tverification\tusable\tquote_time\tmax_diff_pct',
    ...positions.map(position => [
      position.code,
      position.name,
      position.entry_price,
      position.current_price,
      position.unrealized_pnl,
      position.return_pct,
      position.verification,
      position.usable,
      position.quote_time,
      position.max_difference_pct,
    ].map(value => value ?? '').join('\t')),
  ];
  return `${lines.join('\n')}\n`;
}
