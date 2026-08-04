# Performance analytics and fundamental controls

The analytics layer reports what can be measured from the paper ledger and explicitly suppresses metrics that the available sample cannot support. It never submits a broker order.

## Minimum samples

- Annualized return, volatility, Sharpe, Sortino, Calmar, Omega, gain-to-pain, VaR and CVaR require at least 20 daily return observations.
- Trade-quality metrics require at least five completed simulated sells with realized P/L.
- Benchmark alpha, beta, correlation, tracking error and information ratio require 20 aligned benchmark observations.
- Missing metrics are `null`, never zero, and include a machine-readable status and Japanese reason.

The default risk-free rate is zero. Annualization uses 252 trading days.

## Definitions

- Maximum drawdown: the largest peak-to-trough percentage decline in the observed equity curve.
- Current drawdown: current equity relative to the latest running peak.
- Ulcer Index: square root of the mean squared percentage drawdown.
- Historical VaR 95%: the fifth percentile of daily returns. CVaR/Expected Shortfall is the mean return in that tail.
- Sharpe: annualized excess mean return divided by annualized volatility.
- Sortino: annualized excess mean return divided by annualized downside deviation.
- Calmar: CAGR divided by the absolute maximum drawdown.
- Omega at zero: sum of positive daily returns divided by the absolute sum of negative daily returns.
- Payoff ratio / risk-reward ratio: average winning completed trade divided by the absolute average losing completed trade. These two labels use the same calculation in this application.
- Profit factor: gross realized profit divided by gross realized loss.
- Expectancy: average realized P/L per completed simulated trade.
- Concentration HHI: sum of squared current position weights.

## Fundamental detailed controls

The browser-only detailed screen allows thresholds for earnings yield, book-to-market, FCF yield, dividend yield, ROE, operating margin, revenue/EPS/FCF growth, data completeness, value-trap risk, negative earnings/FCF years, earnings volatility and debt-to-equity when those fields exist.

Weights are grouped into valuation, quality, growth, stability, balance-sheet risk, data quality and technical confirmation. Missing values can be excluded, treated as neutral for research, or allowed without contributing to the score. Settings stay in browser localStorage and can be exported as JSON.

A short positive result is not evidence of a profitable strategy. The UI labels annualized and trade metrics as unavailable until their sample requirements are met.
