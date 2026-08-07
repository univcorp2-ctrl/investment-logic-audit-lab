export function normalizeRequestKey(input, origin = 'https://valuescope.local') {
  const url = new URL(String(input), origin);
  const pathname = url.pathname;
  if (pathname === '/api/quotes' || pathname === '/api/portfolio-status') return `${url.origin}/api/quotes?compact=1`;
  if (pathname.endsWith('.json')) return `${url.origin}${pathname}`;
  const params = [...url.searchParams.entries()]
    .filter(([key]) => !['ts', 'refresh', '_'].includes(key))
    .sort(([left], [right]) => left.localeCompare(right));
  url.search = '';
  for (const [key, value] of params) url.searchParams.append(key, value);
  return url.toString();
}

export function staleAgeSeconds(generatedAt, now = Date.now()) {
  const timestamp = Date.parse(String(generatedAt ?? ''));
  if (!Number.isFinite(timestamp)) return null;
  return Math.max(0, Math.floor((now - timestamp) / 1000));
}

export function portfolioStatusText(payload, offset = 0, limit = 10) {
  const portfolio = payload?.portfolio ?? {};
  const positions = (payload?.positions ?? payload?.quotes ?? []).slice(offset, offset + limit);
  const lines = [
    `generated_at\t${payload?.generated_at ?? ''}`,
    `total\t${portfolio.total_entry_value ?? ''}\t${portfolio.total_current_value ?? ''}\t${portfolio.total_unrealized_pnl ?? ''}\t${portfolio.total_return_pct ?? ''}\t${portfolio.winners ?? ''}\t${portfolio.losers ?? ''}\t${portfolio.unchanged ?? ''}\t${portfolio.usable_quotes ?? ''}\t${portfolio.double_checked ?? ''}`,
    `range\t${offset}\t${offset + positions.length}`,
    'code\tname\tentry\tcurrent\tpnl\treturn_pct\tverification\tusable\tquote_time\tmax_diff_pct',
    ...positions.map(position => [position.code, position.name ?? position.company_name, position.entry_price, position.current_price, position.unrealized_pnl, position.return_pct, position.verification, position.usable, position.quote_time, position.max_difference_pct].map(value => value ?? '').join('\t')),
  ];
  return `${lines.join('\n')}\n`;
}

export function summaryFromStatic(report, metrics) {
  const summary = report?.summary ?? {};
  return {
    totalPnl: Number.isFinite(Number(summary.total_pnl)) ? Number(summary.total_pnl) : null,
    totalReturnPct: Number.isFinite(Number(summary.cumulative_return_pct)) ? Number(summary.cumulative_return_pct) : null,
    unrealizedPnl: Number.isFinite(Number(summary.unrealized_pnl)) ? Number(summary.unrealized_pnl) : null,
    currentDrawdownPct: Number.isFinite(Number(metrics?.risk?.current_drawdown_pct?.value)) ? Number(metrics.risk.current_drawdown_pct.value) : Number.isFinite(Number(summary.max_drawdown_pct)) ? Number(summary.max_drawdown_pct) : null,
    plan: report?.fundamental_source?.plan?.name ?? report?.fundamental_source?.plan ?? 'Free',
    cutoff: report?.fundamental_source?.effective_data_cutoff ?? null,
    generatedAt: report?.generated_at ?? metrics?.generated_at ?? null,
  };
}
