# Performance Cockpit metrics and iPhone graph controls

The Overview screen prioritizes the two quantities a user can interpret immediately even with a short live history: cumulative return and drawdown/loss exposure. On iPhone they are always shown together at the top.

## iPhone focus cards

`累積利益率` uses a validated live paper mark when current quotes are available. If live verification fails, it falls back to the most recent confirmed daily return and labels the confirmed date. The subtext shows total paper P/L in yen.

`最大DD / 最大含み損` uses the worse of confirmed historical maximum drawdown and current intraday drawdown. Its subtext shows the most negative historical `unrealized_pnl`, the loss as a percentage of seed cost basis, and the date on which that unrealized loss occurred. Missing unrealized-loss observations remain missing and are never converted to zero.

These values are not broker stops and never submit an order.

## Priority metrics

The horizontally swipeable strip remains ordered as: Total Return, Maximum Drawdown, Sharpe Ratio, Sortino Ratio, Calmar Ratio, Risk/Reward, Profit Factor, and Expectancy per closed trade. Annualized metrics remain unavailable until the existing reliability gate is satisfied.

## Graph controls

The graph offers `縮小`, `リセット`, and `拡大`. The chosen graph height and zoom period are stored locally in `valuescope-performance-chart-size-v1` and `valuescope-performance-chart-zoom-v1`.

The date strip under the chart lists every currently plotted observation. Selecting a date focuses the corresponding SVG point or bar and writes the full `YYYY/MM/DD` and value into an accessible readout. The x-axis remains sparse on iPhone to prevent label overlap, while the date strip makes every observation directly selectable.

The `その他の分析指標` section is collapsed by default on iPhone so the first screen remains short. Full metrics remain available in the P/L and Risk destination.
