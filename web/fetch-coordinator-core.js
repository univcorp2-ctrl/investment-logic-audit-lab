const TRANSIENT_PARAMS = new Set(['ts','refresh','final','verify','summary','count','cacheBust','adaptive','_']);

export function canonicalUrl(input, base = 'https://valuescope.invalid/') {
  const url = new URL(typeof input === 'string' ? input : input.url, base);
  for (const key of [...url.searchParams.keys()]) {
    if (TRANSIENT_PARAMS.has(key)) url.searchParams.delete(key);
  }
  if (url.pathname === '/api/quotes' || url.pathname === '/api/portfolio-status') {
    url.pathname = '/api/quotes';
    url.search = '';
    url.searchParams.set('compact', '1');
  }
  const sorted = [...url.searchParams.entries()].sort(([a],[b]) => a.localeCompare(b));
  url.search = '';
  for (const [key, value] of sorted) url.searchParams.append(key, value);
  return url;
}

export function isStaticJson(url, origin = url.origin) {
  return url.origin === origin && url.pathname.endsWith('.json');
}

export function normalizeQuotePayload(payload = {}) {
  const source = Array.isArray(payload.positions) ? payload.positions : Array.isArray(payload.quotes) ? payload.quotes : [];
  const positions = source.map(item => ({ ...item }));
  const quotes = positions.map(item => ({
    ...item,
    symbol: item.symbol,
    code: item.code,
    name: item.name ?? item.company_name,
    current_price: item.current_price,
    quote_time: item.quote_time,
    usable: item.usable !== false,
    verification: item.verification ?? 'unknown',
    primary_source: item.primary_source ?? null,
    secondary_source: item.secondary_source ?? null,
    secondary_price: item.secondary_price ?? null,
    max_difference_pct: item.max_difference_pct ?? null,
  }));
  return { ...payload, positions, quotes };
}

export function portfolioStatusText(payload = {}, offset = 0, limit = 10) {
  const normalized = normalizeQuotePayload(payload);
  const portfolio = normalized.portfolio ?? {};
  const start = Math.max(0, Number(offset) || 0);
  const size = Math.min(10, Math.max(1, Number(limit) || 10));
  const positions = normalized.positions.slice(start, start + size);
  const lines = [
    `generated_at\t${normalized.generated_at ?? ''}`,
    `total\t${portfolio.total_entry_value ?? ''}\t${portfolio.total_current_value ?? ''}\t${portfolio.total_unrealized_pnl ?? ''}\t${portfolio.total_return_pct ?? ''}\t${portfolio.winners ?? ''}\t${portfolio.losers ?? ''}\t${portfolio.unchanged ?? ''}\t${portfolio.usable_quotes ?? ''}\t${portfolio.double_checked ?? ''}`,
    `range\t${start}\t${start + positions.length}`,
    'code\tname\tentry\tcurrent\tpnl\treturn_pct\tverification\tusable\tquote_time\tmax_diff_pct',
    ...positions.map(position => [
      position.code,
      position.name ?? position.company_name,
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

export function responseRecord(body, response, expiresAt) {
  return {
    body,
    status: response.status,
    statusText: response.statusText,
    headers: [...response.headers.entries()],
    expiresAt,
  };
}

export function responseFromRecord(record, extraHeaders = {}) {
  const headers = new Headers(record.headers ?? []);
  for (const [key, value] of Object.entries(extraHeaders)) headers.set(key, String(value));
  return new Response(record.body.slice(0), {
    status: record.status ?? 200,
    statusText: record.statusText ?? 'OK',
    headers,
  });
}
