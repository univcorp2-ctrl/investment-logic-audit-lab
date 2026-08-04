# Open-source strategy comparison lab

The lab evaluates research frameworks and strategy variants. It never changes the daily paper rule automatically and never sends a broker order.

## Projects reviewed

### Microsoft Qlib

Qlib is an MIT-licensed, AI-oriented quantitative platform covering data processing, model training, backtesting, risk and experiment workflows. It is powerful but brings a large ML stack and expects a dedicated data format. Direct adoption would require a maintained Japanese-equity data adapter, so this repository adopts only the experiment-manifest pattern for now.

- https://github.com/microsoft/qlib

### vectorbt 1.1

vectorbt is designed for vectorized parameter sweeps, portfolio analytics and robustness testing. Version 1.1.0 was published on 2026-07-05 and supports Python 3.11+. Its license is Apache 2.0 with Commons Clause/fair-code conditions, so commercial redistribution must be reviewed. It is added only as the optional `quantlab` extra and is used as a validation engine when installed.

- https://github.com/polakowo/vectorbt
- https://pypi.org/project/vectorbt/

### bt

bt is an MIT-licensed framework with composable portfolio rebalancing algorithms. The current repository already has a portfolio/backtest engine that covers the immediate requirement, so adding bt would duplicate dependencies without proving an improvement.

- https://github.com/pmorissette/bt

## Compared research variants

- Baseline equal-weight delayed selection
- Trend-confirmed: price above SMA20 and SMA20 above SMA60
- Quality-value: top half of the static delayed snapshot by value and quality
- Low-volatility selection
- Inverse-volatility allocation
- Momentum-confirmed: positive 20- and 60-day momentum

Signals are lagged one trading day. Costs are 5 bps plus 2 bps slippage. The fundamental snapshot is not used before its effective cutoff.

## Walk-forward validation

The default split is 126 training days, one purge day and 21 test days. A candidate cannot be promoted unless at least 42 out-of-sample observations exist. With the current 2026-05-11 delayed cutoff, the available post-cutoff history is expected to be too short; CAGR and Sharpe are therefore suppressed rather than annualized from a few weeks.

The weekly workflow runs on Saturday and publishes sanitized research JSON under `web/data/strategy-lab/`. It records the engine version, data dates, costs, warnings and configuration in a Qlib-style experiment manifest.
