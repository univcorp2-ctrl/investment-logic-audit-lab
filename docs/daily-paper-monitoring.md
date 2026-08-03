# Daily paper portfolio monitoring

This repository runs a **paper-only simulation**. It never logs into a brokerage account, sends an order, transfers money, or stores broker credentials.

## Schedule

`.github/workflows/daily-paper-monitor.yml` runs at `07:15 UTC` on weekdays, which is `16:15 Asia/Tokyo`. A manual dispatch can run in monitor-only mode or update the simulation ledger.

## Data separation

Fundamental data comes from the last sanitized J-Quants ranking. Free-plan fundamentals are generally delayed by 12 weeks, so the UI keeps the effective cutoff visible and does not present them as current facts. Technical data are calculated from public daily price history and the existing validated quote endpoint.

The monitor keeps these pillars separate:

- Fundamental: value, quality, growth/stability, value-trap risk, data completeness, earnings yield, book-to-market, FCF yield, ROE, operating margin, and disclosure date.
- Technical: price, SMA20/SMA60, price distance from averages, RSI14, 20/60-day momentum, 20-day volatility, drawdown, and volume/trading value.

Missing metrics remain missing; they are never silently converted to zero.

## Simulation rules

Thresholds live in `StrategyConfig` in `src/investment_audit/daily_monitor.py`.

- `SIM_BUY`: no current holding; fundamental, quality, completeness and value-trap thresholds pass; technical confirmation passes.
- `SIM_HOLD`: a holding remains above the sell thresholds.
- `SIM_SELL`: thesis quality fails, value-trap risk rises, technical score breaks down, stop loss is reached, or drawdown exceeds the limit.
- `NO_DATA`: required information is unavailable.

A quote that is stale, missing, rejected by the validation endpoint, or differs by more than 3% across sources cannot create a simulated trade. Same-day duplicate events are prevented. Sells are processed before buys, and buys require cash generated inside the paper ledger.

## Output

Sanitized files are written under `web/data/paper-trading/`:

- `portfolio.json`
- `latest-report.json`
- `trade-proposals.json`
- `trades.json`
- `equity-history.json`
- `daily-reports/YYYY-MM-DD.json`

The existing 2026-08-03 ten-position, 100-share demo is used as the seed. Reports include realized, unrealized and total P/L, daily/cumulative return, turnover and maximum drawdown.

## Reviewing proposals

`trade-proposals.json` is for human review. The side names are simulation labels only. The workflow never sends them to an external service.

## J-Quants plans

The web plan panel reads `web/jquants-plans.json`. It explains the operational benefit of Free, Light, Standard and Premium, and separately labels the 2026 TDnet/Company Disclosure add-on. Paid data can reduce staleness and increase validation depth; it does not create or guarantee alpha.
