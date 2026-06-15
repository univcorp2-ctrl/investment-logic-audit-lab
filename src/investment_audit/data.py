from __future__ import annotations

from pathlib import Path
from typing import Iterable

import numpy as np
import pandas as pd


def load_price_csv(path: str | Path, date_col: str = "date") -> pd.DataFrame:
    """Load a wide CSV of close prices."""
    df = pd.read_csv(path)
    if date_col not in df.columns:
        raise ValueError(f"CSV must contain a '{date_col}' column")
    df[date_col] = pd.to_datetime(df[date_col], utc=False)
    prices = df.set_index(date_col).sort_index()
    prices = prices.apply(pd.to_numeric, errors="coerce").dropna(how="all")
    if prices.empty:
        raise ValueError("No usable numeric price columns found")
    return prices.ffill()


def download_prices(
    tickers: Iterable[str],
    start: str = "2018-01-01",
    end: str | None = None,
    interval: str = "1d",
) -> pd.DataFrame:
    """Download adjusted close prices using yfinance.

    This function is isolated so tests do not depend on network access.
    """
    import yfinance as yf

    tickers = list(tickers)
    if not tickers:
        raise ValueError("At least one ticker is required")
    raw = yf.download(tickers, start=start, end=end, interval=interval, auto_adjust=True, progress=False)
    if isinstance(raw.columns, pd.MultiIndex):
        prices = raw["Close"] if "Close" in raw.columns.get_level_values(0) else raw.xs("Close", axis=1, level=1)
    else:
        prices = raw.to_frame(name=tickers[0]) if isinstance(raw, pd.Series) else raw[["Close"]]
        prices.columns = tickers
    prices.index = pd.to_datetime(prices.index)
    return prices.dropna(how="all").ffill()


def make_synthetic_market(days: int = 1_000, seed: int = 7) -> pd.DataFrame:
    """Create deterministic synthetic prices with trend, crash, and sideways regimes."""
    rng = np.random.default_rng(seed)
    index = pd.bdate_range("2020-01-01", periods=days)
    regimes = np.zeros(days)
    regimes[: days // 3] = 0.0006
    regimes[days // 3 : 2 * days // 3] = -0.0002
    regimes[2 * days // 3 :] = 0.00035
    vol = np.linspace(0.008, 0.018, days)
    common = regimes + rng.normal(0, vol)
    data = {
        "SPY_SIM": common + rng.normal(0.0001, 0.004, days),
        "BTC_SIM": 1.25 * common + rng.normal(0.0004, 0.028, days),
        "ETH_SIM": 1.40 * common + rng.normal(0.0005, 0.032, days),
        "QUALITY_SIM": 0.00045 + rng.normal(0, 0.007, days),
        "SIDEWAYS_SIM": rng.normal(0.00005, 0.010, days),
    }
    returns = pd.DataFrame(data, index=index)
    returns.loc[index[120:320], "BTC_SIM"] += 0.0014
    returns.loc[index[520:660], "BTC_SIM"] -= 0.0020
    returns.loc[index[700:900], "QUALITY_SIM"] += 0.0009
    return 100 * (1 + returns).cumprod()


def make_synthetic_fundamentals() -> pd.DataFrame:
    """Create a small fundamentals table for sample reports."""
    return pd.DataFrame(
        {
            "ticker": ["SPY_SIM", "BTC_SIM", "ETH_SIM", "QUALITY_SIM", "SIDEWAYS_SIM"],
            "pe": [21.0, np.nan, np.nan, 14.0, 45.0],
            "pb": [4.0, np.nan, np.nan, 2.1, 9.0],
            "roe": [0.16, np.nan, np.nan, 0.28, 0.04],
            "debt_to_equity": [0.8, np.nan, np.nan, 0.25, 2.5],
            "revenue_growth": [0.07, np.nan, np.nan, 0.18, -0.02],
        }
    ).set_index("ticker")
