from __future__ import annotations

import argparse
import datetime as dt
import json
import math
from dataclasses import dataclass
from pathlib import Path
from typing import Any

import numpy as np
import pandas as pd
import requests

BENCHMARK_URL = (
    "https://query2.finance.yahoo.com/v8/finance/chart/{symbol}"
    "?interval=1d&range=2y&includePrePost=false&events=div%2Csplits"
)


@dataclass(frozen=True)
class AnalyticsConfig:
    annualization: int = 252
    min_basic_observations: int = 5
    min_distribution_observations: int = 20
    min_annualized_observations: int = 60
    var_level: float = 0.95
    risk_free_rate_annual: float = 0.0
    benchmark_symbol: str = "1306.T"
    benchmark_name: str = "TOPIX連動型上場投資信託 (1306.T proxy)"


def _number(value: Any) -> float | None:
    if value is None or value is pd.NA:
        return None
    try:
        parsed = float(value)
    except (TypeError, ValueError):
        return None
    return parsed if math.isfinite(parsed) else None


def _safe(value: Any) -> Any:
    if isinstance(value, dict):
        return {str(key): _safe(item) for key, item in value.items()}
    if isinstance(value, (list, tuple)):
        return [_safe(item) for item in value]
    if isinstance(value, (pd.Timestamp, dt.datetime, dt.date)):
        return value.isoformat()
    if isinstance(value, np.integer):
        return int(value)
    if isinstance(value, (np.floating, float)):
        return None if not math.isfinite(float(value)) else float(value)
    if value is pd.NA:
        return None
    return value


def _load_json(path: Path, default: Any) -> Any:
    if not path.exists():
        return default
    return json.loads(path.read_text(encoding="utf-8"))


def _write_json(path: Path, payload: Any) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(
        json.dumps(_safe(payload), ensure_ascii=False, indent=2, allow_nan=False) + "\n",
        encoding="utf-8",
    )


def _metric(value: float | None, status: str = "ok", note: str | None = None) -> dict[str, Any]:
    return {"value": value, "status": status, "note": note}


def _insufficient(required: int, actual: int) -> dict[str, Any]:
    return _metric(None, "insufficient_history", f"{required}営業日以上を推奨。現在{actual}日。")


def _consecutive(values: list[float] | pd.Series, predicate: Any) -> int:
    best = 0
    current = 0
    for value in values:
        if predicate(float(value)):
            current += 1
            best = max(best, current)
        else:
            current = 0
    return best


def _history_frame(history_rows: list[dict[str, Any]]) -> pd.DataFrame:
    history = pd.DataFrame(history_rows)
    if history.empty:
        return history
    history["date"] = pd.to_datetime(history["date"], errors="coerce")
    return (
        history.dropna(subset=["date"])
        .drop_duplicates("date", keep="last")
        .sort_values("date")
        .set_index("date")
    )


def _returns_from_history(history: pd.DataFrame, seed_cost_basis: float | None) -> pd.Series:
    """Derive returns from equity itself so stale stored return fields cannot corrupt analytics."""
    if history.empty or "equity" not in history:
        return pd.Series(dtype=float)
    equity = pd.to_numeric(history["equity"], errors="coerce")
    returns = equity.pct_change(fill_method=None)
    if seed_cost_basis and seed_cost_basis > 0 and not equity.empty and pd.notna(equity.iloc[0]):
        returns.iloc[0] = float(equity.iloc[0]) / seed_cost_basis - 1.0
    return returns.dropna()


