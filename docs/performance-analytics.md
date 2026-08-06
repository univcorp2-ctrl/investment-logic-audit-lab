# Portfolio performance analytics

The paper portfolio dashboard separates four chart views: equity curve, daily P/L, drawdown and per-position contribution. A period selector supports all history, 1M, 3M, 6M and 1Y views. Current validated quotes are appended as a live mark without rewriting daily history.

## Metrics shown

Return: cumulative return, total/realized/unrealized P/L, CAGR, average daily return, best and worst day.

Risk: annualized volatility, downside deviation, maximum and current drawdown, Ulcer Index, Pain Index, historical VaR 95%, historical CVaR 95%, skewness and excess kurtosis.

Risk-adjusted: Sharpe, Sortino, Calmar, Recovery Factor, Gain-to-Pain, Omega, and Risk/Reward defined as average positive day divided by the absolute average negative day.

Trading quality: win/loss rates, Payoff Ratio, Profit Factor, Expectancy, average win/loss, longest win/loss streak, event count and turnover.

Benchmark: excess return, beta, annualized alpha, tracking error, Information Ratio, correlation, up capture and down capture against 1306.T as a TOPIX proxy when sufficient paired observations exist.

## History safeguards

The app does not annualize a few days of performance. Distribution metrics normally require at least 20 daily observations; Sharpe, Sortino, CAGR and Calmar require at least 60. Until then, the UI displays `算定待ち` and the required sample size.

Maximum drawdown includes the drawdown depth, peak date, trough date, recovery date, peak-to-trough duration, recovery duration and total underwater periods.
