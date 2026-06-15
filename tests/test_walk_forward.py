from __future__ import annotations

from investment_audit.data import make_synthetic_market
from investment_audit.walk_forward import iter_windows, run_walk_forward


def test_iter_windows_creates_non_overlapping_test_windows() -> None:
    prices = make_synthetic_market(days=800)
    windows = list(iter_windows(prices.index, train_days=252, test_days=63, purge_days=5))
    assert len(windows) > 0
    first_train, first_test = windows[0]
    assert first_train[-1] < first_test[0]


def test_run_walk_forward_returns_oos_table() -> None:
    prices = make_synthetic_market(days=900)
    result = run_walk_forward(
        prices,
        strategy="ts_mom",
        parameter_grid=[
            {"lookback": 63, "skip": 1, "long_only": False},
            {"lookback": 126, "skip": 1, "long_only": True},
        ],
        train_days=252,
        test_days=63,
        purge_days=5,
    )
    assert not result.windows.empty
    assert "test_total_return" in result.windows.columns
    assert len(result.returns) > 0
