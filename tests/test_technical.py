import numpy as np
import pandas as pd

from investment_audit.technical import analyze_technical, normalize_ohlcv


def make_ohlcv(periods: int = 320) -> pd.DataFrame:
    index = pd.date_range("2024-01-01", periods=periods, freq="B", tz="Asia/Tokyo")
    trend = np.linspace(100.0, 180.0, periods)
    wave = np.sin(np.arange(periods) / 8.0) * 2.0
    close = trend + wave
    return pd.DataFrame(
        {
            "Open": close - 0.5,
            "High": close + 1.0,
            "Low": close - 1.0,
            "Close": close,
            "Volume": 1_000_000 + np.arange(periods) * 100,
        },
        index=index,
    )


def test_indicators_and_scores_are_bounded() -> None:
    result = analyze_technical(make_ohlcv())
    required = {
        "sma20",
        "sma50",
        "sma200",
        "rsi14",
        "macd",
        "bollinger_upper",
        "atr14",
        "adx14",
        "position_52w",
        "technical_score",
        "decision_score",
    }
    assert required.issubset(result.columns)
    for column in ("rsi14", "adx14", "trend_score", "momentum_score", "technical_score"):
        assert result[column].dropna().between(0, 100).all()


def test_decision_score_is_strictly_lagged() -> None:
    original = make_ohlcv()
    changed = original.copy()
    changed.iloc[-1, changed.columns.get_loc("Close")] *= 10
    before = analyze_technical(original)
    after = analyze_technical(changed)
    assert before["decision_score"].iloc[-1] == after["decision_score"].iloc[-1]
    assert before["technical_score"].iloc[-1] != after["technical_score"].iloc[-1]
    expected = before["technical_score"].shift(1).rename("decision_score")
    pd.testing.assert_series_equal(expected, before["decision_score"])


def test_short_constant_series_does_not_crash() -> None:
    index = pd.date_range("2025-01-01", periods=12, freq="D")
    frame = pd.DataFrame({"C": 100.0, "H": 100.0, "L": 100.0, "Vo": 0.0}, index=index)
    result = analyze_technical(frame)
    assert len(result) == 12
    assert not np.isinf(result.select_dtypes(include="number").to_numpy()).any()


def test_timezone_duplicates_and_sorting_are_normalized() -> None:
    frame = make_ohlcv(20).iloc[::-1]
    frame = pd.concat([frame, frame.iloc[[0]]])
    normalized = normalize_ohlcv(frame)
    assert normalized.index.is_monotonic_increasing
    assert normalized.index.tz is None
    assert not normalized.index.duplicated().any()
