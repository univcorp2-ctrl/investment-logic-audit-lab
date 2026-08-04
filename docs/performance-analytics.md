# Portfolio performance analytics

The paper monitor publishes `web/data/paper-trading/performance-analytics.json`. It is analysis-only and never changes the simulation rules or sends a broker order.

## History requirements

A single equity observation can show current P/L and portfolio concentration, but it cannot define a daily return. Annualized volatility, Sharpe, Sortino, Omega, VaR and CVaR require at least 30 daily returns. CAGR, Calmar, Alpha, Beta, Information Ratio and Tracking Error require at least 126 aligned returns. Values below those limits are `null` with a Japanese explanation and the required/available observation counts.

## Definitions

- Total return: final equity divided by invested seed capital minus one.
- Sharpe ratio: annualized excess return divided by total annualized volatility.
- Sortino ratio: annualized excess return divided by downside deviation.
- Calmar ratio: CAGR divided by the absolute maximum drawdown.
- Omega ratio: returns above the configured target divided by returns below it.
- Maximum drawdown: the largest peak-to-trough decline in the observed equity series.
- Ulcer Index: root mean square of percentage drawdowns.
- Historical VaR/CVaR: lower-tail historical daily return quantile and the mean beyond that quantile.
- Profit Factor: sum of positive daily returns divided by the absolute sum of negative daily returns.
- Payoff/Reward-Risk: average positive daily return divided by the absolute average negative daily return.
- HHI concentration: sum of squared current position weights; its reciprocal is the effective number of positions.

## Benchmark

The default benchmark is `1306.T`, a TOPIX-linked ETF available through the same public daily chart adapter. Dates are aligned using the latest benchmark observation available on or before each portfolio date; future benchmark prices are never backfilled. A fetch failure leaves benchmark metrics unavailable without failing the daily report.

## Chart series

The JSON contains exact observed dates only: equity, cumulative P/L, cumulative return, daily P/L, daily return, drawdown and benchmark cumulative return. Missing dates are not interpolated. One observation is rendered as a point with an insufficient-history message rather than as an invented line.