def repair_equity_history_rows(
    history_rows: list[dict[str, Any]],
    seed_cost_basis: float | None,
) -> tuple[list[dict[str, Any]], bool]:
    """Repair only daily_return_pct from the equity path; never change P/L or equity values."""
    if not history_rows:
        return [], False
    frame = _history_frame(history_rows)
    if frame.empty:
        return history_rows, False
    returns = _returns_from_history(frame, seed_cost_basis)
    by_date = {pd.Timestamp(index).date().isoformat(): float(value) * 100 for index, value in returns.items()}
    repaired: list[dict[str, Any]] = []
    changed = False
    for raw in history_rows:
        row = dict(raw)
        key = str(row.get("date") or "")[:10]
        if key in by_date:
            corrected = round(by_date[key], 8)
            original = _number(row.get("daily_return_pct"))
            if original is None or abs(original - corrected) > 1e-7:
                changed = True
            row["daily_return_pct"] = corrected
        repaired.append(row)
    return repaired, changed


def _drawdown_series(history: pd.DataFrame, seed_cost_basis: float | None) -> pd.Series:
    if history.empty:
        return pd.Series(dtype=float)
    equity = pd.to_numeric(history.get("equity", pd.Series(dtype=float)), errors="coerce").dropna()
    if equity.empty:
        return pd.Series(dtype=float)
    if seed_cost_basis and seed_cost_basis > 0:
        base_date = equity.index[0] - pd.Timedelta(days=1)
        equity = pd.concat([pd.Series([seed_cost_basis], index=[base_date]), equity])
    return equity / equity.cummax() - 1.0


def _drawdown_details(drawdown: pd.Series, equity: pd.Series) -> dict[str, Any]:
    if drawdown.empty or equity.empty:
        return {
            "max_drawdown_pct": None,
            "current_drawdown_pct": None,
            "peak_date": None,
            "trough_date": None,
            "recovery_date": None,
            "drawdown_duration_periods": 0,
            "recovery_duration_periods": None,
            "time_under_water_periods": 0,
        }
    aligned = drawdown.reindex(equity.index).fillna(0.0)
    trough_date = aligned.idxmin()
    max_dd = float(aligned.loc[trough_date])
    pre = equity.loc[:trough_date]
    peak_value = float(pre.max())
    peak_date = pre[pre == peak_value].index[-1]
    recovered = equity.loc[trough_date:]
    recovered = recovered[recovered >= peak_value]
    recovery_date = recovered.index[0] if not recovered.empty else None
    drawdown_duration = max(0, int(equity.index.get_loc(trough_date) - equity.index.get_loc(peak_date)))
    recovery_duration = None
    if recovery_date is not None:
        recovery_duration = max(0, int(equity.index.get_loc(recovery_date) - equity.index.get_loc(trough_date)))
    return {
        "max_drawdown_pct": max_dd * 100,
        "current_drawdown_pct": float(aligned.iloc[-1]) * 100,
        "peak_date": peak_date,
        "trough_date": trough_date,
        "recovery_date": recovery_date,
        "drawdown_duration_periods": drawdown_duration,
        "recovery_duration_periods": recovery_duration,
        "time_under_water_periods": int((aligned < 0).sum()),
    }


def _fetch_benchmark(symbol: str, timeout: float = 20.0) -> pd.Series:
    response = requests.get(
        BENCHMARK_URL.format(symbol=symbol),
        timeout=timeout,
        headers={"Accept": "application/json", "User-Agent": "ValueScopeAnalytics/2.0"},
    )
    response.raise_for_status()
    result = (response.json().get("chart", {}).get("result") or [None])[0]
    if not isinstance(result, dict):
        return pd.Series(dtype=float)
    timestamps = result.get("timestamp") or []
    quote = ((result.get("indicators") or {}).get("quote") or [{}])[0]
    adjusted = ((result.get("indicators") or {}).get("adjclose") or [{}])[0]
    closes = adjusted.get("adjclose") or quote.get("close") or []
    rows: dict[pd.Timestamp, float] = {}
    for index, timestamp in enumerate(timestamps):
        close = _number(closes[index] if index < len(closes) else None)
        if close is None:
            continue
        date = pd.Timestamp(timestamp, unit="s", tz="UTC").tz_convert("Asia/Tokyo").normalize().tz_localize(None)
        rows[date] = close
    return pd.Series(rows, dtype=float).sort_index()


