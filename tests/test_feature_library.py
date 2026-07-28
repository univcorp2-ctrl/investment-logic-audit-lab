import numpy as np
import pandas as pd

from investment_audit.feature_library import build_feature_library, lagged_feature_snapshot


def make_ohlcv(periods: int = 180) -> pd.DataFrame:
    index = pd.date_range("2025-01-01", periods=periods, freq="B")
    close = 100 + np.linspace(0, 30, periods) + np.sin(np.arange(periods) / 7)
    return pd.DataFrame(
        {
            "Open": close * 0.999,
            "High": close * 1.01,
            "Low": close * 0.99,
            "Close": close,
            "Volume": 1_000_000 + np.arange(periods) * 100,
        },
        index=index,
    )


def test_feature_library_contains_multiscale_features() -> None:
    result = build_feature_library(make_ohlcv())
    required = {
        "return_5d",
        "close_to_sma_20",
        "close_to_ema_60",
        "realized_vol_20",
        "downside_vol_60",
        "volume_zscore_20",
        "price_volume_corr_60",
        "amihud_20",
    }
    assert required.issubset(result.columns)
    assert not np.isinf(result.select_dtypes(include="number").to_numpy()).any()


def test_lagged_snapshot_is_not_changed_by_latest_close() -> None:
    frame = make_ohlcv()
    changed = frame.copy()
    changed.iloc[-1, changed.columns.get_loc("Close")] *= 5
    first = lagged_feature_snapshot(frame, periods=1)
    second = lagged_feature_snapshot(changed, periods=1)
    pd.testing.assert_series_equal(first, second)


def test_short_constant_missing_volume_series_is_safe() -> None:
    index = pd.date_range("2025-01-01", periods=8, freq="D")
    frame = pd.DataFrame({"close": 100.0}, index=index)
    result = build_feature_library(frame, lookbacks=(5,))
    assert len(result) == 8
    assert not np.isinf(result.select_dtypes(include="number").to_numpy()).any()
