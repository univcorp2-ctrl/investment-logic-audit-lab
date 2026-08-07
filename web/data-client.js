import {
  buildSavedQuotePayload,
  deriveCompactQuotePayload,
  isForcedQuoteRefresh,
  normalizeDataUrl,
  portfolioStatusText,
  requestKind,
} from './data-client-core.js';

const nativeFetch = window.fetch.bind(window);
const responseCache = new Map();
const inFlight = new Map();
const subscribers = new Set();
const STATIC_TTL_MS = 60_000;
const QUOTE_TTL_MS = 55_000;
const NETWORK_TIMEOUT_MS = 8_000;
let fallbackBundlePromise = null;
let liveQuotePromise = null;
let liveFull = null;
let liveCompact = null;
let liveExpiresAt = 0;

function snapshotToResponse(snapshot, extraHeaders = {}) {
  const headers = new Headers(snapshot.headers);
  for (const [key, value] of Object.entries(extraHeaders)) headers.set(key, value);
  return new Response(snapshot.body.slice(0), {
    status: snapshot.status,
    statusText: snapshot.statusText,
    headers,
  });
}

async function responseSnapshot(response) {
  return {
    body: await response.arrayBuffer(),
    status: response.status,
    statusText: response.statusText,
    headers: [...response.headers.entries()],
  };
}

function timeoutSignal(timeoutMs, upstreamSignal) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(new DOMException('Request timed out', 'TimeoutError')), timeoutMs);
  if (upstreamSignal) {
    if (upstreamSignal.aborted) controller.abort(upstreamSignal.reason);
    else upstreamSignal.addEventListener('abort', () => controller.abort(upstreamSignal.reason), { once: true });
  }
  return { signal: controller.signal, clear: () => clearTimeout(timer) };
}

async function cachedNetworkFetch(url, init = {}, ttlMs = STATIC_TTL_MS, timeoutMs = NETWORK_TIMEOUT_MS) {
  const key = `${String(init.method ?? 'GET').toUpperCase()} ${url}`;
  const cached = responseCache.get(key);
  if (cached && cached.expiresAt > Date.now()) return snapshotToResponse(cached.snapshot, { 'X-ValueScope-Cache': 'memory' });
  if (inFlight.has(key)) return snapshotToResponse(await inFlight.get(key), { 'X-ValueScope-Cache': 'deduplicated' });
  const request = (async () => {
    const timed = timeoutSignal(timeoutMs, init.signal);
    try {
      const response = await nativeFetch(url, { ...init, signal: timed.signal, cache: 'no-cache' });
      const snapshot = await responseSnapshot(response);
      if (response.ok) responseCache.set(key, { snapshot, expiresAt: Date.now() + ttlMs });
      return snapshot;
    } catch (error) {
      if (cached) return cached.snapshot;
      throw error;
    } finally {
      timed.clear();
      inFlight.delete(key);
    }
  })();
  inFlight.set(key, request);
  return snapshotToResponse(await request, { 'X-ValueScope-Cache': 'network' });
}

async function jsonFromStatic(path, fallback) {
  try {
    const response = await cachedNetworkFetch(new URL(path, location.href).toString(), { headers: { Accept: 'application/json' } });
    if (!response.ok) return fallback;
    return await response.json();
  } catch {
    return fallback;
  }
}

async function fallbackBundle() {
  if (!fallbackBundlePromise) {
    fallbackBundlePromise = Promise.all([
      jsonFromStatic('./data/paper-trading/latest-report.json', {}),
      jsonFromStatic('./demo-portfolio.json', { positions: [] }),
    ]).then(([report, demo]) => ({ report, demo }));
  }
  return fallbackBundlePromise;
}

function notifyQuotes(payload) {
  for (const subscriber of subscribers) {
    try { subscriber(payload); } catch { /* isolate subscribers */ }
  }
  window.dispatchEvent(new CustomEvent('valuescope:quotes', { detail: payload }));
}

async function fetchLiveQuotes(force = false) {
  if (!force && liveFull && liveExpiresAt > Date.now()) return liveFull;
  if (liveQuotePromise) return liveQuotePromise;
  liveQuotePromise = (async () => {
    const timed = timeoutSignal(NETWORK_TIMEOUT_MS);
    try {
      const path = force ? '/api/quotes?force=1' : '/api/quotes';
      const response = await nativeFetch(path, { signal: timed.signal, headers: { Accept: 'application/json' }, cache: 'no-cache' });
      if (!response.ok) throw new Error(`quotes HTTP ${response.status}`);
      const payload = await response.json();
      liveFull = payload;
      liveCompact = deriveCompactQuotePayload(payload);
      liveExpiresAt = Date.now() + QUOTE_TTL_MS;
      notifyQuotes(payload);
      return payload;
    } finally {
      timed.clear();
      liveQuotePromise = null;
    }
  })();
  return liveQuotePromise;
}

