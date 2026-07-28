from __future__ import annotations

from dataclasses import dataclass

import numpy as np
import pandas as pd

from .allocation import HRPConfig, hrp_weights
from .backtest import max_drawdown
from .risk_metrics import extended_risk_metrics


@dataclass(frozen=True)
class RankedPortfolioConfig:
    top_n: int = 10
    rebalance: str = "monthly"
    weighting: str = "equal"
    fundamental_lag_days: int = 1
    cost_bps: float = 5.0
    slippage_bps: float = 2.0
    max_position: float = 1.0
    annualization_days: int = 252
    hrp_minimum_history: int = 60


@dataclass(frozen=True)
class RankedPortfolioResult:
    returns: pd.Series
    equity: pd.Series
    weights: pd.DataFrame
    turnover: pd.Series
    benchmark_returns: pd.Series
    metrics: dict[str, float]


def _clean_wide(frame: pd.DataFrame, name: str) -> pd.DataFrame:
    if frame.empty:
        raise ValueError(f"{name} must not be empty")
    cleaned = frame.copy()
    index = pd.DatetimeIndex(pd.to_datetime(cleaned.index, errors="coerce", utc=True))
    cleaned.index = index.tz_convert(None)
    cleaned = cleaned.iloc[np.flatnonzero(cleaned.index.notna())]
    cleaned = cleaned.iloc[np.flatnonzero(~cleaned.index.duplicated(keep="last"))].sort_index()
    return cleaned.apply(pd.to_numeric, errors="coerce").replace([np.inf, -np.inf], np.nan)


def _rebalance_mask(index: pd.DatetimeIndex, frequency: str) -> pd.Series:
    if frequency == "monthly":
        periods = index.to_period("M")
    elif frequency == "weekly":
        periods = index.to_period("W-FRI")
    else:
        raise ValueError("rebalance must be 'monthly' or 'weekly'")
    series = pd.Series(periods, index=index)
    return series.ne(series.shift(-1))


def _performance_metrics(
    returns: pd.Series,
    turnover: pd.Series,
    benchmark_returns: pd.Series,
    annualization_days: int,
    weights: pd.DataFrame,
) -> dict[str, float]:
    clean = returns.dropna()
    if clean.empty:
        return extended_risk_metrics(clean)
    equity = (1.0 + clean).cumprod()
    years = len(clean) / annualization_days
    cagr = float(equity.iloc[-1] ** (1.0 / years) - 1.0) if years > 0 else float("nan")
    volatility = float(clean.std(ddof=1) * np.sqrt(annualization_days))
    downside = clean.clip(upper=0.0)
    downside_deviation = float(np.sqrt(downside.pow(2).mean()) * np.sqrt(annualization_days))
    drawdown = max_drawdown(equity)
    benchmark = benchmark_returns.reindex(clean.index).fillna(0.0)
    benchmark_equity = (1.0 + benchmark).cumprod()
    benchmark_cagr = float(benchmark_equity.iloc[-1] ** (1.0 / years) - 1.0) if years > 0 else float("nan")
    metrics = {
        "cagr": cagr,
        "annualized_volatility": volatility,
        "sharpe": cagr / volatility if volatility > 0 else float("nan"),
        "sortino": cagr / downside_deviation if downside_deviation > 0 else float("nan"),
        "calmar": cagr / abs(drawdown) if drawdown < 0 else float("nan"),
        "max_drawdown": drawdown,
        "turnover": float(turnover.mean()),
        "hit_rate": float((clean > 0).mean()),
        "exposure": float(weights.abs().sum(axis="columns").mean()),
        "benchmark_excess_cagr": cagr - benchmark_cagr,
    }
    metrics.update(extended_risk_metrics(clean))
    return metrics


def run_ranked_portfolio(
    prices: pd.DataFrame,
    scores: pd.DataFrame,
    config: RankedPortfolioConfig | None = None,
) -> RankedPortfolioResult:
    config = config or RankedPortfolioConfig()
    if config.top_n < 1:
        raise ValueError("top_n must be positive")
    prices = _clean_wide(prices, "prices").ffill()
    scores = _clean_wide(scores, "scores").reindex(index=prices.index, columns=prices.columns).ffill()
    lagged_scores = scores.shift(config.fundamental_lag_days)
    target = pd.DataFrame(np.nan, index=prices.index, columns=prices.columns, dtype=float)
    mask = _rebalance_mask(pd.DatetimeIndex(prices.index), config.rebalance)
    for date in prices.index[mask.to_numpy(dtype=bool)]:
        available = lagged_scores.loc[[date]].iloc[0].dropna().sort_values(ascending=False).head(config.top_n)
        if available.empty:
            target.loc[date] = 0.0
            continue
        if config.weighting == "equal":
            selection = pd.Series(1.0 / len(available), index=available.index)
        elif config.weighting == "score":
            positive = (available - available.min() + 1e-9).clip(lower=0.0)
            selection = positive / positive.sum()
        elif config.weighting == "hrp":
            history = prices.loc[prices.index < date, available.index].pct_change(fill_method=None)
            selection = hrp_weights(
                history,
                HRPConfig(
                    minimum_history=config.hrp_minimum_history,
                    max_position=config.max_position,
                ),
            )
            if selection.empty:
                selection = pd.Series(1.0 / len(available), index=available.index)
        else:
            raise ValueError("weighting must be 'equal', 'score', or 'hrp'")
        selection = selection.reindex(available.index).fillna(0.0)
        if selection.sum() > 0:
            selection = selection / selection.sum()
        row = pd.Series(0.0, index=prices.columns)
        row.loc[selection.index] = selection
        target.loc[date] = row
    target = target.ffill().fillna(0.0)
    weights = target.shift(1).fillna(0.0)
    asset_returns = prices.pct_change(fill_method=None).replace([np.inf, -np.inf], np.nan).fillna(0.0)
    turnover = weights.diff().abs().sum(axis="columns").fillna(weights.abs().sum(axis="columns"))
    costs = turnover * ((config.cost_bps + config.slippage_bps) / 10_000.0)
    net_returns = weights.mul(asset_returns).sum(axis="columns") - costs
    equity = (1.0 + net_returns).cumprod()
    benchmark_returns = asset_returns.mean(axis="columns")
    metrics = _performance_metrics(net_returns, turnover, benchmark_returns, config.annualization_days, weights)
    return RankedPortfolioResult(net_returns, equity, weights, turnover, benchmark_returns, metrics)


def robustness_summary(
    prices: pd.DataFrame,
    scores: pd.DataFrame,
    top_n_grid: tuple[int, ...] = (5, 10, 20),
    cost_grid_bps: tuple[float, ...] = (0.0, 5.0, 15.0),
    lag_grid_days: tuple[int, ...] = (1, 5, 20),
) -> pd.DataFrame:
    rows: list[dict[str, float | int]] = []
    for top_n in top_n_grid:
        for cost in cost_grid_bps:
            for lag in lag_grid_days:
                result = run_ranked_portfolio(
                    prices,
                    scores,
                    RankedPortfolioConfig(top_n=top_n, cost_bps=cost, fundamental_lag_days=lag),
                )
                rows.append({"top_n": top_n, "cost_bps": cost, "lag_days": lag, **result.metrics})
    table = pd.DataFrame(rows)
    table.attrs["positive_sharpe_ratio"] = float((table["sharpe"] > 0).mean())
    table.attrs["median_sharpe"] = float(table["sharpe"].median())
    table.attrs["worst_max_drawdown"] = float(table["max_drawdown"].min())
    return table
