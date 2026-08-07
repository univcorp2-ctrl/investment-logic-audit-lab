const TRANSIENT_PARAMS = new Set(['ts', 'refresh', 'cacheBust', '_']);

export function normalizeDataUrl(input, base = 'https://valuescope.local/') {
  const url = new URL(typeof input === 'string' ? input : input.url, base);
  for (const key of [...url.searchParams.keys()]) {
    if (TRANSIENT_PARAMS.has(key)) url.searchParams.delete(key);
  }
  const entries = [...url.searchParams.entries()].sort(([ak,av],[bk,bv]) => ak.localeCompare(bk) || av.localeCompare(bv));
  url.search = '';
  for (const [key, value] of entries) url.searchParams.append(key, value);
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
