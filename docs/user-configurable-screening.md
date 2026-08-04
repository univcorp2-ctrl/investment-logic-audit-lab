# User-configurable screening laboratory

The Conditions Screener runs entirely in the browser. It joins the sanitized J-Quants ranking with the latest daily paper-monitor report and never sends the user's settings to a server.

Controls cover overall, fundamental, value, quality, growth, data completeness, technical score, value-trap risk, RSI, moving-average trend, momentum, volatility, drawdown, market, sector, holding state and current paper decision. Weights are normalized at calculation time.

Presets are Balanced, Value, Quality, Trend, Low Volatility and Free Safe. Settings are saved to browser localStorage and encoded into the URL hash for sharing. JSON import/export and CSV result export are available.

Missing values can be allowed, replaced with a neutral score for research, or excluded. The selected policy is visible and affects both eligibility and the recomputed laboratory score.

The delayed-data verification card uses the existing 2026-05-11 Free-plan fundamental cutoff and the 2026-08-03 paper entries. Results over fewer than five trading days are explicitly marked as statistically insufficient.
