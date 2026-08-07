import {
  canonicalUrl,
  isStaticJson,
  normalizeQuotePayload,
  portfolioStatusText,
  responseFromRecord,
  responseRecord,
} from './fetch-coordinator-core.js';
import { buildSavedQuotePayload } from './data-client-core.js';

if (!window.__valuescopeFetchCoordinatorInstalled) {
  window.__valuescopeFetchCoordinatorInstalled = true;
  const originalFetch = window.fetch.bind(window);
  const inflight = new Map();
  const memory = new Map();
  const staticTtlMs = 5 * 60 * 1000;
  const quoteTtlMs = 55 * 1000;
  const savedQuoteTtlMs = 10 * 1000;
  const quoteStorageKey = 'valuescope-last-quotes-v3';
  let quoteValue = null;
  let quoteExpiresAt = 0;
  let quoteInflight = null;
  let savedQuotePromise = null;

  function storageKey(url) {
    return `valuescope-json:${url.pathname}${url.search}`;
  }

  function readStoredJson(key) {
    try {
      const parsed = JSON.parse(sessionStorage.getItem(key) ?? 'null');
      return parsed?.payload ?? null;
    } catch {
      return null;
    }
  }

  function storeJson(key, payload) {
    try {
      const text = JSON.stringify({ stored_at:Date.now(), payload });
      if (text.length < 1_500_000) sessionStorage.setItem(key, text);
    } catch {
      // Storage is optional.
    }
  }

  async function fetchWithTimeout(url, init = {}, timeoutMs = 12000) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort('timeout'), timeoutMs);
    const callerSignal = init.signal;
    const abortFromCaller = () => controller.abort(callerSignal?.reason ?? 'caller-abort');
    if (callerSignal) callerSignal.addEventListener('abort', abortFromCaller, { once:true });
    try {
      return await originalFetch(url, { ...init, signal:controller.signal });
    } finally {
      clearTimeout(timer);
      if (callerSignal) callerSignal.removeEventListener('abort', abortFromCaller);
    }
  }

  async function getStatic(url, init = {}) {
    const key = url.toString();
    const cached = memory.get(key);
    if (cached && cached.expiresAt > Date.now()) return responseFromRecord(cached, { 'X-Valuescope-Cache':'MEMORY' });
    if (inflight.has(key)) return responseFromRecord(await inflight.get(key), { 'X-Valuescope-Cache':'INFLIGHT' });
    const task = (async () => {
      try {
        const response = await fetchWithTimeout(url, { ...init, cache:'default' });
        if (!response.ok) throw new Error(`HTTP ${response.status}`);
        const body = await response.arrayBuffer();
        const record = responseRecord(body, response, Date.now() + staticTtlMs);
        memory.set(key, record);
        try { storeJson(storageKey(url), JSON.parse(new TextDecoder().decode(body))); } catch { /* valid JSON only */ }
        return record;
      } catch (error) {
        const fallback = readStoredJson(storageKey(url));
        if (!fallback) throw error;
        const body = new TextEncoder().encode(JSON.stringify({ ...fallback, _stale:true, _load_error:String(error?.message ?? error) })).buffer;
        return responseRecord(body, new Response(body, { headers:{'Content-Type':'application/json; charset=utf-8'} }), Date.now() + savedQuoteTtlMs);
      } finally {
        inflight.delete(key);
      }
    })();
    inflight.set(key, task);
    return responseFromRecord(await task, { 'X-Valuescope-Cache':'MISS' });
  }

  function readStoredQuotes() {
    try {
      const parsed = JSON.parse(sessionStorage.getItem(quoteStorageKey) ?? 'null');
      return parsed?.payload ? normalizeQuotePayload(parsed.payload) : null;
    } catch {
      return null;
    }
  }

  function storeQuotes(payload) {
    try { sessionStorage.setItem(quoteStorageKey, JSON.stringify({ stored_at:Date.now(), payload })); }
    catch { /* optional fallback */ }
  }

  function publishQuotes(payload) {
    window.dispatchEvent(new CustomEvent('valuescope:quotes', { detail:payload }));
  }

  async function getSavedQuotes() {
    if (!savedQuotePromise) {
      savedQuotePromise = Promise.all([
        getStatic(canonicalUrl('/data/paper-trading/latest-report.json', location.href)).then(response => response.json()),
        getStatic(canonicalUrl('/demo-portfolio.json', location.href)).then(response => response.json()),
      ]).then(([report, demo]) => normalizeQuotePayload({
        ...buildSavedQuotePayload(report, demo, true),
        _saved_snapshot:true,
      }));
    }
    return savedQuotePromise;
  }

  async function refreshLiveQuotes() {
    if (quoteInflight) return quoteInflight;
    quoteInflight = (async () => {
      try {
        const response = await fetchWithTimeout('/api/quotes?compact=1', { cache:'default' }, 12000);
        if (!response.ok) throw new Error(`HTTP ${response.status}`);
        const payload = normalizeQuotePayload(await response.json());
        quoteValue = payload;
        quoteExpiresAt = Date.now() + quoteTtlMs;
        storeQuotes(payload);
        publishQuotes(payload);
        return payload;
      } catch (error) {
        const fallback = quoteValue ?? readStoredQuotes() ?? await getSavedQuotes().catch(() => null);
        if (!fallback) throw error;
        const stale = normalizeQuotePayload({ ...fallback, _stale:true, _saved_snapshot:Boolean(fallback._saved_snapshot), _load_error:String(error?.message ?? error) });
        quoteValue = stale;
        quoteExpiresAt = Date.now() + savedQuoteTtlMs;
        publishQuotes(stale);
        return stale;
      } finally {
        quoteInflight = null;
      }
    })();
    return quoteInflight;
  }

  async function getSharedQuotes({ force = false } = {}) {
    if (force) return refreshLiveQuotes();
    if (quoteValue && quoteExpiresAt > Date.now()) return quoteValue;
    const saved = await getSavedQuotes().catch(() => readStoredQuotes());
    if (saved) {
      quoteValue = normalizeQuotePayload({ ...saved, _saved_snapshot:true });
      quoteExpiresAt = Date.now() + savedQuoteTtlMs;
      publishQuotes(quoteValue);
      refreshLiveQuotes().catch(() => {});
      return quoteValue;
    }
    return refreshLiveQuotes();
  }

  window.valuescopeData = Object.freeze({
    getQuotes: options => getSharedQuotes(options),
    peekQuotes: () => quoteValue,
    clearQuotes: () => { quoteValue = null; quoteExpiresAt = 0; },
  });

  window.fetch = async (input, init = {}) => {
    const method = String(init.method ?? (input instanceof Request ? input.method : 'GET')).toUpperCase();
    if (method !== 'GET') return originalFetch(input, init);
    const url = canonicalUrl(input, location.href);
    if (url.origin !== location.origin) return originalFetch(input, init);
    if (url.pathname === '/api/quotes') {
      const requestedUrl = new URL(typeof input === 'string' ? input : input.url, location.href);
      const force = requestedUrl.searchParams.has('refresh') || requestedUrl.searchParams.get('force') === '1';
      const payload = await getSharedQuotes({ force });
      const originalPath = new URL(typeof input === 'string' ? input : input.url, location.href).pathname;
      if (originalPath === '/api/portfolio-status') {
        const text = portfolioStatusText(payload, requestedUrl.searchParams.get('offset'), requestedUrl.searchParams.get('limit'));
        return new Response(text, { headers:{'Content-Type':'text/plain; charset=utf-8','X-Valuescope-Shared':payload._saved_snapshot ? 'saved' : 'quotes'} });
      }
      return Response.json(payload, { headers:{'Cache-Control':'private, max-age=55','X-Valuescope-Shared':payload._saved_snapshot ? 'saved' : 'quotes'} });
    }
    if (isStaticJson(url, location.origin)) return getStatic(url, init);
    return originalFetch(input, init);
  };
}
