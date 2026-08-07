export const finite = value => {
  if (value === null || value === undefined || value === '') return null;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
};

export function filterSeriesByPeriod(rows, period, now = new Date()) {
  if (!Array.isArray(rows) || period === 'all') return rows ?? [];
  const days = ({'1m':31,'3m':93,'6m':186,'1y':366})[period];
  if (!days) return rows;
  const cutoff = new Date(now.getTime() - days * 86400000);
  return rows.filter(row => {
    const date = new Date(row.date);
    return !Number.isNaN(date.getTime()) && date >= cutoff;
  });
}

export function appendLiveEquity(rows, quotePayload, entryBasis) {
  const result = Array.isArray(rows) ? structuredClone(rows) : [];
  const current = finite(quotePayload?.portfolio?.total_current_value);
  if (current === null) return result;
  const generated = quotePayload.generated_at ? new Date(quotePayload.generated_at) : new Date();
  const label = generated.toISOString();
  const rawCumulative = entryBasis ? (current / entryBasis - 1) * 100 : null;
  const cumulative = rawCumulative === null ? null : Math.round(rawCumulative * 1_000_000) / 1_000_000;
  result.push({ date: label, label:'現在', equity:current, total_pnl:entryBasis ? current-entryBasis : null, cumulative_return_pct:cumulative, live:true });
  return result;
}

export function metricState(metric) {
  if (!metric) return { value:null, status:'unavailable', note:'未計算' };
  return { value:finite(metric.value), status:metric.status ?? 'ok', note:metric.note ?? null };
}

export function contributionRows(metrics, quotePayload) {
  const live = new Map((quotePayload?.positions ?? []).map(position => [String(position.code), position]));
  const base = metrics?.series?.contributions ?? [];
  return base.map(row => {
    const current = live.get(String(row.code));
    const pnl = finite(current?.unrealized_pnl) ?? finite(row.pnl) ?? 0;
    const returnPct = finite(current?.return_pct) ?? finite(row.return_pct);
    return { ...row, pnl, return_pct:returnPct, current_price:finite(current?.current_price), quote_time:current?.quote_time ?? null, live:Boolean(current) };
  }).sort((a,b) => Math.abs(b.pnl) - Math.abs(a.pnl));
}

export function chartBounds(values, includeZero = false) {
  const finiteValues = values.map(finite).filter(value => value !== null);
  if (!finiteValues.length) return { min:0, max:1 };
  let min = Math.min(...finiteValues);
  let max = Math.max(...finiteValues);
  if (includeZero) { min = Math.min(0,min); max = Math.max(0,max); }
  if (min === max) { const pad = Math.abs(min || 1) * .05; min -= pad; max += pad; }
  return { min, max };
}
