from __future__ import annotations

import datetime as dt
import math
from dataclasses import asdict, dataclass
from typing import Any, Iterable, Mapping, Sequence

import numpy as np
import pandas as pd


@dataclass(frozen=True)
class PerformanceConfig:
    annualization_days: int = 252
    risk_free_rate_annual_pct: float = 0.0
    target_return_annual_pct: float = 0.0
    var_confidence: float = 0.95
    min_annualized_returns: int = 30
    min_long_horizon_returns: int = 126
    benchmark_symbol: str = "1306.T"

    def __post_init__(self) -> None:
        if self.annualization_days < 1:
            raise ValueError("annualization_days must be positive")
        if not 0.5 < self.var_confidence < 1.0:
            raise ValueError("var_confidence must be between 0.5 and 1")
        if self.min_annualized_returns < 2:
            raise ValueError("min_annualized_returns must be at least 2")
        if self.min_long_horizon_returns < self.min_annualized_returns:
            raise ValueError("min_long_horizon_returns must be >= min_annualized_returns")


Metric = dict[str, Any]


def _finite(value: Any) -> float | None:
    if value is None or value is pd.NA:
        return None
    try:
        parsed = float(value)
    except (TypeError, ValueError):
        return None
    return parsed if math.isfinite(parsed) else None


def _metric(
    value: float | int | None,
    *,
    available: int,
    required: int = 0,
    status: str = "ok",
    reason: str | None = None,
    unit: str | None = None,
) -> Metric:
    parsed = _finite(value)
    if value is None or (isinstance(value, float) and parsed is None):
        parsed = None
    elif isinstance(value, int):
        parsed = int(value)
    return {
        "value": parsed,
        "status": status,
        "reason": reason,
        "required_observations": required,
        "available_observations": available,
        "unit": unit,
    }


def _unavailable(reason: str, *, available: int, required: int, unit: str | None = None) -> Metric:
    return _metric(
        None,
        available=available,
        required=required,
        status="unavailable",
        reason=reason,
        unit=unit,
    )


def _history_frame(history: Sequence[Mapping[str, Any]]) -> pd.DataFrame:
    if not history:
        return pd.DataFrame(columns=["equity", "realized_pnl", "unrealized_pnl", "total_pnl"])
    frame = pd.DataFrame(history).copy()
    if "date" not in frame or "equity" not in frame:
        return pd.DataFrame(columns=["equity", "realized_pnl", "unrealized_pnl", "total_pnl"])
    frame["date"] = pd.to_datetime(frame["date"], errors="coerce")
    frame["equity"] = pd.to_numeric(frame["equity"], errors="coerce")
    frame = frame.loc[frame["date"].notna() & frame["equity"].gt(0)].copy()
    if frame.empty:
        return pd.DataFrame(columns=["equity", "realized_pnl", "unrealized_pnl", "total_pnl"])
    for column in ("realized_pnl", "unrealized_pnl", "total_pnl"):
        frame[column] = pd.to_numeric(frame.get(column), errors="coerce")
    frame["date"] = frame["date"].dt.tz_localize(None).dt.normalize()
    return frame.sort_values("date", kind="stable").drop_duplicates("date", keep="last").set_index("date")


