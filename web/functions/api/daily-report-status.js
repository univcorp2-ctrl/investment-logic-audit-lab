export async function onRequestGet(context) {
  const source = new URL('/data/paper-trading/latest-report.json', context.request.url);
  const response = await fetch(source.toString(), { headers: { Accept: 'application/json' } });
  if (!response.ok) {
    return new Response(`report_error\t${response.status}\n`, {
      status: 502,
      headers: { 'Content-Type': 'text/plain; charset=utf-8' },
    });
  }
  const report = await response.json();
  const counts = { SIM_BUY: 0, SIM_HOLD: 0, SIM_SELL: 0, WATCH: 0, NO_DATA: 0 };
  let executionAllowed = 0;
  const decisions = Array.isArray(report.decisions) ? report.decisions : [];
  for (const item of decisions) {
    const action = item?.decision?.action;
    if (Object.hasOwn(counts, action)) counts[action] += 1;
    if (item?.decision?.execution_allowed === true) executionAllowed += 1;
  }
  const summary = report.summary ?? {};
  const lines = [
    `generated_at\t${report.generated_at ?? ''}`,
    `trading_date\t${report.trading_date ?? ''}`,
    `mode\t${report.mode ?? ''}`,
    `summary\t${summary.equity ?? ''}\t${summary.realized_pnl ?? ''}\t${summary.unrealized_pnl ?? ''}\t${summary.total_pnl ?? ''}\t${summary.cumulative_return_pct ?? ''}\t${summary.daily_return_pct ?? ''}\t${summary.max_drawdown_pct ?? ''}\t${summary.position_count ?? ''}\t${summary.turnover_today ?? ''}\t${summary.executed_today ?? ''}`,
    `counts\t${counts.SIM_BUY}\t${counts.SIM_HOLD}\t${counts.SIM_SELL}\t${counts.WATCH}\t${counts.NO_DATA}\t${executionAllowed}`,
    'code\tcompany\taction\tfundamental_score\ttechnical_score\tquote_valid\tconfidence',
    ...decisions.map(item => [
      item.code ?? '',
      item.company_name ?? '',
      item?.decision?.action ?? '',
      item?.fundamental?.score ?? '',
      item?.technical?.score ?? '',
      item?.quote?.valid ?? '',
      item?.decision?.confidence ?? '',
    ].join('\t')),
  ];
  return new Response(`${lines.join('\n')}\n`, {
    headers: {
      'Content-Type': 'text/plain; charset=utf-8',
      'Cache-Control': 'public, max-age=30, s-maxage=30',
      'X-Content-Type-Options': 'nosniff',
    },
  });
}
