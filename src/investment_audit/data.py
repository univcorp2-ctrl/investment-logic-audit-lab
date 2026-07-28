from __future__ import annotations

import logging
import time
from collections.abc import Iterable
from pathlib import Path

import numpy as np
import pandas as pd

logger = logging.getLogger(__name__)
_MAX_RETRY = 3
_RETRY_WAIT_SEC = 2.0


def load_price_csv(path: str | Path, date_col: str = "date") -> pd.DataFrame:
    """Load a wide adjusted-close CSV indexed by date."""

    source = Path(path)
    if not source.exists():
        raise FileNotFoundError(f"価格CSVファイルが見つかりません: {source}")
    frame = pd.read_csv(source)
    if date_col not in frame.columns:
        raise ValueError(
            f"CSVに '{date_col}' 列が必要です。実際の列名: {list(frame.columns)}"
        )
    frame[date_col] = pd.to_datetime(frame[date_col], errors="raise", utc=False)
    prices = frame.set_index(date_col).sort_index()
    prices = prices.apply(pd.to_numeric, errors="coerce").replace([np.inf, -np.inf], np.nan)
    prices = prices.dropna(how="all").ffill()
    if prices.empty:
        raise ValueError(f"{source} に有効な数値価格列が見つかりませんでした。")
    return prices


def download_prices(
    tickers: Iterable[str],
    start: str = "2018-01-01",
    end: str | None = None,
    interval: str = "1d",
    dry_run: bool = False,
) -> pd.DataFrame:
    """Download adjusted prices with yfinance and bounded retry handling."""

    symbols = [str(ticker) for ticker in tickers]
    if not symbols:
        raise ValueError("tickers が空です。1つ以上の銘柄を指定してください。")
    if dry_run:
        return pd.DataFrame()
    try:
        import yfinance as yf
    except ImportError as exc:
        raise ImportError(
            "yfinance がインストールされていません。pip install yfinance を実行してください。"
        ) from exc

    raw: pd.DataFrame | None = None
    for attempt in range(1, _MAX_RETRY + 1):
        try:
            raw = yf.download(
                symbols,
                start=start,
                end=end,
                interval=interval,
                auto_adjust=True,
                progress=False,
            )
            break
        except Exception as exc:
            if attempt == _MAX_RETRY:
                raise RuntimeError(
                    f"価格データのダウンロードに {_MAX_RETRY} 回失敗しました。"
                ) from exc
            logger.warning("価格取得失敗。再試行します: attempt=%d", attempt)
            time.sleep(_RETRY_WAIT_SEC)
    if raw is None:
        raise RuntimeError("価格データ取得結果がありません。")

    if isinstance(raw.columns, pd.MultiIndex):
        level_zero = raw.columns.get_level_values(0)
        label = "Close" if "Close" in level_zero else "Adj Close"
        prices = raw.loc[:, level_zero == label].copy()
        prices.columns = [
            column[1] if isinstance(column, tuple) and len(column) > 1 else str(column)
            for column in prices.columns
        ]
    elif "Close" in raw.columns:
        prices = raw[["Close"]].copy()
        if len(symbols) == 1:
            prices.columns = symbols
    else:
        prices = raw.copy()

    prices = prices.apply(pd.to_numeric, errors="coerce")
    prices = prices.replace([np.inf, -np.inf], np.nan).dropna(how="all").ffill()
    if prices.empty:
        raise ValueError(f"指定した銘柄 {symbols} の価格データを取得できませんでした。")
    return prices


def validate_prices(prices: pd.DataFrame, min_periods: int = 252) -> None:
    """Validate shape, history length, finiteness, and positive prices."""

    if prices.empty:
        raise ValueError("prices が空です。")
    if len(prices) < min_periods:
        raise ValueError(
            f"データが不足しています: {len(prices)}行 < 必要最低{min_periods}行。"
        )
    numeric = prices.apply(pd.to_numeric, errors="coerce")
    if np.isinf(numeric.to_numpy(dtype=float, na_value=np.nan)).any():
        raise ValueError("無限大の価格が含まれています。")
    if (numeric <= 0).any().any():
        invalid = numeric.columns[(numeric <= 0).any()].tolist()
        raise ValueError(f"0以下の価格が含まれる銘柄: {invalid}")


