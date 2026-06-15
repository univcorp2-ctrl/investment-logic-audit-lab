from __future__ import annotations

from collections.abc import Iterable
from dataclasses import dataclass

import pandas as pd

from .backtest import metrics_from_returns, run_backtest
from .signals import cross_sectional_momentum, moving_average_trend, time_series_momentum


@dataclass(frozen=True)
class WalkForwardResult:
    windows: pd.DataFrame
    returns: pd.Series
    equity: pd.Series


def build_signal(strategy: str, prices: pd.DataFrame, params: dict) -> pd.DataFrame:
    if strategy == "ts_mom":
        return time_series_momentum(prices, **params)
    if strategy == "ma_trend":
        return moving_average_trend(prices, **params)
    if strategy == "cs_mom":
        return cross_sectional_momentum(prices, **params)
    raise ValueError(f"Unsupported strategy: {strategy}")


def iter_windows(
    index: pd.DatetimeIndex,
    train_days: int = 504,
    test_days: int = 126,
    purge_days: int = 5,
) -> Iterable[tuple[pd.DatetimeIndex, pd.DatetimeIndex]]:
    if train_days <= 0 or test_days <= 0 or purge_days < 0:
        raise ValueError("Invalid walk-forward window sizes")
    start = 0
    n = len(index)
    while start + train_days + purge_days + test_days <= n:
        train_index = index[start : start + train_days]
        test_start = start + train_days + purge_days
        test_index = index[test_start : test_start + test_days]
        yield train_index, test_index
        start += test_days


def run_walk_forward(
    prices: pd.DataFrame,
    strategy: str,
    parameter_grid: list[dict],
    train_days: int = 504,
    test_days: int = 126,
    purge_days: int = 5,
    objective: str = "sharpe",
    max_train_drawdown: float = -0.45,
    cost_bps: float = 5.0,
    slippage_bps: float = 2.0,
) -> WalkForwardResult:
    """Optimize on each train window and evaluate only the following test window."""
    if prices.empty:
        raise ValueError("prices must not be empty")
    if not parameter_grid:
        raise ValueError("parameter_grid must not be empty")

    prices = prices.sort_index().ffill().dropna(how="all")
    rows: list[dict] = []
    out_of_sample_returns: list[pd.Series] = []

    for window_id, (train_index, test_index) in enumerate(
        iter_windows(prices.index, train_days=train_days, test_days=test_days, purge_days=purge_days),
        start=1,
    ):
        train_prices = prices.loc[train_index]
        candidates = []
        for params in parameter_grid:
            signal = build_signal(strategy, train_prices, params)
            result = run_backtest(
                train_prices,
                signal,
                cost_bps=cost_bps,
                slippage_bps=slippage_bps,
            )
            score = result.metrics.get(objective, 0.0)
            if result.metrics["max_drawdown"] < max_train_drawdown:
                score = -10**9
            candidates.append((score, params, result.metrics))

        score, best_params, train_metrics = max(candidates, key=lambda x: x[0])

        # Generate test-period signals with warm-up history, but score only the locked OOS window.
        history = prices.loc[train_index[0] : test_index[-1]]
        signal = build_signal(strategy, history, best_params)
        result = run_backtest(history, signal, cost_bps=cost_bps, slippage_bps=slippage_bps)
        test_returns = result.returns.reindex(test_index).dropna()
        test_metrics = metrics_from_returns(test_returns)
        out_of_sample_returns.append(test_returns)

        rows.append(
            {
                "window": window_id,
                "train_start": train_index[0].date().isoformat(),
                "train_end": train_index[-1].date().isoformat(),
                "test_start": test_index[0].date().isoformat(),
                "test_end": test_index[-1].date().isoformat(),
                "strategy": strategy,
                "best_params": best_params,
                "train_objective": score,
                "train_sharpe": train_metrics["sharpe"],
                "train_total_return": train_metrics["total_return"],
                "train_max_drawdown": train_metrics["max_drawdown"],
                "test_sharpe": test_metrics["sharpe"],
                "test_total_return": test_metrics["total_return"],
                "test_max_drawdown": test_metrics["max_drawdown"],
            }
        )

    if out_of_sample_returns:
        returns = pd.concat(out_of_sample_returns).sort_index()
    else:
        returns = pd.Series(dtype=float, name="returns")
    returns.name = "returns"
    equity = (1 + returns).cumprod()
    equity.name = "equity"
    return WalkForwardResult(windows=pd.DataFrame(rows), returns=returns, equity=equity)
