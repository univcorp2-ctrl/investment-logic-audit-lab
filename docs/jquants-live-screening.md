# J-Quants API V2 live screening

This repository now supports a secret-safe, point-in-time Japanese-equity screen built on the existing `JQuantsProvider`, fundamental scoring, and technical analysis modules.

## Security first

Never store a J-Quants API key in a public spreadsheet, source file, issue, log, browser bundle, or generated ranking. If a key has been publicly shared, revoke/rotate it in the J-Quants dashboard before use.

```bash
cp .env.example .env
# edit .env locally; do not commit it
export JQUANTS_API_KEY='your-rotated-key'
pip install -e '.[jquants,dev]'
```

The CLI never accepts the key as an argument. `JQUANTS_API_KEY` is read only by `JQuantsProvider`, and output files contain no credential values.

## Connectivity check

```bash
investment-audit jquants-plan-check --plan free --as-of 2026-08-03
```

The result is written to `outputs/jquants/plan-check.json`. Authentication details are redacted.

## Run the screen

Free-plan-safe defaults apply a 12-week data cutoff, a two-year history window, and five high-level requests per minute.

```bash
investment-audit jquants-screen \
  --plan free \
  --as-of 2026-08-03 \
  --market Prime,Standard,Growth \
  --top-n 20 \
  --min-average-daily-value 100000000 \
  --out-dir outputs/jquants
```

Paid-plan example:

```bash
investment-audit jquants-screen --plan standard --history-years 10 --top-n 30
```

Generated files:

- `ranking.csv`: deterministic tabular ranking
- `ranking.json`: sanitized metadata and rows
- `ranking.md`: human-readable shortlist
- `manifest.json`: effective cutoff, endpoint coverage, counts, warnings, and cache statistics

## Point-in-time rules

- Free-plan evaluation dates are shifted back 84 days before querying price and financial data.
- Disclosures after the effective cutoff are discarded.
- Technical indicators are calculated only from adjusted OHLCV available by the cutoff.
- The technical decision score is lagged by one observation in the existing technical module.
- Missing metrics remain missing. They are not silently replaced with zero.
- Ordinary-stock filtering excludes identifiable ETFs, ETNs, REITs, investment corporations, infrastructure funds, and preferred issues.

## Interpreting candidates

Treat a high rank as a research queue, not an order instruction. Confirm the latest statutory disclosure, corporate actions, guidance revisions, liquidity, trading unit, valuation assumptions, and news after the dataset cutoff. A Free-plan ranking is deliberately stale and should not be used for short-term entry timing.

The financial-summary endpoint does not expose every balance-sheet and market-value field needed by the full model for every issuer. The pipeline derives market capitalization when issued-share or book-value-per-share fields are present and reports data completeness and confidence so that thin observations remain visible.

## Evaluation before capital

Use the repository's walk-forward, fee-sensitivity, factor-audit, and backtest modules on point-in-time snapshots before considering real capital. Include commissions, spreads, slippage, taxes where applicable, delisted securities, corporate actions, disclosure lags, and a benchmark. Require a stable out-of-sample result across several parameter choices; an attractive in-sample Sharpe ratio is not evidence of future profit.
