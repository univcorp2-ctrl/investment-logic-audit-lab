from __future__ import annotations

from dataclasses import dataclass

import numpy as np
import pandas as pd

from .backtest import max_drawdown


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
    index = pd.to_datetime(cleaned.index, errors="coerce", utc=True)
    cleaned.index = index.tz_convert(None)
    cleaned = cleaned.loc[~cleaned.index.isna()]
    cleaned = cleaned[~cleaned.index.duplicated(keep="last")].sort_index()
    cleaned = cleaned.apply(pd.to_numeric, errors="coerce").replace([np.inf, -np.inf], np.nan)
    return cleaned


def _rebalance_mask(index: pd.DatetimeIndex, frequency: str) -> pd.Series:
    if frequency == "monthly":
        period = index.to_period("M")
    elif frequency == "weekly":
        period = index.to_period("W-FRI")
    else:
        raise ValueError("rebalance must be 'monthly' or 'weekly'")
    return pd.Series(period != pd.Series(period, index=index).shift(-1).to_numpy(), index=index)


def _performance_metrics(
    returns: pd.Series,
    turnover: pd.Series,
    benchmark_returns: pd.Series,
    annualization_days: int,
    weights: pd.DataFrame,
) -> dict[str, float]:
    clean = returns.dropna()
    if clean.empty:
        return {name: float("nan") for name in (
            "cagr", "annualized_volatility", "sharpe", "sortino", "calmar",
            "max_drawdown", "turnover", "hit_rate", "exposure", "benchmark_excess_cagr"
        )}
    equity = (1.0 + clean).cumprod()
    years = len(clean) / annualization_days
    cagr = float(equity.iloc[-1] ** (1.0 / years) - 1.0) if years > 0 else float("nan")
    volatility = float(clean.std(ddof=1) * np.sqrt(annualization_days))
    sharpe = cagr / volatility if volatility > 0 else float("nan")
    downside = clean.clip(upper=0.0)
    downside_deviation = float(np.sqrt((downside.pow(2).mean())) * np.sqrt(annualization_days))
    sortino = cagr / downside_deviation if downside_deviation > 0 else float("nan")
    drawdown = max_drawdown(equity)
    calmar = cagr / abs(drawdown) if drawdown < 0 else float("nan")
    benchmark = benchmark_returns.reindex(clean.index).fillna(0.0)
    benchmark_equity = (1.0 + benchmark).cumprod()
    benchmark_cagr = (
        float(benchmark_equity.iloc[-1] ** (1.0 / years) - 1.0) if years > 0 else float("nan")
    )
    return {
        "cagr": cagr,
        "annualized_volatility": volatility,
        "sharpe": sharpe,
        "sortino": sortino,
        "calmar": calmar,
        "max_drawdown": drawdown,
        "turnover": float(turnover.mean()),
        "hit_rate": float((clean > 0).mean()),
        "exposure": float(weights.abs().sum(axis=1).mean()),
        "benchmark_excess_cagr": cagr - benchmark_cagr,
    }


def run_ranked_portfolio(
    prices: pd.DataFrame,
    scores: pd.DataFrame,
    config: RankedPortfolioConfig | None = None,
) -> RankedPortfolioResult:
    """Backtest point-in-time rankings with publication lag and next-day execution."""

    config = config or RankedPortfolioConfig()
    if config.top_n < 1:
        raise ValueError("top_n must be positive")
    prices = _clean_wide(prices, "prices").ffill()
    scores = _clean_wide(scores, "scores").reindex(index=prices.index, columns=prices.columns).ffill()
    lagged_scores = scores.shift(config.fundamental_lag_days)
    target = pd.DataFrame(np.nan, index=prices.index, columns=prices.columns, dtype=float)
    rebalance = _rebalance_mask(prices.index, config.rebalance)
    for date in prices.index[rebalance]:
        available = lagged_scores.loc[date].dropna().sort_values(ascending=False).head(config.top_n)
        if available.empty:
            target.loc[date] = 0.0
            continue
        if config.weighting == "equal":
            weights = pd.Series(1.0 / len(available), index=available.index)
        elif config.weighting == "score":
            positive = (available - available.min() + 1e-9).clip(lower=0.0)
            weights = positive / positive.sum()
        else:
            raise ValueError("weighting must be 'equal' or 'score'")
        weights = weights.clip(upper=config.max_position)
        row = pd.Series(0.0, index=prices.columns)
        row.loc[weights.index] = weights
        target.loc[date] = row
    target = target.ffill().fillna(0.0)
    weights = target.shift(1).fillna(0.0)
    asset_returns = prices.pct_change(fill_method=None).replace([np.inf, -np.inf], np.nan).fillna(0.0)
    gross_returns = (weights * asset_returns).sum(axis=1)
    turnover = weights.diff().abs().sum(axis=1).fillna(weights.abs().sum(axis=1))
    costs = turnover * ((config.cost_bps + config.slippage_bps) / 10_000.0)
    net_returns = gross_returns - costs
    equity = (1.0 + net_returns).cumprod()
    benchmark_returns = asset_returns.mean(axis=1)
    metrics = _performance_metrics(
        net_returns,
        turnover,
        benchmark_returns,
        config.annualization_days,
        weights,
    )
    return RankedPortfolioResult(
        returns=net_returns,
        equity=equity,
        weights=weights,
        turnover=turnover,
        benchmark_returns=benchmark_returns,
        metrics=metrics,
    )


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
                    RankedPortfolioConfig(
                        top_n=top_n,
                        cost_bps=cost,
                        fundamental_lag_days=lag,
                    ),
                )
                rows.append({"top_n": top_n, "cost_bps": cost, "lag_days": lag, **result.metrics})
    table = pd.DataFrame(rows)
    table.attrs["positive_sharpe_ratio"] = float((table["sharpe"] > 0).mean())
    table.attrs["median_sharpe"] = float(table["sharpe"].median())
    table.attrs["worst_max_drawdown"] = float(table["max_drawdown"].min())
    return table
