from __future__ import annotations

import pandas as pd

from investment_audit.data import make_synthetic_fundamentals, make_synthetic_market
from investment_audit.signals import (
    cross_sectional_momentum,
    fundamental_quality_value_momentum,
    moving_average_trend,
    time_series_momentum,
)


def test_time_series_momentum_shape() -> None:
    prices = make_synthetic_market(days=300)
    signal = time_series_momentum(prices, lookback=63, skip=1)
    assert signal.shape == prices.shape
    assert set(signal.stack().unique()).issubset({-1.0, 0.0, 1.0})


def test_moving_average_trend_is_long_only_when_requested() -> None:
    prices = make_synthetic_market(days=300)
    signal = moving_average_trend(prices, fast=20, slow=80, long_only=True)
    assert signal.min().min() >= 0


def test_cross_sectional_momentum_generates_positions() -> None:
    prices = make_synthetic_market(days=300)
    signal = cross_sectional_momentum(prices, lookback=63, long_short=True)
    assert signal.abs().sum().sum() > 0


def test_fundamental_quality_value_momentum_ranks_quality_first() -> None:
    fundamentals = make_synthetic_fundamentals()
    scores = fundamental_quality_value_momentum(
        fundamentals,
        pd.Series({"SPY_SIM": 0.1, "QUALITY_SIM": 0.2, "SIDEWAYS_SIM": -0.1}),
    )
    assert scores.index[0] == "QUALITY_SIM"
