from __future__ import annotations

import numpy as np
import pandas as pd

from investment_audit.open_source_strategy_lab import (
    LabConfig,
    metrics,
    portfolio_returns,
    run_walk_forward,
    strategy_weights,
    walk_forward_windows,
)


def prices(days: int = 90) -> pd.DataFrame:
    index = pd.date_range("2026-01-01", periods=days, freq="B", tz="Asia/Tokyo")
    return pd.DataFrame(
        {
            "A.T": np.linspace(100, 140, days),
            "B.T": np.linspace(100, 80, days),
            "C.T": 100 + np.sin(np.arange(days) / 5) * 5,
        },
        index=index,
    )


def test_strategy_weights_are_normalized_and_trend_uses_past_only() -> None:
    frame = prices()
    weights = strategy_weights(frame, "trend_confirmed", {})
    assert (weights.sum(axis=1) <= 1.000001).all()
    mutated = frame.copy()
    mutated.iloc[-1] = 10_000
    earlier = strategy_weights(mutated, "trend_confirmed", {}).iloc[:-1]
    pd.testing.assert_frame_equal(weights.iloc[:-1], earlier)


def test_execution_is_lagged_and_costed() -> None:
    frame = prices(30)
    weights = pd.DataFrame(0.0, index=frame.index, columns=frame.columns)
    weights.loc[frame.index[5]:, "A.T"] = 1.0
    returns, turnover = portfolio_returns(frame, weights, LabConfig())
    assert returns.loc[frame.index[5]] <= 0
    assert turnover.loc[frame.index[6]] > 0


def test_short_history_suppresses_annualized_claims() -> None:
    config = LabConfig(min_oos_days=42)
    series = pd.Series([0.01] * 20, index=pd.date_range("2026-01-01", periods=20, freq="B"))
    result = metrics(series, pd.Series(0.0, index=series.index), config)
    assert result["status"] == "insufficient_history"
    assert result["cagr_pct"] is None
    assert result["sharpe"] is None


def test_walk_forward_has_purge_gap() -> None:
    config = LabConfig(train_days=20, test_days=5, purge_days=2, min_oos_days=10)
    index = pd.date_range("2026-01-01", periods=45, freq="B")
    windows = walk_forward_windows(index, config)
    assert windows
    train, test = windows[0]
    assert index.get_loc(test[0]) - index.get_loc(train[-1]) == config.purge_days + 1


def test_walk_forward_warns_when_not_enough_history() -> None:
    config = LabConfig(train_days=126, test_days=21, purge_days=1)
    index = pd.date_range("2026-01-01", periods=60, freq="B")
    returns = {"baseline_equal_weight": pd.Series(0.0, index=index)}
    turnover = {"baseline_equal_weight": pd.Series(0.0, index=index)}
    result = run_walk_forward(returns, turnover, config)
    assert result["status"] == "insufficient_history"
    assert result["selected_strategy"] is None