def _benchmark_metrics(
    portfolio_returns: pd.Series,
    benchmark_prices: pd.Series,
    config: AnalyticsConfig,
) -> dict[str, Any]:
    empty: dict[str, Any] = {
        "name": config.benchmark_name,
        "symbol": config.benchmark_symbol,
        "paired_observations": 0,
        "total_return_pct": _metric(None, "unavailable", "ベンチマーク履歴がありません。"),
        "excess_return_pct": _metric(None, "unavailable"),
        "beta": _metric(None, "unavailable"),
        "alpha_annual_pct": _metric(None, "unavailable"),
        "tracking_error_pct": _metric(None, "unavailable"),
        "information_ratio": _metric(None, "unavailable"),
        "correlation": _metric(None, "unavailable"),
        "up_capture_pct": _metric(None, "unavailable"),
        "down_capture_pct": _metric(None, "unavailable"),
    }
    if portfolio_returns.empty or benchmark_prices.empty:
        return empty
    benchmark_returns = benchmark_prices.pct_change(fill_method=None).dropna()
    portfolio = portfolio_returns.copy()
    portfolio.index = pd.to_datetime(portfolio.index).tz_localize(None).normalize()
    benchmark_returns.index = pd.to_datetime(benchmark_returns.index).tz_localize(None).normalize()
    paired = pd.concat([portfolio.rename("portfolio"), benchmark_returns.rename("benchmark")], axis=1).dropna()
    n = len(paired)
    empty["paired_observations"] = n
    if n == 0:
        return empty
    benchmark_total = float((1 + paired["benchmark"]).prod() - 1.0)
    portfolio_total = float((1 + paired["portfolio"]).prod() - 1.0)
    empty["total_return_pct"] = _metric(benchmark_total * 100)
    empty["excess_return_pct"] = _metric((portfolio_total - benchmark_total) * 100)
    if n < config.min_distribution_observations:
        for key in ("beta", "alpha_annual_pct", "tracking_error_pct", "information_ratio", "correlation", "up_capture_pct", "down_capture_pct"):
            empty[key] = _insufficient(config.min_distribution_observations, n)
        return empty
    benchmark_var = float(paired["benchmark"].var(ddof=0))
    beta = float(paired.cov(ddof=0).loc["portfolio", "benchmark"] / benchmark_var) if benchmark_var > 0 else None
    daily_alpha = float(paired["portfolio"].mean() - (beta or 0.0) * paired["benchmark"].mean()) if beta is not None else None
    active = paired["portfolio"] - paired["benchmark"]
    tracking = float(active.std(ddof=0) * math.sqrt(config.annualization))
    information = float(active.mean() * config.annualization / tracking) if tracking > 0 else None
    correlation = float(paired["portfolio"].corr(paired["benchmark"]))
    up = paired[paired["benchmark"] > 0]
    down = paired[paired["benchmark"] < 0]
    up_capture = float(up["portfolio"].mean() / up["benchmark"].mean() * 100) if not up.empty and up["benchmark"].mean() != 0 else None
    down_capture = float(down["portfolio"].mean() / down["benchmark"].mean() * 100) if not down.empty and down["benchmark"].mean() != 0 else None
    empty.update({
        "beta": _metric(beta),
        "alpha_annual_pct": _metric(None if daily_alpha is None else daily_alpha * config.annualization * 100),
        "tracking_error_pct": _metric(tracking * 100),
        "information_ratio": _metric(information),
        "correlation": _metric(correlation),
        "up_capture_pct": _metric(up_capture),
        "down_capture_pct": _metric(down_capture),
    })
    return empty


def _seed_entry_map(portfolio_state: dict[str, Any]) -> dict[str, float]:
    entries: dict[str, float] = {}
    for position in portfolio_state.get("seed_positions", []) or []:
        symbol = str(position.get("symbol") or "")
        if not symbol and position.get("code"):
            symbol = f"{position['code']}.T"
        price = _number(position.get("entry_price") or position.get("avg_cost"))
        if symbol and price is not None:
            entries[symbol] = price
    return entries