def _benchmark_series(benchmark_history: Any) -> pd.Series:
    if benchmark_history is None:
        return pd.Series(dtype=float)
    if isinstance(benchmark_history, pd.Series):
        series = benchmark_history.copy()
    elif isinstance(benchmark_history, pd.DataFrame):
        column = "close" if "close" in benchmark_history else benchmark_history.columns[0]
        series = pd.to_numeric(benchmark_history[column], errors="coerce")
    else:
        frame = pd.DataFrame(benchmark_history)
        if frame.empty or "date" not in frame:
            return pd.Series(dtype=float)
        value_column = "close" if "close" in frame else "value" if "value" in frame else None
        if value_column is None:
            return pd.Series(dtype=float)
        frame["date"] = pd.to_datetime(frame["date"], errors="coerce")
        frame[value_column] = pd.to_numeric(frame[value_column], errors="coerce")
        frame = frame.loc[frame["date"].notna() & frame[value_column].notna()]
        series = frame.set_index("date")[value_column]
    if series.empty:
        return pd.Series(dtype=float)
    index = pd.to_datetime(series.index, errors="coerce")
    valid = ~pd.isna(index)
    series = pd.Series(pd.to_numeric(series.to_numpy(), errors="coerce"), index=index)
    series = series.loc[valid & series.notna()]
    if series.empty:
        return pd.Series(dtype=float)
    if isinstance(series.index, pd.DatetimeIndex) and series.index.tz is not None:
        series.index = series.index.tz_convert("Asia/Tokyo").tz_localize(None)
    series.index = pd.DatetimeIndex(series.index).normalize()
    return series.sort_index().groupby(level=0).last()


def _drawdown_details(equity: pd.Series) -> tuple[pd.Series, dict[str, int | None]]:
    if equity.empty:
        return pd.Series(dtype=float), {
            "max_duration": None,
            "current_duration": None,
            "max_recovery": None,
        }
    drawdown = equity / equity.cummax() - 1.0
    current = 0
    maximum = 0
    episode_start: int | None = None
    trough_index: int | None = None
    max_recovery: int | None = None
    episode_min = 0.0
    for index, value in enumerate(drawdown.to_numpy(dtype=float)):
        if value < -1e-15:
            current += 1
            maximum = max(maximum, current)
            if episode_start is None:
                episode_start = index
                episode_min = value
                trough_index = index
            elif value < episode_min:
                episode_min = value
                trough_index = index
        else:
            if episode_start is not None and trough_index is not None:
                recovery = index - trough_index
                max_recovery = recovery if max_recovery is None else max(max_recovery, recovery)
            current = 0
            episode_start = None
            trough_index = None
            episode_min = 0.0
    return drawdown, {
        "max_duration": maximum,
        "current_duration": current,
        "max_recovery": max_recovery,
    }


def _longest_streak(values: Iterable[bool]) -> int:
    longest = 0
    current = 0
    for value in values:
        current = current + 1 if value else 0
        longest = max(longest, current)
    return longest


def _metric_or_insufficient(
    value: float | None,
    *,
    available: int,
    required: int,
    label: str,
    unit: str | None = None,
) -> Metric:
    if available < required:
        return _unavailable(
            f"{label}には{required}観測が必要です（現在{available}）。",
            available=available,
            required=required,
            unit=unit,
        )
    if value is None or not math.isfinite(value):
        return _unavailable(
            f"{label}の分母または必要な変動がありません。",
            available=available,
            required=required,
            unit=unit,
        )
    return _metric(value, available=available, required=required, unit=unit)


def _closed_trade_statistics(
    trades: Sequence[Mapping[str, Any]],
    seed_positions: Sequence[Mapping[str, Any]],
) -> dict[str, Any]:
    seeds = {
        str(position.get("symbol")): {
            "cost": _finite(position.get("entry_price") or position.get("avg_cost")),
            "opened_at": position.get("entry_time") or position.get("opened_at"),
        }
        for position in seed_positions
    }
    returns: list[float] = []
    holding_days: list[int] = []
    for trade in trades:
        if str(trade.get("side")) not in {"SIM_SELL", "SELL"}:
            continue
        seed = seeds.get(str(trade.get("symbol")))
        price = _finite(trade.get("price"))
        if not seed or not seed["cost"] or price is None:
            continue
        returns.append(price / float(seed["cost"]) - 1.0)
        try:
            opened = pd.Timestamp(seed["opened_at"]).date()
            closed = pd.Timestamp(trade.get("date")).date()
            holding_days.append(max(0, (closed - opened).days))
        except (TypeError, ValueError):
            pass
    return {"returns": returns, "holding_days": holding_days}


