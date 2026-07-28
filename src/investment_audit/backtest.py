from __future__ import annotations

import logging
from dataclasses import dataclass

import numpy as np
import pandas as pd

TRADING_DAYS = 252
logger = logging.getLogger(__name__)


@dataclass(frozen=True)
class BacktestResult:
    returns: pd.Series
    equity: pd.Series
    weights: pd.DataFrame
    metrics: dict[str, float]


def _normalize_weights(raw: pd.DataFrame, max_gross: float = 1.0) -> pd.DataFrame:
    if max_gross <= 0:
        raise ValueError("max_gross must be positive")
    clean = raw.replace([np.inf, -np.inf], np.nan).fillna(0.0).astype(float)
    gross = clean.abs().sum(axis="columns")
    scale = pd.Series(1.0, index=clean.index)
    needs_scale = gross > max_gross
    scale.loc[needs_scale] = max_gross / gross.loc[needs_scale]
    return clean.mul(scale, axis="index")


def max_drawdown(equity: pd.Series) -> float:
    if equity.empty:
        return 0.0
    peak = equity.cummax()
    drawdown = equity / peak - 1.0
    return float(drawdown.min())


def metrics_from_returns(
    returns: pd.Series,
    turnover: pd.Series | None = None,
) -> dict[str, float]:
    clean = pd.to_numeric(returns, errors="coerce").replace([np.inf, -np.inf], np.nan).dropna()
    names = [
        "total_return",
        "annual_return",
        "annual_vol",
        "sharpe",
        "max_drawdown",
        "hit_rate",
        "avg_turnover",
    ]
    if clean.empty:
        return {name: float("nan") for name in names}
    equity = (1.0 + clean).cumprod()
    years = len(clean) / TRADING_DAYS
    total_return = float(equity.iloc[-1] - 1.0)
    annual_return = (
        float(equity.iloc[-1] ** (1.0 / years) - 1.0) if years > 0 else float("nan")
    )
    annual_vol = float(clean.std(ddof=1) * np.sqrt(TRADING_DAYS))
    sharpe = annual_return / annual_vol if annual_vol > 0 else float("nan")
    avg_turnover = float(turnover.mean()) if turnover is not None else float("nan")
    return {
        "total_return": total_return,
        "annual_return": annual_return,
        "annual_vol": annual_vol,
        "sharpe": sharpe,
        "max_drawdown": max_drawdown(equity),
        "hit_rate": float((clean > 0).mean()),
        "avg_turnover": avg_turnover,
    }


def run_backtest(
    prices: pd.DataFrame,
    signals: pd.DataFrame,
    cost_bps: float = 5.0,
    slippage_bps: float = 2.0,
    max_gross: float = 1.0,
    dry_run: bool = False,
) -> BacktestResult:
    """Run a close-to-close backtest with signals executed one period later."""

    if prices.empty:
        raise ValueError("prices は空にできません。価格データを確認してください。")
    if cost_bps < 0 or slippage_bps < 0:
        raise ValueError("cost_bps and slippage_bps must be non-negative")
    unknown_columns = set(signals.columns) - set(prices.columns)
    if unknown_columns:
        raise ValueError(f"signals に未知の銘柄が含まれています: {sorted(unknown_columns)}")
    if dry_run:
        empty = pd.Series(dtype=float)
        return BacktestResult(
            returns=empty,
            equity=empty,
            weights=pd.DataFrame(),
            metrics=metrics_from_returns(empty),
        )

    clean_prices = prices.sort_index().apply(pd.to_numeric, errors="coerce")
    clean_prices = clean_prices.replace([np.inf, -np.inf], np.nan).ffill().dropna(how="all")
    aligned_signals = signals.reindex(
        index=clean_prices.index,
        columns=clean_prices.columns,
    ).fillna(0.0)
    asset_returns = clean_prices.pct_change(fill_method=None).replace(
        [np.inf, -np.inf], np.nan
    ).fillna(0.0)
    target_weights = _normalize_weights(aligned_signals, max_gross=max_gross)
    weights = target_weights.shift(1).fillna(0.0)
    gross_returns = weights.mul(asset_returns).sum(axis="columns")
    turnover = weights.diff().abs().sum(axis="columns")
    turnover = turnover.fillna(weights.abs().sum(axis="columns"))
    costs = turnover * ((cost_bps + slippage_bps) / 10_000.0)
    net_returns = gross_returns - costs
    equity = (1.0 + net_returns).cumprod()
    metrics = metrics_from_returns(net_returns, turnover)
    return BacktestResult(
        returns=net_returns,
        equity=equity,
        weights=weights,
        metrics=metrics,
    )


def fee_sensitivity(
    prices: pd.DataFrame,
    signals: pd.DataFrame,
    fee_grid_bps: list[float] | None = None,
) -> pd.DataFrame:
    grid = fee_grid_bps if fee_grid_bps is not None else [0, 5, 10, 25, 50, 100]
    rows: list[dict[str, float]] = []
    for fee in grid:
        result = run_backtest(
            prices,
            signals,
            cost_bps=float(fee),
            slippage_bps=float(fee) / 2.0,
        )
        rows.append({"fee_bps": float(fee), **result.metrics})
    return pd.DataFrame(rows)
