from __future__ import annotations

from dataclasses import dataclass

import numpy as np
import pandas as pd


@dataclass(frozen=True)
class TechnicalConfig:
    rsi_period: int = 14
    atr_period: int = 14
    adx_period: int = 14
    min_average_dollar_volume: float = 0.0
    annualization_days: int = 252


_COLUMN_ALIASES = {
    "open": ("open", "Open", "O"),
    "high": ("high", "High", "H"),
    "low": ("low", "Low", "L"),
    "close": ("close", "Close", "adjusted_close", "Adj Close", "AdjC", "C"),
    "volume": ("volume", "Volume", "Vo"),
}


def normalize_ohlcv(frame: pd.DataFrame) -> pd.DataFrame:
    if frame.empty:
        return pd.DataFrame(columns=["open", "high", "low", "close", "volume"])
    working = frame.copy()
    date_index = pd.DatetimeIndex(pd.to_datetime(working.index, errors="coerce", utc=True))
    working.index = date_index.tz_convert(None)
    working = working.iloc[np.flatnonzero(working.index.notna())]
    working = working.iloc[np.flatnonzero(~working.index.duplicated(keep="last"))].sort_index()

    normalized = pd.DataFrame(index=working.index)
    for target, aliases in _COLUMN_ALIASES.items():
        values = pd.Series(np.nan, index=working.index, dtype=float)
        for alias in aliases:
            if alias in working.columns:
                candidate = pd.to_numeric(working[alias], errors="coerce")
                values = values.where(values.notna(), candidate)
        normalized[target] = values
    if normalized["close"].isna().all():
        raise ValueError("OHLCV data requires a close/adjusted-close column")
    normalized["high"] = normalized["high"].combine_first(normalized["close"])
    normalized["low"] = normalized["low"].combine_first(normalized["close"])
    normalized["open"] = normalized["open"].combine_first(normalized["close"])
    return normalized.replace([np.inf, -np.inf], np.nan)


def _rsi(close: pd.Series, period: int) -> pd.Series:
    delta = close.diff()
    gain = delta.clip(lower=0.0).ewm(alpha=1 / period, adjust=False, min_periods=period).mean()
    loss = (-delta.clip(upper=0.0)).ewm(alpha=1 / period, adjust=False, min_periods=period).mean()
    rs = gain / loss.where(loss > 0)
    result = 100.0 - (100.0 / (1.0 + rs))
    result = result.where(~((gain > 0) & (loss == 0)), 100.0)
    result = result.where(~((gain == 0) & (loss == 0)), 50.0)
    return result.clip(0.0, 100.0)


def _atr_adx(data: pd.DataFrame, period: int) -> tuple[pd.Series, pd.Series]:
    high = data["high"]
    low = data["low"]
    close = data["close"]
    true_range = pd.concat(
        [(high - low).abs(), (high - close.shift(1)).abs(), (low - close.shift(1)).abs()],
        axis=1,
    ).max(axis=1)
    atr = true_range.ewm(alpha=1 / period, adjust=False, min_periods=period).mean()
    up_move = high.diff()
    down_move = -low.diff()
    plus_dm = up_move.where((up_move > down_move) & (up_move > 0), 0.0)
    minus_dm = down_move.where((down_move > up_move) & (down_move > 0), 0.0)
    plus_di = 100.0 * plus_dm.ewm(alpha=1 / period, adjust=False, min_periods=period).mean() / atr
    minus_di = 100.0 * minus_dm.ewm(alpha=1 / period, adjust=False, min_periods=period).mean() / atr
    dx = 100.0 * (plus_di - minus_di).abs() / (plus_di + minus_di).where(
        (plus_di + minus_di) > 0
    )
    adx = dx.ewm(alpha=1 / period, adjust=False, min_periods=period).mean()
    return atr, adx.clip(0.0, 100.0)


def _bounded(series: pd.Series) -> pd.Series:
    return pd.to_numeric(series, errors="coerce").clip(0.0, 100.0)


