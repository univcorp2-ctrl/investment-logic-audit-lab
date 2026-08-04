# Performance analytics and fundamental controls

ValueScope Japan separates scheduled paper-trading rules, browser-only analysis settings and browser-only fundamental screening settings. Changing browser settings never changes the scheduled paper rules and never sends an order.

## Clear P/L charts

The P/L page provides Equity, Cumulative P/L, Daily P/L, Drawdown and Portfolio versus 1306.T benchmark views. Ranges are 1W, 1M, 3M, 6M, 1Y and All. Exact observed dates are used; missing dates are not interpolated. A one-observation history is rendered as a point with an insufficient-history message.

## Analysis settings

The user can change annual risk-free rate, annual target return, annualization days, VaR confidence, scenario target and scenario stop. These settings are stored in localStorage and can be exported or imported as JSON. The scenario Target/Stop reward-risk ratio is an analysis aid only and does not alter the daily monitor.

## Metrics

Return: total return, CAGR, latest daily return, realized, unrealized and total P/L.

Risk: volatility, downside deviation, maximum/current/average drawdown, drawdown and recovery duration, Ulcer Index, VaR, CVaR, best/worst day, skewness and kurtosis.

Risk-adjusted: Sharpe, Sortino, Calmar, Omega, Information Ratio, Tracking Error, Beta and Alpha.

Win/loss: win rate, Profit Factor, Payoff Ratio, expectancy, Reward/Risk and streaks.

Portfolio: trade count, turnover, exposure, cash ratio, largest weight, HHI concentration, effective positions, closed-trade win rate and holding period.

Annualized volatility, Sharpe, Sortino, Omega and tail-risk estimates need 30 daily returns. CAGR, Calmar and benchmark-relative ratios need 126. Below those limits the UI shows the exact required and available observations.

## Detailed fundamental model

The Conditions Screener allows the user to enable, weight and threshold earnings yield, book-to-market, FCF yield, ROE, operating margin, revenue/EPS/FCF growth, margin change, FCF conversion, accrual quality, earnings/FCF stability, negative years, data completeness and value-trap risk.

Metric direction is fixed. Raw values are converted to cross-sectional percentile scores, and each weighted point contribution is shown. Missing values can inherit the global policy or be allowed, neutral 50 or excluded per metric. Presets are Balanced, Cash Flow, High ROE, Financial Stability and Value-Trap Avoidance. Settings remain in the browser and support URL hash, JSON and CSV export.