def make_synthetic_market(
    days: int = 1000,
    seed: int = 20260621,
    start: str = "2022-01-03",
) -> pd.DataFrame:
    """Return deterministic offline prices for examples and regression tests.

    The three paths intentionally represent a broad market, a higher-quality
    compounder, and a choppy sideways name.  The generator uses only prior
    shocks and never reads network data.
    """

    if days < 2:
        raise ValueError("days must be at least 2")
    rng = np.random.default_rng(seed)
    index = pd.date_range(start, periods=days, freq="B", name="date")
    common = rng.normal(0.00025, 0.0070, days)
    quality_noise = rng.normal(0.0, 0.0045, days)
    sideways_noise = rng.normal(0.0, 0.0100, days)
    cycle = np.sin(np.arange(days) / 24.0)

    log_returns = pd.DataFrame(
        {
            "SPY_SIM": common,
            "QUALITY_SIM": 0.00045 + 0.55 * common + quality_noise,
            "SIDEWAYS_SIM": -0.00002 + 0.0008 * cycle + sideways_noise,
        },
        index=index,
    )
    prices = 100.0 * np.exp(log_returns.cumsum())
    prices.iloc[0] = 100.0
    return prices.astype(float)


def make_synthetic_fundamentals() -> pd.DataFrame:
    """Return deterministic fundamentals compatible with legacy and new scorers."""

    return pd.DataFrame(
        {
            "sector": ["Broad Market", "Industrials", "Consumer"],
            "pe": [19.0, 14.0, 31.0],
            "pb": [3.2, 2.1, 5.4],
            "debt_to_equity": [0.75, 0.28, 1.65],
            "roe": [0.16, 0.25, 0.07],
            "revenue_growth": [0.06, 0.13, -0.02],
            "free_cash_flow_margin": [0.12, 0.19, 0.03],
            "gross_margin": [0.43, 0.52, 0.27],
            "market_cap": [1_000_000.0, 180_000.0, 65_000.0],
            "enterprise_value": [1_050_000.0, 170_000.0, 90_000.0],
            "net_income": [52_000.0, 14_000.0, 1_200.0],
            "book_value": [310_000.0, 86_000.0, 12_000.0],
            "free_cash_flow": [48_000.0, 18_500.0, -900.0],
            "ebitda": [82_000.0, 22_000.0, 3_200.0],
            "dividends": [16_000.0, 3_500.0, 400.0],
            "buybacks": [9_000.0, 2_000.0, -1_000.0],
            "net_cash": [-50_000.0, 20_000.0, -24_000.0],
            "revenue": [520_000.0, 108_000.0, 44_000.0],
            "gross_profit": [224_000.0, 56_000.0, 12_000.0],
            "operating_income": [78_000.0, 21_000.0, 1_100.0],
            "operating_cash_flow": [65_000.0, 20_000.0, 400.0],
            "total_assets": [900_000.0, 145_000.0, 78_000.0],
            "invested_capital": [600_000.0, 92_000.0, 58_000.0],
            "total_debt": [140_000.0, 18_000.0, 46_000.0],
            "eps_growth": [0.07, 0.15, -0.12],
            "fcf_growth": [0.05, 0.17, -0.25],
            "margin_stability": [0.78, 0.91, 0.32],
            "earnings_volatility": [0.20, 0.10, 0.72],
            "earnings_stability": [0.80, 0.93, 0.25],
            "fcf_stability": [0.76, 0.90, 0.15],
            "share_count_growth": [-0.01, -0.02, 0.08],
            "debt_to_ebitda_change": [-0.05, -0.20, 0.65],
            "operating_margin_change": [0.005, 0.018, -0.055],
            "negative_earnings_years": [0, 0, 1],
            "negative_fcf_years": [0, 0, 2],
            "average_daily_value": [3_000_000_000.0, 450_000_000.0, 35_000_000.0],
        },
        index=pd.Index(["SPY_SIM", "QUALITY_SIM", "SIDEWAYS_SIM"], name="symbol"),
    )