def _closed_trade_rows(trades: list[dict[str, Any]], portfolio_state: dict[str, Any]) -> list[dict[str, float | str]]:
    entries = _seed_entry_map(portfolio_state)
    rows: list[dict[str, float | str]] = []
    for trade in trades:
        if str(trade.get("side") or "").upper() != "SIM_SELL":
            continue
        symbol = str(trade.get("symbol") or "")
        quantity = _number(trade.get("quantity"))
        exit_price = _number(trade.get("price"))
        entry_price = _number(trade.get("entry_price")) or entries.get(symbol)
        if not symbol or not quantity or quantity <= 0 or exit_price is None or entry_price is None or entry_price <= 0:
            continue
        pnl = (exit_price - entry_price) * quantity
        return_pct = (exit_price / entry_price - 1.0) * 100
        rows.append({"symbol": symbol, "pnl": pnl, "return_pct": return_pct})
    return rows


def _trade_quality(
    returns: pd.Series,
    trades: list[dict[str, Any]],
    portfolio_state: dict[str, Any],
    latest_summary: dict[str, Any],
) -> tuple[dict[str, Any], float | None, float | None]:
    closed = _closed_trade_rows(trades, portfolio_state)
    daily_wins = returns[returns > 0]
    daily_losses = returns[returns < 0]
    daily_payoff = float(daily_wins.mean() / abs(daily_losses.mean())) if not daily_wins.empty and not daily_losses.empty and daily_losses.mean() != 0 else None
    daily_profit_factor = float(daily_wins.sum() / abs(daily_losses.sum())) if not daily_wins.empty and not daily_losses.empty and daily_losses.sum() != 0 else None
    if not closed:
        n = len(returns)
        daily_expectancy = float(returns.mean() * 100) if n else None
        trading = {
            "basis": "daily_return_proxy",
            "closed_trade_count": _metric(0.0, "unavailable", "決済トレードがないため日次リターンを代理指標に使用。"),
            "winning_trades": _metric(None, "unavailable"),
            "losing_trades": _metric(None, "unavailable"),
            "win_rate_pct": _metric(float((returns > 0).mean() * 100) if n else None, "proxy"),
            "loss_rate_pct": _metric(float((returns < 0).mean() * 100) if n else None, "proxy"),
            "payoff_ratio": _metric(daily_payoff, "proxy" if daily_payoff is not None else "insufficient_wins_losses"),
            "risk_reward_ratio": _metric(daily_payoff, "proxy" if daily_payoff is not None else "insufficient_wins_losses"),
            "profit_factor": _metric(daily_profit_factor, "proxy" if daily_profit_factor is not None else "insufficient_wins_losses"),
            "expectancy_yen": _metric(None, "unavailable"),
            "expectancy_pct": _metric(daily_expectancy, "proxy"),
            "average_win_yen": _metric(None, "unavailable"),
            "average_loss_yen": _metric(None, "unavailable"),
            "average_win_pct": _metric(float(daily_wins.mean() * 100) if not daily_wins.empty else None, "proxy"),
            "average_loss_pct": _metric(float(daily_losses.mean() * 100) if not daily_losses.empty else None, "proxy"),
            "max_consecutive_wins": _metric(float(_consecutive(returns, lambda value: value > 0)) if n else None, "proxy"),
            "max_consecutive_losses": _metric(float(_consecutive(returns, lambda value: value < 0)) if n else None, "proxy"),
            "trade_count": _metric(float(len(trades))),
            "daily_win_rate_pct": _metric(float((returns > 0).mean() * 100) if n else None),
            "daily_loss_rate_pct": _metric(float((returns < 0).mean() * 100) if n else None),
            "turnover_today": _metric(_number(latest_summary.get("turnover_today"))),
        }
        return trading, daily_payoff, daily_profit_factor
    pnls = [float(row["pnl"]) for row in closed]
    returns_pct = [float(row["return_pct"]) for row in closed]
    wins = [value for value in pnls if value > 0]
    losses = [value for value in pnls if value < 0]
    win_returns = [value for value, pnl in zip(returns_pct, pnls, strict=True) if pnl > 0]
    loss_returns = [value for value, pnl in zip(returns_pct, pnls, strict=True) if pnl < 0]
    avg_win_yen = sum(wins) / len(wins) if wins else None
    avg_loss_yen = sum(losses) / len(losses) if losses else None
    avg_win_pct = sum(win_returns) / len(win_returns) if win_returns else None
    avg_loss_pct = sum(loss_returns) / len(loss_returns) if loss_returns else None
    payoff = avg_win_yen / abs(avg_loss_yen) if avg_win_yen is not None and avg_loss_yen not in (None, 0) else None
    profit_factor = sum(wins) / abs(sum(losses)) if wins and losses and sum(losses) != 0 else None
    count = len(closed)
    trading = {
        "basis": "closed_trades",
        "closed_trade_count": _metric(float(count)),
        "winning_trades": _metric(float(len(wins))),
        "losing_trades": _metric(float(len(losses))),
        "win_rate_pct": _metric(len(wins) / count * 100 if count else None),
        "loss_rate_pct": _metric(len(losses) / count * 100 if count else None),
        "payoff_ratio": _metric(payoff, "ok" if payoff is not None else "insufficient_wins_losses"),
        "risk_reward_ratio": _metric(payoff, "ok" if payoff is not None else "insufficient_wins_losses"),
        "profit_factor": _metric(profit_factor, "ok" if profit_factor is not None else "insufficient_wins_losses"),
        "expectancy_yen": _metric(sum(pnls) / count if count else None),
        "expectancy_pct": _metric(sum(returns_pct) / count if count else None),
        "average_win_yen": _metric(avg_win_yen),
        "average_loss_yen": _metric(avg_loss_yen),
        "average_win_pct": _metric(avg_win_pct),
        "average_loss_pct": _metric(avg_loss_pct),
        "max_consecutive_wins": _metric(float(_consecutive(pnls, lambda value: value > 0))),
        "max_consecutive_losses": _metric(float(_consecutive(pnls, lambda value: value < 0))),
        "trade_count": _metric(float(len(trades))),
        "daily_win_rate_pct": _metric(float((returns > 0).mean() * 100) if len(returns) else None),
        "daily_loss_rate_pct": _metric(float((returns < 0).mean() * 100) if len(returns) else None),
        "turnover_today": _metric(_number(latest_summary.get("turnover_today"))),
    }
    return trading, payoff, profit_factor