def analyze_performance(
    history: Sequence[Mapping[str, Any]],
    trades: Sequence[Mapping[str, Any]],
    positions: Sequence[Mapping[str, Any]],
    summary: Mapping[str, Any],
    *,
    seed_positions: Sequence[Mapping[str, Any]] = (),
    benchmark_history: Any = None,
    benchmark_error: str | None = None,
    config: PerformanceConfig = PerformanceConfig(),
    generated_at: str | None = None,
) -> dict[str, Any]:
    frame = _history_frame(history)
    observations = len(frame)
    equity = pd.to_numeric(frame.get("equity", pd.Series(dtype=float)), errors="coerce").dropna()
    returns = equity.pct_change(fill_method=None).dropna()
    return_count = len(returns)
    drawdown, durations = _drawdown_details(equity)
    initial_equity = _finite(summary.get("seed_cost_basis"))
    if initial_equity is None:
        initial_equity = _finite(equity.iloc[0]) if not equity.empty else None
    final_equity = _finite(summary.get("equity"))
    if final_equity is None:
        final_equity = _finite(equity.iloc[-1]) if not equity.empty else None
    total_return = (
        (final_equity / initial_equity - 1.0) * 100
        if initial_equity and final_equity is not None
        else None
    )
    latest_daily_return = _finite(returns.iloc[-1] * 100) if not returns.empty else None

    risk_free_daily = (1 + config.risk_free_rate_annual_pct / 100) ** (1 / config.annualization_days) - 1
    target_daily = (1 + config.target_return_annual_pct / 100) ** (1 / config.annualization_days) - 1
    excess = returns - risk_free_daily
    annualized_vol = float(returns.std(ddof=0) * math.sqrt(config.annualization_days) * 100) if return_count else None
    annualized_excess = float(excess.mean() * config.annualization_days * 100) if return_count else None
    sharpe = (
        float(excess.mean() / returns.std(ddof=0) * math.sqrt(config.annualization_days))
        if return_count and returns.std(ddof=0) > 0
        else None
    )
    downside = (returns - target_daily).clip(upper=0)
    downside_deviation = (
        float(math.sqrt(float((downside.pow(2)).mean())) * math.sqrt(config.annualization_days) * 100)
        if return_count
        else None
    )
    sortino = (
        float(excess.mean() / math.sqrt(float(downside.pow(2).mean())) * math.sqrt(config.annualization_days))
        if return_count and float(downside.pow(2).mean()) > 0
        else None
    )
    years = return_count / config.annualization_days
    cagr = (
        ((final_equity / initial_equity) ** (1 / years) - 1.0) * 100
        if initial_equity and final_equity and years > 0
        else None
    )
    max_drawdown = float(drawdown.min() * 100) if not drawdown.empty else None
    current_drawdown = float(drawdown.iloc[-1] * 100) if not drawdown.empty else None
    average_drawdown = float(drawdown.mean() * 100) if not drawdown.empty else None
    ulcer_index = float(math.sqrt(float((drawdown.mul(100).pow(2)).mean()))) if not drawdown.empty else None
    calmar = (
        cagr / abs(max_drawdown)
        if cagr is not None and max_drawdown is not None and max_drawdown < 0
        else None
    )
    gains_over_target = (returns - target_daily).clip(lower=0).sum()
    losses_under_target = -(returns - target_daily).clip(upper=0).sum()
    omega = float(gains_over_target / losses_under_target) if losses_under_target > 0 else None

    var_return: float | None = None
    cvar_return: float | None = None
    if return_count:
        var_return = float(returns.quantile(1 - config.var_confidence) * 100)
        tail = returns.loc[returns <= returns.quantile(1 - config.var_confidence)]
        cvar_return = float(tail.mean() * 100) if not tail.empty else None

    winners = returns.loc[returns > 0]
    losers = returns.loc[returns < 0]
    flats = returns.loc[returns == 0]
    average_win = float(winners.mean() * 100) if not winners.empty else None
    average_loss = float(losers.mean() * 100) if not losers.empty else None
    payoff = average_win / abs(average_loss) if average_win is not None and average_loss not in (None, 0) else None
    profit_factor = float(winners.sum() / abs(losers.sum())) if not losers.empty and losers.sum() != 0 else None
    expectancy = float(returns.mean() * 100) if return_count else None

    benchmark = _benchmark_series(benchmark_history)
    benchmark_metrics_reason = benchmark_error
    aligned_portfolio = pd.Series(dtype=float)
    aligned_benchmark = pd.Series(dtype=float)
    if not benchmark.empty and not equity.empty:
        benchmark_on_dates = benchmark.reindex(equity.index, method="ffill")
        benchmark_returns = benchmark_on_dates.pct_change(fill_method=None)
        joined = pd.concat([returns.rename("portfolio"), benchmark_returns.rename("benchmark")], axis=1).dropna()
        if not joined.empty:
            aligned_portfolio = joined["portfolio"]
            aligned_benchmark = joined["benchmark"]
    benchmark_count = len(aligned_portfolio)
    tracking_error = None
    information_ratio = None
    beta = None
    alpha = None
    if benchmark_count:
        active = aligned_portfolio - aligned_benchmark
        active_std = float(active.std(ddof=0))
        tracking_error = active_std * math.sqrt(config.annualization_days) * 100
        if active_std > 0:
            information_ratio = float(active.mean() / active_std * math.sqrt(config.annualization_days))
        benchmark_variance = float(aligned_benchmark.var(ddof=0))
        if benchmark_variance > 0:
            beta = float(aligned_portfolio.cov(aligned_benchmark, ddof=0) / benchmark_variance)
            benchmark_excess = aligned_benchmark - risk_free_daily
            portfolio_excess = aligned_portfolio - risk_free_daily
            alpha = float((portfolio_excess.mean() - beta * benchmark_excess.mean()) * config.annualization_days * 100)
    elif benchmark_metrics_reason is None:
        benchmark_metrics_reason = "ポートフォリオ日付とベンチマーク日付の共通観測がありません。"

    position_values: list[float] = []
    for position in positions:
        quantity = _finite(position.get("quantity")) or 0.0
        price = _finite(position.get("current_price") or position.get("price") or position.get("avg_cost"))
        if quantity > 0 and price is not None and price >= 0:
            position_values.append(quantity * price)
    cash = _finite(summary.get("cash")) or 0.0
    market_value = sum(position_values)
    portfolio_equity = _finite(summary.get("equity")) or cash + market_value
    weights = [value / portfolio_equity for value in position_values] if portfolio_equity > 0 else []
    hhi = sum(weight * weight for weight in weights) if weights else None
    effective_positions = 1 / hhi if hhi and hhi > 0 else None
    exposure = market_value / portfolio_equity * 100 if portfolio_equity > 0 else None
    cash_ratio = cash / portfolio_equity * 100 if portfolio_equity > 0 else None
    largest_weight = max(weights) * 100 if weights else None

    trade_values = [abs(_finite(trade.get("value")) or 0.0) for trade in trades]
    average_equity = float(equity.mean()) if not equity.empty else portfolio_equity
    turnover = sum(trade_values) / average_equity if average_equity > 0 else None
    closed = _closed_trade_statistics(trades, seed_positions)
    closed_returns = closed["returns"]
    holding_days = closed["holding_days"]

    preliminary_status = "insufficient_history" if return_count < config.min_annualized_returns else "preliminary" if return_count < config.min_long_horizon_returns else "usable"
    latest_status = "preliminary" if observations < 2 else "ok"

    basic = {
        "observations": _metric(observations, available=observations, unit="days", status="ok"),
        "initial_equity": _metric(initial_equity, available=observations, unit="JPY", status=latest_status),
        "final_equity": _metric(final_equity, available=observations, unit="JPY", status=latest_status),
        "realized_pnl": _metric(_finite(summary.get("realized_pnl")), available=observations, unit="JPY", status=latest_status),
        "unrealized_pnl": _metric(_finite(summary.get("unrealized_pnl")), available=observations, unit="JPY", status=latest_status),
        "total_pnl": _metric(_finite(summary.get("total_pnl")), available=observations, unit="JPY", status=latest_status),
        "total_return_pct": _metric(total_return, available=observations, unit="%", status=latest_status, reason="評価額と投下元本から算出。"),
        "latest_daily_return_pct": _metric_or_insufficient(latest_daily_return, available=return_count, required=1, label="日次収益率", unit="%"),
        "cagr_pct": _metric_or_insufficient(cagr, available=return_count, required=config.min_long_horizon_returns, label="CAGR", unit="%"),
    }
    risk = {
        "annualized_volatility_pct": _metric_or_insufficient(annualized_vol, available=return_count, required=config.min_annualized_returns, label="年率ボラティリティ", unit="%"),
        "downside_deviation_pct": _metric_or_insufficient(downside_deviation, available=return_count, required=config.min_annualized_returns, label="下方偏差", unit="%"),
        "max_drawdown_pct": _metric(max_drawdown, available=observations, required=1, unit="%", status=latest_status, reason="観測済み評価額のピークからの最大下落。"),
        "current_drawdown_pct": _metric(current_drawdown, available=observations, required=1, unit="%", status=latest_status),
        "average_drawdown_pct": _metric(average_drawdown, available=observations, required=1, unit="%", status=latest_status),
        "max_drawdown_duration_days": _metric(durations["max_duration"], available=observations, required=1, unit="days", status=latest_status),
        "current_drawdown_duration_days": _metric(durations["current_duration"], available=observations, required=1, unit="days", status=latest_status),
        "max_recovery_duration_days": _metric(durations["max_recovery"], available=observations, required=2, unit="days", status="ok" if durations["max_recovery"] is not None else "unavailable", reason=None if durations["max_recovery"] is not None else "回復完了したドローダウンがありません。"),
        "ulcer_index": _metric(ulcer_index, available=observations, required=1, status=latest_status),
        "historical_var_pct": _metric_or_insufficient(var_return, available=return_count, required=config.min_annualized_returns, label=f"VaR {config.var_confidence:.0%}", unit="%"),
        "cvar_expected_shortfall_pct": _metric_or_insufficient(cvar_return, available=return_count, required=config.min_annualized_returns, label=f"CVaR {config.var_confidence:.0%}", unit="%"),
        "best_day_pct": _metric_or_insufficient(float(returns.max() * 100) if return_count else None, available=return_count, required=1, label="最良日", unit="%"),
        "worst_day_pct": _metric_or_insufficient(float(returns.min() * 100) if return_count else None, available=return_count, required=1, label="最悪日", unit="%"),
        "skewness": _metric_or_insufficient(float(returns.skew()) if return_count >= 3 else None, available=return_count, required=config.min_annualized_returns, label="歪度"),
        "excess_kurtosis": _metric_or_insufficient(float(returns.kurt()) if return_count >= 4 else None, available=return_count, required=config.min_annualized_returns, label="超過尖度"),
    }
    risk_adjusted = {
        "annualized_excess_return_pct": _metric_or_insufficient(annualized_excess, available=return_count, required=config.min_annualized_returns, label="年率超過収益", unit="%"),
        "sharpe_ratio": _metric_or_insufficient(sharpe, available=return_count, required=config.min_annualized_returns, label="Sharpe Ratio"),
        "sortino_ratio": _metric_or_insufficient(sortino, available=return_count, required=config.min_annualized_returns, label="Sortino Ratio"),
        "calmar_ratio": _metric_or_insufficient(calmar, available=return_count, required=config.min_long_horizon_returns, label="Calmar Ratio"),
        "omega_ratio": _metric_or_insufficient(omega, available=return_count, required=config.min_annualized_returns, label="Omega Ratio"),
        "information_ratio": _metric_or_insufficient(information_ratio, available=benchmark_count, required=config.min_long_horizon_returns, label="Information Ratio"),
        "tracking_error_pct": _metric_or_insufficient(tracking_error, available=benchmark_count, required=config.min_long_horizon_returns, label="Tracking Error", unit="%"),
        "beta": _metric_or_insufficient(beta, available=benchmark_count, required=config.min_long_horizon_returns, label="Beta"),
        "annualized_alpha_pct": _metric_or_insufficient(alpha, available=benchmark_count, required=config.min_long_horizon_returns, label="年率Alpha", unit="%"),
    }
    if benchmark_metrics_reason and benchmark_count < config.min_long_horizon_returns:
        for key in ("information_ratio", "tracking_error_pct", "beta", "annualized_alpha_pct"):
            risk_adjusted[key]["reason"] = f"{risk_adjusted[key]['reason']} {benchmark_metrics_reason}".strip()

    win_loss = {
        "positive_days": _metric(len(winners), available=return_count, required=1, unit="days", status="ok" if return_count else "unavailable", reason=None if return_count else "日次収益率がありません。"),
        "negative_days": _metric(len(losers), available=return_count, required=1, unit="days", status="ok" if return_count else "unavailable", reason=None if return_count else "日次収益率がありません。"),
        "flat_days": _metric(len(flats), available=return_count, required=1, unit="days", status="ok" if return_count else "unavailable", reason=None if return_count else "日次収益率がありません。"),
        "daily_win_rate_pct": _metric_or_insufficient(float(len(winners) / return_count * 100) if return_count else None, available=return_count, required=1, label="日次勝率", unit="%"),
        "average_winning_day_pct": _metric_or_insufficient(average_win, available=return_count, required=1, label="平均利益日", unit="%"),
        "average_losing_day_pct": _metric_or_insufficient(average_loss, available=return_count, required=1, label="平均損失日", unit="%"),
        "payoff_ratio": _metric_or_insufficient(payoff, available=return_count, required=2, label="Payoff Ratio"),
        "profit_factor": _metric_or_insufficient(profit_factor, available=return_count, required=2, label="Profit Factor"),
        "expectancy_pct": _metric_or_insufficient(expectancy, available=return_count, required=1, label="期待値", unit="% per day"),
        "reward_risk_ratio": _metric_or_insufficient(payoff, available=return_count, required=2, label="Reward/Risk Ratio"),
        "longest_winning_streak": _metric(_longest_streak(returns.gt(0).tolist()) if return_count else None, available=return_count, required=1, unit="days", status="ok" if return_count else "unavailable", reason=None if return_count else "日次収益率がありません。"),
        "longest_losing_streak": _metric(_longest_streak(returns.lt(0).tolist()) if return_count else None, available=return_count, required=1, unit="days", status="ok" if return_count else "unavailable", reason=None if return_count else "日次収益率がありません。"),
    }
    trading = {
        "trade_count": _metric(len(trades), available=len(trades), unit="trades"),
        "turnover": _metric(turnover, available=len(trades), unit="x equity", status="ok"),
        "exposure_pct": _metric(exposure, available=len(position_values), unit="%", status="ok" if portfolio_equity > 0 else "unavailable", reason=None if portfolio_equity > 0 else "評価額がありません。"),
        "cash_ratio_pct": _metric(cash_ratio, available=len(position_values), unit="%", status="ok" if portfolio_equity > 0 else "unavailable", reason=None if portfolio_equity > 0 else "評価額がありません。"),
        "largest_position_weight_pct": _metric(largest_weight, available=len(position_values), unit="%", status="ok" if weights else "unavailable", reason=None if weights else "保有ポジションがありません。"),
        "hhi_concentration": _metric(hhi, available=len(position_values), status="ok" if weights else "unavailable", reason=None if weights else "保有ポジションがありません。"),
        "effective_positions": _metric(effective_positions, available=len(position_values), status="ok" if effective_positions is not None else "unavailable", reason=None if effective_positions is not None else "保有ポジションがありません。"),
        "closed_trade_win_rate_pct": _metric(float(sum(value > 0 for value in closed_returns) / len(closed_returns) * 100) if closed_returns else None, available=len(closed_returns), required=1, unit="%", status="ok" if closed_returns else "unavailable", reason=None if closed_returns else "決済済み取引の取得価格と売却価格が不足しています。"),
        "average_holding_period_days": _metric(float(np.mean(holding_days)) if holding_days else None, available=len(holding_days), required=1, unit="days", status="ok" if holding_days else "unavailable", reason=None if holding_days else "保有開始日と決済日の組み合わせがありません。"),
    }

    seed = initial_equity or (_finite(equity.iloc[0]) if not equity.empty else None)
    benchmark_on_dates = benchmark.reindex(equity.index, method="ffill") if not benchmark.empty and not equity.empty else pd.Series(dtype=float)
    benchmark_base = _finite(benchmark_on_dates.dropna().iloc[0]) if not benchmark_on_dates.dropna().empty else None
    chart_series: list[dict[str, Any]] = []
    for index, value in equity.items():
        row = frame.loc[index]
        cumulative_pnl = _finite(row.get("total_pnl"))
        if cumulative_pnl is None and seed is not None:
            cumulative_pnl = float(value - seed)
        cumulative_return = _finite(row.get("cumulative_return_pct"))
        if cumulative_return is None and seed:
            cumulative_return = float((value / seed - 1) * 100)
        previous = equity.shift(1).loc[index]
        daily_pnl = None if pd.isna(previous) else float(value - previous)
        daily_return_pct = None if pd.isna(previous) else float((value / previous - 1) * 100)
        benchmark_cumulative = None
        if benchmark_base and index in benchmark_on_dates.index:
            benchmark_value = _finite(benchmark_on_dates.loc[index])
            if benchmark_value is not None:
                benchmark_cumulative = float((benchmark_value / benchmark_base - 1) * 100)
        chart_series.append(
            {
                "date": pd.Timestamp(index).date().isoformat(),
                "equity": float(value),
                "cumulative_pnl": cumulative_pnl,
                "cumulative_return_pct": cumulative_return,
                "daily_pnl": daily_pnl,
                "daily_return_pct": daily_return_pct,
                "drawdown_pct": float(drawdown.loc[index] * 100),
                "benchmark_cumulative_return_pct": benchmark_cumulative,
            }
        )

    return {
        "schema_version": 1,
        "generated_at": generated_at or dt.datetime.now(dt.timezone.utc).isoformat(),
        "config": asdict(config),
        "reliability": {
            "status": preliminary_status,
            "equity_observations": observations,
            "return_observations": return_count,
            "annualized_metrics_minimum": config.min_annualized_returns,
            "long_horizon_metrics_minimum": config.min_long_horizon_returns,
            "message": (
                "年率指標を評価するには履歴が不足しています。"
                if preliminary_status == "insufficient_history"
                else "年率指標は暫定値です。"
                if preliminary_status == "preliminary"
                else "最低履歴要件を満たしています。"
            ),
        },
        "period": {
            "start": frame.index.min().date().isoformat() if not frame.empty else None,
            "end": frame.index.max().date().isoformat() if not frame.empty else None,
        },
        "metrics": {
            "basic": basic,
            "risk": risk,
            "risk_adjusted": risk_adjusted,
            "win_loss": win_loss,
            "trading_portfolio": trading,
        },
        "benchmark": {
            "symbol": config.benchmark_symbol,
            "observations": benchmark_count,
            "status": "ok" if benchmark_count else "unavailable",
            "reason": benchmark_metrics_reason,
        },
        "chart_series": chart_series,
        "definitions": {
            "sharpe_ratio": "年率超過収益を総変動で割った値。",
            "sortino_ratio": "年率超過収益を下方変動だけで割った値。",
            "calmar_ratio": "CAGRを最大ドローダウンの絶対値で割った値。",
            "omega_ratio": "目標収益を上回る利益総額を下回る損失総額で割った値。",
            "profit_factor": "利益日の収益合計を損失日の損失合計で割った値。",
            "payoff_ratio": "平均利益日の収益を平均損失日の絶対値で割った値。",
            "ulcer_index": "ドローダウンの深さと継続を二乗平均で表す下方リスク指標。",
            "hhi_concentration": "保有比率の二乗和。高いほど集中しています。",
        },
    }
