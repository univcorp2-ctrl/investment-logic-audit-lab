from __future__ import annotations

from dataclasses import dataclass

import numpy as np
import pandas as pd

TRADING_DAYS = 252


@dataclass(frozen=True)
class BacktestResult:
    returns: pd.Series
    equity: pd.Series
    weights: pd.DataFrame
    metrics: dict[str, float]


def _normalize_weights(raw: pd.DataFrame, max_gross: float = 1.0) -> pd.DataFrame:
    raw = raw.replace([np.inf, -np.inf], np.nan).fillna(0.0).astype(float)
    gross = raw.abs().sum(axis=1)
    scale = pd.Series(1.0, index=raw.index)
    needs_scale = gross > max_gross
    scale.loc[needs_scale] = max_gross / gross.loc[needs_scale]
    return raw.mul(scale, axis=0)


def max_drawdown(equity: pd.Series) -> float:
    if equity.empty:
        return 0.0
    peak = equity.cummax()
    drawdown = equity / peak - 1
    return float(drawdown.min())


def metrics_from_returns(returns: pd.Series, turnover: pd.Series | None = None) -> dict[str, float]:
    returns = returns.dropna()
    if returns.empty:
        return {
            "total_return": 0.0,
            "annual_return": 0.0,
            "annual_vol": 0.0,
            "sharpe": 0.0,
            "max_drawdown": 0.0,
            "hit_rate": 0.0,
            "avg_turnover": 0.0,
        }
    equity = (1 + returns).cumprod()
    total_return = float(equity.iloc[-1] - 1)
    years = max(len(returns) / TRADING_DAYS, 1 / TRADING_DAYS)
    annual_return = float(equity.iloc[-1] ** (1 / years) - 1)
    annual_vol = float(returns.std(ddof=0) * np.sqrt(TRADING_DAYS))
    sharpe = float(annual_return / annual_vol) if annual_vol > 0 else 0.0
    hit_rate = float((returns > 0).mean())
    avg_turnover = float(turnover.reindex(returns.index).mean()) if turnover is not None else 0.0
    return {
        "total_return": total_return,
        "annual_return": annual_return,
        "annual_vol": annual_vol,
        "sharpe": sharpe,
        "max_drawdown": max_drawdown(equity),
        "hit_rate": hit_rate,
        "avg_turnover": avg_turnover,
    }


def run_backtest(
    prices: pd.DataFrame,
    signals: pd.DataFrame,
    cost_bps: float = 5.0,
    slippage_bps: float = 2.0,
    max_gross: float = 1.0,
) -> BacktestResult:
    """Vectorized close-to-close backtest with next-day signal application."""
    if prices.empty:
        raise ValueError("prices must not be empty")
    missing = set(signals.columns) - set(prices.columns)
    if missing:
        raise ValueError(f"signals contain unknown price columns: {sorted(missing)}")
    prices = prices.sort_index().ffill().dropna(how="all")
    signals = signals.reindex(index=prices.index, columns=prices.columns).fillna(0.0)
    asset_returns = prices.pct_change().replace([np.inf, -np.inf], np.nan).fillna(0.0)
    target_weights = _normalize_weights(signals, max_gross=max_gross)
    weights = target_weights.shift(1).fillna(0.0)
    gross_turnover = weights.diff().abs().sum(axis=1).fillna(weights.abs().sum(axis=1))
    gross_returns = (weights * asset_returns).sum(axis=1)
    cost = gross_turnover * ((cost_bps + slippage_bps) / 10_000)
    net_returns = gross_returns - cost
    equity = (1 + net_returns).cumprod()
    metrics = metrics_from_returns(net_returns, gross_turnover)
    return BacktestResult(returns=net_returns, equity=equity, weights=weights, metrics=metrics)


def fee_sensitivity(
    prices: pd.DataFrame,
    signals: pd.DataFrame,
    fee_grid_bps: list[float] | None = None,
) -> pd.DataFrame:
    """Run the same strategy under several cost assumptions."""
    if fee_grid_bps is None:
        fee_grid_bps = [0, 5, 10, 25, 50, 100]
    rows = []
    for fee in fee_grid_bps:
        result = run_backtest(prices, signals, cost_bps=fee, slippage_bps=fee / 2)
        rows.append({"fee_bps": fee, **result.metrics})
    return pd.DataFrame(rows)