def calculate_performance_analytics(
    history_rows: list[dict[str, Any]],
    latest_report: dict[str, Any],
    portfolio_state: dict[str, Any],
    trades: list[dict[str, Any]],
    benchmark_prices: pd.Series | None = None,
    config: AnalyticsConfig = AnalyticsConfig(),
) -> dict[str, Any]:
    history = _history_frame(history_rows)
    seed = _number(portfolio_state.get("seed_cost_basis")) or 30_722_100.0
    returns = _returns_from_history(history, seed)
    n = len(returns)
    equity = pd.to_numeric(history.get("equity", pd.Series(dtype=float)), errors="coerce").dropna()
    if seed and not equity.empty:
        base_date = equity.index[0] - pd.Timedelta(days=1)
        equity_with_base = pd.concat([pd.Series([seed], index=[base_date]), equity])
    else:
        equity_with_base = equity
    drawdown = _drawdown_series(history, seed)
    dd = _drawdown_details(drawdown, equity_with_base)
    latest_summary = latest_report.get("summary", {})
    total_return = _number(latest_summary.get("cumulative_return_pct"))
    if total_return is None and seed and not equity.empty:
        total_return = (float(equity.iloc[-1]) / seed - 1.0) * 100
    best_day = float(returns.max() * 100) if not returns.empty else None
    worst_day = float(returns.min() * 100) if not returns.empty else None
    daily_wins = returns[returns > 0]
    daily_losses = returns[returns < 0]
    gain_to_pain = float(returns.sum() / abs(daily_losses.sum())) if not daily_losses.empty and daily_losses.sum() != 0 else None
    distribution_ok = n >= config.min_distribution_observations
    annual_ok = n >= config.min_annualized_observations
    volatility = float(returns.std(ddof=0) * math.sqrt(config.annualization) * 100) if distribution_ok else None
    downside_deviation = float(daily_losses.std(ddof=0) * math.sqrt(config.annualization) * 100) if distribution_ok and len(daily_losses) >= 2 else None
    mean_annual = float(returns.mean() * config.annualization) if annual_ok else None
    sharpe = (mean_annual - config.risk_free_rate_annual) / (volatility / 100) if annual_ok and volatility and volatility > 0 and mean_annual is not None else None
    sortino = (mean_annual - config.risk_free_rate_annual) / (downside_deviation / 100) if annual_ok and downside_deviation and downside_deviation > 0 and mean_annual is not None else None
    cagr = None
    if annual_ok and seed and not equity.empty:
        years = n / config.annualization
        if years > 0 and float(equity.iloc[-1]) > 0:
            cagr = (float(equity.iloc[-1]) / seed) ** (1 / years) - 1.0
    calmar = cagr / abs(dd["max_drawdown_pct"] / 100) if cagr is not None and dd["max_drawdown_pct"] is not None and dd["max_drawdown_pct"] < 0 else None
    recovery_factor = total_return / abs(dd["max_drawdown_pct"]) if total_return is not None and dd["max_drawdown_pct"] is not None and dd["max_drawdown_pct"] < 0 else None
    ulcer = float(math.sqrt(float(((drawdown.clip(upper=0) * 100) ** 2).mean()))) if distribution_ok and not drawdown.empty else None
    pain_index = float(abs(drawdown.clip(upper=0).mean()) * 100) if distribution_ok and not drawdown.empty else None
    historical_var = historical_cvar = skew = kurtosis = None
    if distribution_ok:
        quantile = float(returns.quantile(1 - config.var_level))
        historical_var = quantile * 100
        tail = returns[returns <= quantile]
        historical_cvar = float(tail.mean() * 100) if not tail.empty else None
        skew = float(returns.skew())
        kurtosis = float(returns.kurt())
    trading, trade_payoff, _ = _trade_quality(returns, trades, portfolio_state, latest_summary)
    omega = float(daily_wins.sum() / abs(daily_losses.sum())) if distribution_ok and not daily_losses.empty and daily_losses.sum() != 0 else None
    annual_note = None if annual_ok else f"Sharpe・Sortino・CAGR・Calmarは{config.min_annualized_observations}営業日以上で表示。現在{n}日。"
    distribution_note = None if distribution_ok else f"Volatility・VaR・CVaR等は{config.min_distribution_observations}営業日以上で表示。現在{n}日。"
    performance = {
        "total_return_pct": _metric(total_return),
        "total_pnl": _metric(_number(latest_summary.get("total_pnl"))),
        "realized_pnl": _metric(_number(latest_summary.get("realized_pnl"))),
        "unrealized_pnl": _metric(_number(latest_summary.get("unrealized_pnl"))),
        "cagr_pct": _metric(None if cagr is None else cagr * 100) if annual_ok else _insufficient(config.min_annualized_observations, n),
        "best_day_pct": _metric(best_day),
        "worst_day_pct": _metric(worst_day),
        "average_daily_return_pct": _metric(float(returns.mean() * 100) if not returns.empty else None),
    }
    risk = {
        "annualized_volatility_pct": _metric(volatility) if distribution_ok else _insufficient(config.min_distribution_observations, n),
        "downside_deviation_pct": _metric(downside_deviation) if distribution_ok else _insufficient(config.min_distribution_observations, n),
        "max_drawdown_pct": _metric(dd["max_drawdown_pct"]),
        "current_drawdown_pct": _metric(dd["current_drawdown_pct"]),
        "ulcer_index": _metric(ulcer) if distribution_ok else _insufficient(config.min_distribution_observations, n),
        "pain_index_pct": _metric(pain_index) if distribution_ok else _insufficient(config.min_distribution_observations, n),
        "historical_var_95_pct": _metric(historical_var) if distribution_ok else _insufficient(config.min_distribution_observations, n),
        "historical_cvar_95_pct": _metric(historical_cvar) if distribution_ok else _insufficient(config.min_distribution_observations, n),
        "skewness": _metric(skew) if distribution_ok else _insufficient(config.min_distribution_observations, n),
        "excess_kurtosis": _metric(kurtosis) if distribution_ok else _insufficient(config.min_distribution_observations, n),
    }
    adjusted = {
        "sharpe_ratio": _metric(sharpe, "ok", annual_note) if annual_ok else _insufficient(config.min_annualized_observations, n),
        "sortino_ratio": _metric(sortino, "ok", annual_note) if annual_ok else _insufficient(config.min_annualized_observations, n),
        "calmar_ratio": _metric(calmar, "ok", annual_note) if annual_ok else _insufficient(config.min_annualized_observations, n),
        "recovery_factor": _metric(recovery_factor),
        "gain_to_pain_ratio": _metric(gain_to_pain, "ok" if n >= config.min_basic_observations else "insufficient_history"),
        "omega_ratio": _metric(omega) if distribution_ok else _insufficient(config.min_distribution_observations, n),
        "risk_reward_ratio": _metric(trade_payoff, trading["risk_reward_ratio"]["status"], "平均利益 / 平均損失の絶対値。決済トレード優先。"),
    }
    benchmark = _benchmark_metrics(returns, benchmark_prices if benchmark_prices is not None else pd.Series(dtype=float), config)
    equity_series: list[dict[str, Any]] = []
    daily_pnl_series: list[dict[str, Any]] = []
    drawdown_series: list[dict[str, Any]] = []
    previous_total_pnl = 0.0
    if not history.empty:
        history_dd = _drawdown_series(history, seed)
        for date_index, row in history.iterrows():
            total_pnl = _number(row.get("total_pnl")) or 0.0
            daily_return = returns.get(date_index)
            equity_series.append({
                "date": date_index.date().isoformat(),
                "equity": _number(row.get("equity")),
                "total_pnl": total_pnl,
                "cumulative_return_pct": _number(row.get("cumulative_return_pct")),
            })
            daily_pnl_series.append({
                "date": date_index.date().isoformat(),
                "daily_pnl": total_pnl - previous_total_pnl,
                "daily_return_pct": None if daily_return is None or pd.isna(daily_return) else float(daily_return) * 100,
            })
            previous_total_pnl = total_pnl
            dd_value = history_dd.get(date_index)
            drawdown_series.append({"date": date_index.date().isoformat(), "drawdown_pct": None if dd_value is None else float(dd_value) * 100})
    contributions: list[dict[str, Any]] = []
    for decision in latest_report.get("decisions", []):
        holding = decision.get("holding", {})
        quantity = int(_number(holding.get("quantity")) or 0)
        avg_cost = _number(holding.get("avg_cost"))
        current = _number(decision.get("technical", {}).get("price"))
        quote_valid = decision.get("quote", {}).get("valid") is True
        if quantity <= 0 or avg_cost is None:
            continue
        valuation = current if quote_valid and current is not None else avg_cost
        entry_value = avg_cost * quantity
        current_value = valuation * quantity
        pnl = current_value - entry_value
        contributions.append({
            "code": decision.get("code"),
            "company_name": decision.get("company_name"),
            "quantity": quantity,
            "entry_value": entry_value,
            "current_value": current_value,
            "pnl": pnl,
            "return_pct": pnl / entry_value * 100 if entry_value else None,
            "weight_pct": current_value / float(latest_summary.get("equity") or 1.0) * 100,
            "quote_valid": quote_valid,
        })
    contributions.sort(key=lambda item: abs(float(item.get("pnl") or 0.0)), reverse=True)
    warnings = [note for note in (annual_note, distribution_note) if note]
    return {
        "schema_version": 2,
        "generated_at": dt.datetime.now(dt.timezone.utc),
        "paper_only": True,
        "sample": {
            "observations": n,
            "start_date": history.index.min() if not history.empty else None,
            "end_date": history.index.max() if not history.empty else None,
            "seed_cost_basis": seed,
            "current_equity": _number(latest_summary.get("equity")),
            "status": {
                "annualized": "ok" if annual_ok else "insufficient_history",
                "distribution": "ok" if distribution_ok else "insufficient_history",
                "basic": "ok" if n >= config.min_basic_observations else "insufficient_history",
            },
        },
        "performance": performance,
        "risk": risk,
        "risk_adjusted": adjusted,
        "trading_quality": trading,
        "drawdown_details": dd,
        "benchmark": benchmark,
        "series": {"equity": equity_series, "daily_pnl": daily_pnl_series, "drawdown": drawdown_series, "contributions": contributions},
        "warnings": warnings,
        "definitions": {
            "risk_reward_ratio": "決済トレードの平均利益 / 平均損失の絶対値。決済が無い場合のみ日次リターンを代理使用。",
            "profit_factor": "決済トレードの総利益 / 総損失の絶対値。",
            "expectancy_yen": "決済トレードの実現損益合計 / 決済件数。",
            "gain_to_pain_ratio": "日次リターン合計 / マイナス日リターン合計の絶対値。",
            "ulcer_index": "ドローダウン率の二乗平均平方根。",
            "historical_var_95_pct": "過去分布の下位5%点。負の値ほど1日損失リスクが大きい。",
            "historical_cvar_95_pct": "VaR95%以下の損失日の平均。",
        },
    }