def analyze_technical(
    frame: pd.DataFrame,
    config: TechnicalConfig | None = None,
) -> pd.DataFrame:
    """Calculate indicators and lagged decision scores for one symbol."""

    config = config or TechnicalConfig()
    data = normalize_ohlcv(frame)
    if data.empty:
        return data
    close = data["close"]
    volume = data["volume"]
    result = data.copy()
    result["sma20"] = close.rolling(20, min_periods=5).mean()
    result["sma50"] = close.rolling(50, min_periods=15).mean()
    result["sma200"] = close.rolling(200, min_periods=60).mean()
    result["ema20"] = close.ewm(span=20, adjust=False, min_periods=5).mean()
    result["rsi14"] = _rsi(close, config.rsi_period)
    ema12 = close.ewm(span=12, adjust=False, min_periods=12).mean()
    ema26 = close.ewm(span=26, adjust=False, min_periods=26).mean()
    result["macd"] = ema12 - ema26
    result["macd_signal"] = result["macd"].ewm(span=9, adjust=False, min_periods=9).mean()
    result["macd_histogram"] = result["macd"] - result["macd_signal"]
    rolling_std = close.rolling(20, min_periods=5).std(ddof=0)
    result["bollinger_mid"] = result["sma20"]
    result["bollinger_upper"] = result["sma20"] + 2.0 * rolling_std
    result["bollinger_lower"] = result["sma20"] - 2.0 * rolling_std
    result["atr14"], result["adx14"] = _atr_adx(data, config.adx_period)
    low_52w = close.rolling(252, min_periods=20).min()
    high_52w = close.rolling(252, min_periods=20).max()
    result["position_52w"] = (
        (close - low_52w) / (high_52w - low_52w).where(high_52w > low_52w)
    ).clip(0.0, 1.0)
    for days in (63, 126, 252):
        result[f"relative_strength_{days}d"] = close.pct_change(days)
    result["annualized_volatility"] = close.pct_change().rolling(
        63, min_periods=20
    ).std() * np.sqrt(config.annualization_days)
    average_volume = volume.rolling(20, min_periods=5).mean()
    result["volume_ratio_20d"] = volume / average_volume.where(average_volume > 0)
    result["average_dollar_volume_20d"] = (close * volume).rolling(20, min_periods=5).mean()
    previous_high = close.rolling(63, min_periods=20).max().shift(1)
    result["price_breakout_63d"] = (close > previous_high).astype(float).where(previous_high.notna())
    result["volume_breakout"] = (
        (result["volume_ratio_20d"] >= 1.5) & (result["price_breakout_63d"] == 1.0)
    ).astype(float)

    trend = pd.Series(50.0, index=result.index)
    trend += np.where(close > result["sma50"], 12.0, -12.0)
    trend += np.where(close > result["sma200"], 18.0, -18.0)
    trend += np.where(result["sma50"] > result["sma200"], 12.0, -12.0)
    trend += np.where(result["sma20"] > result["sma50"], 8.0, -8.0)
    trend += np.where(result["adx14"] >= 20, 5.0, 0.0)
    result["trend_score"] = _bounded(trend)

    momentum = pd.Series(50.0, index=result.index)
    momentum += np.where(result["macd_histogram"] > 0, 12.0, -12.0)
    momentum += np.where(result["relative_strength_63d"] > 0, 12.0, -12.0)
    momentum += np.where(result["relative_strength_126d"] > 0, 10.0, -10.0)
    momentum += np.where(result["relative_strength_252d"] > 0, 8.0, -8.0)
    momentum += np.where(result["rsi14"].between(45, 70), 8.0, 0.0)
    momentum -= np.where(result["rsi14"] > 80, 12.0, 0.0)
    momentum += result["volume_breakout"].fillna(0.0) * 8.0
    result["momentum_score"] = _bounded(momentum)

    mean_reversion = pd.Series(45.0, index=result.index)
    mean_reversion += np.where(result["rsi14"] < 35, 22.0, 0.0)
    mean_reversion += np.where(close < result["bollinger_lower"], 18.0, 0.0)
    mean_reversion += np.where(result["position_52w"] < 0.25, 10.0, 0.0)
    mean_reversion += np.where(
        result["macd_histogram"] > result["macd_histogram"].shift(1), 10.0, 0.0
    )
    mean_reversion -= np.where(close < result["sma200"], 18.0, 0.0)
    result["mean_reversion_score"] = _bounded(mean_reversion)

    risk = pd.Series(75.0, index=result.index)
    risk -= (result["annualized_volatility"].fillna(0.25) - 0.20).clip(lower=0.0) * 100.0
    risk -= np.where(close < result["sma200"], 15.0, 0.0)
    risk -= np.where(result["position_52w"] < 0.10, 10.0, 0.0)
    risk += np.where(result["atr14"] / close < 0.03, 5.0, -5.0)
    if config.min_average_dollar_volume > 0:
        risk -= np.where(
            result["average_dollar_volume_20d"] < config.min_average_dollar_volume,
            25.0,
            0.0,
        )
    result["risk_score"] = _bounded(risk)
    result["risk_level"] = 100.0 - result["risk_score"]

    result["technical_score"] = _bounded(
        result["trend_score"] * 0.40
        + result["momentum_score"] * 0.30
        + result["mean_reversion_score"] * 0.15
        + result["risk_score"] * 0.15
    )
    result["decision_score"] = result["technical_score"].shift(1)
    result["decision_signal"] = np.select(
        [result["decision_score"] >= 60.0, result["decision_score"] <= 35.0],
        [1, -1],
        default=0,
    )
    return result.replace([np.inf, -np.inf], np.nan)