function backgroundLiveRefresh() {
  const schedule = window.requestIdleCallback ?? (callback => setTimeout(callback, 250));
  schedule(() => { fetchLiveQuotes(false).catch(() => {}); }, { timeout: 1500 });
}

async function quoteResponse(url, force) {
  const compact = url.searchParams.get('compact') === '1';
  if (force) {
    try {
      const full = await fetchLiveQuotes(true);
      return Response.json(compact ? deriveCompactQuotePayload(full) : full, { headers: { 'X-ValueScope-Data': 'live' } });
    } catch { /* saved fallback below */ }
  }
  if (liveFull && liveExpiresAt > Date.now()) {
    return Response.json(compact ? liveCompact : liveFull, { headers: { 'X-ValueScope-Data': 'live-cache' } });
  }
  const { report, demo } = await fallbackBundle();
  const fallback = buildSavedQuotePayload(report, demo, compact);
  backgroundLiveRefresh();
  return Response.json(fallback, { headers: { 'X-ValueScope-Data': 'saved-fallback', 'Cache-Control': 'no-store' } });
}

async function portfolioStatusResponse(url) {
  const { report, demo } = await fallbackBundle();
  const compact = liveCompact && liveExpiresAt > Date.now()
    ? liveCompact
    : buildSavedQuotePayload(report, demo, true);
  const offset = Math.max(0, Number.parseInt(url.searchParams.get('offset') ?? '0', 10) || 0);
  const limit = Math.min(10, Math.max(1, Number.parseInt(url.searchParams.get('limit') ?? '10', 10) || 10));
  backgroundLiveRefresh();
  return new Response(portfolioStatusText(compact, offset, limit), {
    headers: { 'Content-Type': 'text/plain; charset=utf-8', 'X-ValueScope-Data': liveCompact ? 'live-cache' : 'saved-fallback' },
  });
}

async function patchedFetch(input, init = {}) {
  const method = String(init.method ?? (input instanceof Request ? input.method : 'GET')).toUpperCase();
  if (method !== 'GET') return nativeFetch(input, init);
  const original = new URL(typeof input === 'string' ? input : input.url, location.href);
  if (original.origin !== location.origin) return nativeFetch(input, init);
  const kind = requestKind(original, location.href);
  if (kind === 'quotes') return quoteResponse(original, isForcedQuoteRefresh(original, location.href));
  if (kind === 'portfolio-status') return portfolioStatusResponse(original);
  if (kind === 'static-json') {
    const normalized = normalizeDataUrl(original, location.href);
    return cachedNetworkFetch(normalized, init, STATIC_TTL_MS);
  }
  return nativeFetch(input, init);
}

function installCoalescedMutationObserver() {
  if (window.__valuescopeMutationObserverInstalled || !window.MutationObserver) return;
  const NativeObserver = window.MutationObserver;
  window.MutationObserver = class CoalescedMutationObserver {
    constructor(callback) {
      let queued = false;
      let buffered = [];
      this.native = new NativeObserver((records, observer) => {
        buffered.push(...records);
        if (queued) return;
        queued = true;
        requestAnimationFrame(() => {
          queued = false;
          const batch = buffered;
          buffered = [];
          callback(batch, observer);
        });
      });
    }
    observe(target, options) { return this.native.observe(target, options); }
    disconnect() { return this.native.disconnect(); }
    takeRecords() { return this.native.takeRecords(); }
  };
  window.__valuescopeMutationObserverInstalled = true;
}

window.fetch = patchedFetch;
installCoalescedMutationObserver();
window.ValueScopeData = Object.freeze({
  getRanking: () => jsonFromStatic('./jquants-ranking.json', { rows: [], metadata: {} }),
  getDailyReport: () => jsonFromStatic('./data/paper-trading/latest-report.json', null),
  getPerformanceMetrics: () => jsonFromStatic('./data/paper-trading/performance-metrics.json', null),
  getDiagnostics: () => jsonFromStatic('./data/paper-trading/drawdown-diagnostics.json', null),
  getDemoPortfolio: () => jsonFromStatic('./demo-portfolio.json', { positions: [] }),
  getQuotes: async (compact = true) => {
    if (liveFull && liveExpiresAt > Date.now()) return compact ? liveCompact : liveFull;
    const { report, demo } = await fallbackBundle();
    backgroundLiveRefresh();
    return buildSavedQuotePayload(report, demo, compact);
  },
  refreshQuotes: async (compact = true) => {
    const full = await fetchLiveQuotes(true);
    return compact ? deriveCompactQuotePayload(full) : full;
  },
  subscribeQuotes(callback) {
    subscribers.add(callback);
    return () => subscribers.delete(callback);
  },
});

fallbackBundle().catch(() => {});