def generate_performance_analytics(root: Path, config: AnalyticsConfig = AnalyticsConfig()) -> dict[str, Any]:
    data_dir = root / "web" / "data" / "paper-trading"
    history_payload = _load_json(data_dir / "equity-history.json", {"history": []})
    latest_report = _load_json(data_dir / "latest-report.json", {})
    portfolio = _load_json(data_dir / "portfolio.json", {})
    demo = _load_json(root / "web" / "demo-portfolio.json", {"positions": []})
    portfolio = {**portfolio, "seed_positions": demo.get("positions", [])}
    repaired, changed = repair_equity_history_rows(history_payload.get("history", []), _number(portfolio.get("seed_cost_basis")))
    if changed:
        history_payload = {**history_payload, "history": repaired}
        _write_json(data_dir / "equity-history.json", history_payload)
    trades_payload = _load_json(data_dir / "trades.json", {"trades": []})
    benchmark_prices = pd.Series(dtype=float)
    benchmark_error: str | None = None
    try:
        benchmark_prices = _fetch_benchmark(config.benchmark_symbol)
    except (requests.RequestException, ValueError, KeyError) as exc:
        benchmark_error = type(exc).__name__
    payload = calculate_performance_analytics(
        history_payload.get("history", []), latest_report, portfolio, trades_payload.get("trades", []), benchmark_prices, config
    )
    if benchmark_error:
        payload["benchmark"]["fetch_error"] = benchmark_error
    _write_json(data_dir / "performance-metrics.json", payload)
    return payload


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description="Generate comprehensive paper portfolio analytics")
    parser.add_argument("--root", type=Path, default=Path.cwd())
    args = parser.parse_args(argv)
    payload = generate_performance_analytics(args.root)
    print(json.dumps({
        "observations": payload["sample"]["observations"],
        "total_return_pct": payload["performance"]["total_return_pct"]["value"],
        "max_drawdown_pct": payload["risk"]["max_drawdown_pct"]["value"],
        "sharpe_status": payload["risk_adjusted"]["sharpe_ratio"]["status"],
        "closed_trade_count": payload["trading_quality"]["closed_trade_count"]["value"],
    }, ensure_ascii=False))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
