(() => {
  const nativeFetch = window.fetch.bind(window);
  const inflight = new Map();
  const memory = new Map();
  const LAST_QUOTE_KEY = 'valuescope-last-compact-quote-v2';
  const STATIC_TTL = 30000;
  const QUOTE_TIMEOUT = 4000;

  const normalize = input => {
    const url = new URL(typeof input === 'string' ? input : input.url, location.href);
    if (url.pathname === '/api/quotes' || url.pathname === '/api/portfolio-status') return `${url.origin}/api/quotes?compact=1`;
    if (url.pathname.endsWith('.json')) return `${url.origin}${url.pathname}`;
    url.searchParams.delete('ts');
    url.searchParams.delete('refresh');
    url.searchParams.delete('_');
    return url.toString();
  };

  const withTimeout = async (url, init = {}, timeoutMs = 4000) => {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(new DOMException('Timeout', 'TimeoutError')), timeoutMs);
    try { return await nativeFetch(url, { ...init, signal: controller.signal }); }
    finally { clearTimeout(timer); }
  };

  const cloneResponse = cached => new Response(cached.body, { status: cached.status, statusText: cached.statusText, headers: cached.headers });

  const readCachedQuote = () => {
    try {
      const value = JSON.parse(sessionStorage.getItem(LAST_QUOTE_KEY) ?? 'null');
      if (!value?.payload) return null;
      return { ...value.payload, fallback: true, stale_age_seconds: Math.max(0, Math.floor((Date.now() - Number(value.saved_at || 0)) / 1000)) };
    } catch { return null; }
  };

  const saveQuote = payload => {
    try { sessionStorage.setItem(LAST_QUOTE_KEY, JSON.stringify({ saved_at: Date.now(), payload })); } catch { /* optional storage */ }
  };

  const fetchPayload = async (key, init, timeoutMs, cacheMs) => {
    const cached = memory.get(key);
    if (cached && Date.now() - cached.savedAt < cacheMs) return cached.payload;
    if (inflight.has(key)) return inflight.get(key);
    const promise = (async () => {
      const response = await withTimeout(key, { ...init, cache: 'no-cache', headers: { Accept: 'application/json', ...(init?.headers ?? {}) } }, timeoutMs);
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      const payload = await response.json();
      memory.set(key, { savedAt: Date.now(), payload });
      return payload;
    })().finally(() => inflight.delete(key));
    inflight.set(key, promise);
    return promise;
  };

  const sharedFetch = async (input, init = {}) => {
    const requestUrl = new URL(typeof input === 'string' ? input : input.url, location.href);
    const isQuote = requestUrl.pathname === '/api/quotes';
    const isPortfolio = requestUrl.pathname === '/api/portfolio-status';
    const isStaticJson = requestUrl.origin === location.origin && requestUrl.pathname.endsWith('.json');
    if (!isQuote && !isPortfolio && !isStaticJson) return nativeFetch(input, init);

    if (isQuote || isPortfolio) {
      let payload;
      try {
        payload = await fetchPayload(`${location.origin}/api/quotes?compact=1`, init, QUOTE_TIMEOUT, 45000);
        saveQuote(payload);
        window.dispatchEvent(new CustomEvent('valuescope:quotes', { detail: payload }));
      } catch (error) {
        payload = readCachedQuote();
        if (!payload) throw error;
        window.dispatchEvent(new CustomEvent('valuescope:quote-fallback', { detail: payload }));
      }
      if (isPortfolio) {
        const offset = Math.max(0, Number.parseInt(requestUrl.searchParams.get('offset') ?? '0', 10) || 0);
        const limit = Math.min(10, Math.max(1, Number.parseInt(requestUrl.searchParams.get('limit') ?? '10', 10) || 10));
        const portfolio = payload.portfolio ?? {};
        const positions = (payload.positions ?? payload.quotes ?? []).slice(offset, offset + limit);
        const lines = [
          `generated_at\t${payload.generated_at ?? ''}`,
          `total\t${portfolio.total_entry_value ?? ''}\t${portfolio.total_current_value ?? ''}\t${portfolio.total_unrealized_pnl ?? ''}\t${portfolio.total_return_pct ?? ''}\t${portfolio.winners ?? ''}\t${portfolio.losers ?? ''}\t${portfolio.unchanged ?? ''}\t${portfolio.usable_quotes ?? ''}\t${portfolio.double_checked ?? ''}`,
          `range\t${offset}\t${offset + positions.length}`,
          'code\tname\tentry\tcurrent\tpnl\treturn_pct\tverification\tusable\tquote_time\tmax_diff_pct',
          ...positions.map(position => [position.code, position.name ?? position.company_name, position.entry_price, position.current_price, position.unrealized_pnl, position.return_pct, position.verification, position.usable, position.quote_time, position.max_difference_pct].map(value => value ?? '').join('\t')),
        ];
        return new Response(`${lines.join('\n')}\n`, { status: 200, headers: { 'Content-Type': 'text/plain; charset=utf-8', 'X-ValueScope-Shared': '1' } });
      }
      const bothShapes = { ...payload, quotes: payload.quotes ?? payload.positions ?? [], positions: payload.positions ?? payload.quotes ?? [] };
      return new Response(JSON.stringify(bothShapes), { status: 200, headers: { 'Content-Type': 'application/json; charset=utf-8', 'X-ValueScope-Shared': '1' } });
    }

    const key = normalize(input);
    const cached = memory.get(key);
    if (cached?.response && Date.now() - cached.savedAt < STATIC_TTL) return cloneResponse(cached.response);
    if (inflight.has(key)) return cloneResponse(await inflight.get(key));
    const promise = (async () => {
      const response = await withTimeout(key, { ...init, cache: 'no-cache' }, 3500);
      const body = await response.text();
      const responseData = { body, status: response.status, statusText: response.statusText, headers: [...response.headers.entries()] };
      if (response.ok) memory.set(key, { savedAt: Date.now(), response: responseData });
      return responseData;
    })().finally(() => inflight.delete(key));
    inflight.set(key, promise);
    return cloneResponse(await promise);
  };

  window.fetch = sharedFetch;
  window.ValueScopeData = {
    fetchJson: async (path, options = {}) => {
      const response = await sharedFetch(path, options);
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      return response.json();
    },
    idle: callback => ('requestIdleCallback' in window ? requestIdleCallback(callback, { timeout: 1000 }) : setTimeout(callback, 0)),
    lastQuote: readCachedQuote,
    inflightCount: () => inflight.size,
  };

  const money = value => Number.isFinite(Number(value)) ? new Intl.NumberFormat('ja-JP', { style: 'currency', currency: 'JPY', maximumFractionDigits: 0 }).format(Number(value)) : '–';
  const percent = value => Number.isFinite(Number(value)) ? `${Number(value) >= 0 ? '+' : ''}${Number(value).toFixed(2)}%` : '–';
  const signed = value => `${Number(value) >= 0 ? '+' : ''}${money(value)}`;

  const applyStaticSummary = summary => {
    const apply = () => {
      const total = document.querySelector('#uxTotalPnl');
      if (!total) return false;
      total.textContent = summary.totalPnl === null ? '–' : signed(summary.totalPnl);
      document.querySelector('#uxTotalReturn').textContent = percent(summary.totalReturnPct);
      document.querySelector('#uxUnrealizedPnl').textContent = summary.unrealizedPnl === null ? '–' : signed(summary.unrealizedPnl);
      document.querySelector('#uxCurrentDd').textContent = percent(summary.currentDrawdownPct);
      document.querySelector('#uxRiskState').textContent = '日次確定値';
      document.querySelector('#uxDataState').textContent = String(summary.plan ?? 'Free');
      document.querySelector('#uxFreshness').textContent = summary.cutoff ? `cutoff ${summary.cutoff}` : 'cutoff不明';
      total.className = Number(summary.totalPnl) < 0 ? 'negative' : 'positive';
      document.querySelector('#uxUnrealizedPnl').className = Number(summary.unrealizedPnl) < 0 ? 'negative' : 'positive';
      return true;
    };
    if (apply()) return;
    const observer = new MutationObserver(() => { if (apply()) observer.disconnect(); });
    observer.observe(document.documentElement, { childList: true, subtree: true });
    setTimeout(() => observer.disconnect(), 5000);
  };

  const staticFirst = () => {
    const state = { report: null, metrics: null };
    const update = () => {
      const report = state.report;
      const metrics = state.metrics;
      if (!report && !metrics) return;
      const summary = report?.summary ?? {};
      applyStaticSummary({
        totalPnl: Number.isFinite(Number(summary.total_pnl)) ? Number(summary.total_pnl) : null,
        totalReturnPct: Number.isFinite(Number(summary.cumulative_return_pct)) ? Number(summary.cumulative_return_pct) : null,
        unrealizedPnl: Number.isFinite(Number(summary.unrealized_pnl)) ? Number(summary.unrealized_pnl) : null,
        currentDrawdownPct: Number.isFinite(Number(metrics?.risk?.current_drawdown_pct?.value)) ? Number(metrics.risk.current_drawdown_pct.value) : null,
        plan: report?.fundamental_source?.plan?.name ?? report?.fundamental_source?.plan ?? 'Free',
        cutoff: report?.fundamental_source?.effective_data_cutoff ?? null,
      });
    };
    sharedFetch('./data/paper-trading/latest-report.json').then(response => response.ok ? response.json() : null).then(value => { state.report = value; update(); }).catch(() => {});
    sharedFetch('./data/paper-trading/performance-metrics.json').then(response => response.ok ? response.json() : null).then(value => { state.metrics = value; update(); }).catch(() => {});
  };

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', staticFirst, { once: true });
  else staticFirst();
})();
