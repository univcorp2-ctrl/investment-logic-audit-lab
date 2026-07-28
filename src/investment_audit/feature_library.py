"""Original multi-horizon OHLCV features inspired by public factor-library concepts."""

from __future__ import annotations

import numpy as np
import pandas as pd


_LOOKBACKS = (5, 10, 20, 60, 120)


def _normalize(frame: pd.DataFrame) -> pd.DataFrame:
    aliases = {
        "open": ("open", "Open", "O"),
        "high": ("high", "High", "H"),
        "low": ("low", "Low", "L"),
        "close": ("close", "Close", "adjusted_close", "Adj Close", "AdjC", "C"),
        "volume": ("volume", "Volume", "Vo", "adjusted_volume", "AdjVo"),
    }
    working = frame.copy()
    index = pd.DatetimeIndex(pd.to_datetime(working.index, errors="coerce", utc=True))
    working.index = index.tz_convert(None)
    working = working.iloc[np.flatnonzero(working.index.notna())]
    working = working.iloc[
        np.flatnonzero(~working.index.duplicated(keep="last"))
    ].sort_index()
    output = pd.DataFrame(index=working.index)
    for target, candidates in aliases.items():
        values = pd.Series(np.nan, index=working.index, dtype=float)
        for candidate in candidates:
            if candidate in working.columns:
                values = values.combine_first(
                    pd.to_numeric(working[candidate], errors="coerce")
                )
        output[target] = values
    if output["close"].isna().all():
        raise ValueError("OHLCV data requires a close column")
    output["open"] = output["open"].combine_first(output["close"])
    output["high"] = output["high"].combine_first(
        output[["open", "close"]].max(axis="columns")
    )
    output["low"] = output["low"].combine_first(
        output[["open", "close"]].min(axis="columns")
    )
    return output.replace([np.inf, -np.inf], np.nan)


def build_feature_library(
    frame: pd.DataFrame,
    lookbacks: tuple[int, ...] = _LOOKBACKS,
) -> pd.DataFrame:
    data = _normalize(frame)
    close = data["close"]
    returns_1d = close.pct_change(fill_method=None)
    output = data.copy()
    output["return_1d"] = returns_1d
    output["overnight_return"] = data["open"] / close.shift(1) - 1.0
    output["intraday_return"] = (
        close / data["open"].where(data["open"].abs() > 1e-12) - 1.0
    )
    true_range = pd.concat(
        [
            (data["high"] - data["low"]).abs(),
            (data["high"] - close.shift(1)).abs(),
            (data["low"] - close.shift(1)).abs(),
        ],
        axis="columns",
    ).max(axis="columns")
    dollar_volume = close.abs() * data["volume"]
    volume_change = data["volume"].pct_change(fill_method=None)

    for window in lookbacks:
        if window < 2:
            raise ValueError("lookbacks must be at least 2")
        minimum = max(2, window // 3)
        sma = close.rolling(window, min_periods=minimum).mean()
        ema = close.ewm(span=window, adjust=False, min_periods=minimum).mean()
        output[f"return_{window}d"] = close.pct_change(window, fill_method=None)
        output[f"close_to_sma_{window}"] = (
            close / sma.where(sma.abs() > 1e-12) - 1.0
        )
        output[f"close_to_ema_{window}"] = (
            close / ema.where(ema.abs() > 1e-12) - 1.0
        )
        output[f"realized_vol_{window}"] = returns_1d.rolling(
            window,
            min_periods=minimum,
        ).std(ddof=1)
        downside = returns_1d.where(returns_1d < 0, 0.0)
        output[f"downside_vol_{window}"] = np.sqrt(
            downside.pow(2).rolling(window, min_periods=minimum).mean()
        )
        output[f"range_{window}"] = (
            true_range / close.abs().where(close.abs() > 1e-12)
        ).rolling(window, min_periods=minimum).mean()
        volume_mean = data["volume"].rolling(window, min_periods=minimum).mean()
        volume_std = data["volume"].rolling(window, min_periods=minimum).std(ddof=1)
        output[f"volume_ratio_{window}"] = (
            data["volume"] / volume_mean.where(volume_mean > 0)
        )
        output[f"volume_zscore_{window}"] = (
            data["volume"] - volume_mean
        ) / volume_std.where(volume_std > 0)
        output[f"price_volume_corr_{window}"] = returns_1d.rolling(
            window,
            min_periods=minimum,
        ).corr(volume_change)
        output[f"amihud_{window}"] = (
            returns_1d.abs() / dollar_volume.where(dollar_volume > 0)
        ).rolling(window, min_periods=minimum).mean()
    return output.replace([np.inf, -np.inf], np.nan)


def lagged_feature_snapshot(
    frame: pd.DataFrame,
    periods: int = 1,
    lookbacks: tuple[int, ...] = _LOOKBACKS,
) -> pd.Series:
    if periods < 0:
        raise ValueError("periods must be non-negative")
    features = build_feature_library(frame, lookbacks).shift(periods)
    usable = features.dropna(how="all")
    if usable.empty:
        return pd.Series(dtype=float)
    return usable.iloc[-1]
