from __future__ import annotations

import numpy as np
import pandas as pd


def time_series_momentum(
    prices: pd.DataFrame,
    lookback: int = 126,
    skip: int = 1,
    long_only: bool = False,
) -> pd.DataFrame:
    """Sign of prior return, using a skip day to reduce same-close lookahead risk."""
    if lookback <= 0 or skip < 0:
        raise ValueError("lookback must be > 0 and skip must be >= 0")
    momentum = prices.shift(skip) / prices.shift(lookback + skip) - 1
    signal = np.sign(momentum).replace([np.inf, -np.inf], np.nan).fillna(0)
    if long_only:
        signal = signal.clip(lower=0)
    return signal.astype(float)


def moving_average_trend(
    prices: pd.DataFrame,
    fast: int = 50,
    slow: int = 200,
    long_only: bool = True,
) -> pd.DataFrame:
    """Classic fast/slow moving-average trend signal."""
    if fast <= 0 or slow <= 0 or fast >= slow:
        raise ValueError("fast and slow must be positive and fast < slow")
    fast_ma = prices.rolling(fast, min_periods=fast).mean()
    slow_ma = prices.rolling(slow, min_periods=slow).mean()
    raw = np.sign(fast_ma - slow_ma).fillna(0)
    if long_only:
        raw = raw.clip(lower=0)
    return raw.astype(float)


def cross_sectional_momentum(
    prices: pd.DataFrame,
    lookback: int = 126,
    top_quantile: float = 0.30,
    bottom_quantile: float = 0.30,
    long_short: bool = True,
) -> pd.DataFrame:
    """Rank assets by prior return and hold winners; optionally short losers."""
    if not 0 < top_quantile <= 1 or not 0 <= bottom_quantile < 1:
        raise ValueError("quantiles must be in valid ranges")
    returns = prices / prices.shift(lookback) - 1
    ranks = returns.rank(axis=1, pct=True)
    signal = pd.DataFrame(0.0, index=prices.index, columns=prices.columns)
    signal[ranks >= 1 - top_quantile] = 1.0
    if long_short and bottom_quantile > 0:
        signal[ranks <= bottom_quantile] = -1.0
    return signal.fillna(0)


def fundamental_quality_value_momentum(
    fundamentals: pd.DataFrame,
    price_momentum: pd.Series | None = None,
) -> pd.Series:
    """Composite score: cheap, high quality, low leverage, growth, and momentum."""
    if fundamentals.empty:
        raise ValueError("fundamentals must not be empty")
    scores: list[pd.Series] = []
    for col in ["pe", "pb", "debt_to_equity"]:
        if col in fundamentals:
            scores.append(1 - fundamentals[col].rank(pct=True, na_option="keep"))
    for col in ["roe", "revenue_growth", "free_cash_flow_margin", "gross_margin"]:
        if col in fundamentals:
            scores.append(fundamentals[col].rank(pct=True, na_option="keep"))
    if price_momentum is not None:
        scores.append(price_momentum.rank(pct=True, na_option="keep"))
    if not scores:
        raise ValueError("No supported fundamental columns were found")
    combined = pd.concat(scores, axis=1).mean(axis=1, skipna=True)
    return combined.sort_values(ascending=False)


def top_fundamental_signal(scores: pd.Series, top_n: int = 10) -> pd.Series:
    """Convert a fundamental score into long-only positions."""
    if top_n <= 0:
        raise ValueError("top_n must be positive")
    signal = pd.Series(0.0, index=scores.index)
    signal.loc[scores.nlargest(min(top_n, len(scores))).index] = 1.0
    return signal
