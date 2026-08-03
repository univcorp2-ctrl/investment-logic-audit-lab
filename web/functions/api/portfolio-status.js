export async function onRequestGet(context) {
  const sourceUrl = new URL('/api/quotes?compact=1', context.request.url);
  const response = await fetch(sourceUrl.toString(), {
    headers: { Accept: 'application/json' },
  });
  if (!response.ok) {
    return new Response(`quote_api_error\t${response.status}\n`, {
      status: 502,
      headers: { 'Content-Type': 'text/plain; charset=utf-8' },
    });
  }
  const payload = await response.json();
  const portfolio = payload.portfolio ?? {};
  const lines = [
    `generated_at\t${payload.generated_at ?? ''}`,
    `total\t${portfolio.total_entry_value ?? ''}\t${portfolio.total_current_value ?? ''}\t${portfolio.total_unrealized_pnl ?? ''}\t${portfolio.total_return_pct ?? ''}\t${portfolio.winners ?? ''}\t${portfolio.losers ?? ''}\t${portfolio.unchanged ?? ''}\t${portfolio.usable_quotes ?? ''}\t${portfolio.double_checked ?? ''}`,
    'code\tname\tentry\tcurrent\tpnl\treturn_pct\tverification\tusable\tquote_time\tmax_diff_pct',
    ...(payload.positions ?? []).map(position => [
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
  return new Response(`${lines.join('\n')}\n`, {
    headers: {
      'Content-Type': 'text/plain; charset=utf-8',
      'Cache-Control': 'public, max-age=30, s-maxage=30',
      'X-Content-Type-Options': 'nosniff',
    },
  });
}
