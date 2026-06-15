from __future__ import annotations

import pandas as pd

from investment_audit.backtest import fee_sensitivity, run_backtest
from investment_audit.data import make_synthetic_market
from investment_audit.signals import moving_average_trend, time_series_momentum


def test_backtest_produces_metrics_and_equity_curve() -> None:
    prices = make_synthetic_market(days=420)
    signal = time_series_momentum(prices, lookback=63, skip=1, long_only=True)
    result = run_backtest(prices, signal, cost_bps=5, slippage_bps=2)
    assert isinstance(result.equity, pd.Series)
    assert len(result.equity) == len(prices)
    assert set(["total_return", "sharpe", "max_drawdown"]).issubset(result.metrics)
    assert result.weights.abs().sum(axis=1).max() <= 1.0000001


def test_fee_sensitivity_has_expected_grid() -> None:
    prices = make_synthetic_market(days=360)
    signal = moving_average_trend(prices, fast=20, slow=80, long_only=True)
    table = fee_sensitivity(prices, signal, fee_grid_bps=[0, 10, 50])
    assert list(table["fee_bps"]) == [0, 10, 50]
    assert "total_return" in table.columns
