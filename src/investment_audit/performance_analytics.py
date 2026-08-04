from __future__ import annotations

import argparse
import datetime as dt
import json
import math
from pathlib import Path
from typing import Any, Iterable, Mapping, Sequence

import numpy as np
import pandas as pd

ANNUALIZATION = 252
MIN_RETURN_OBSERVATIONS = 20
MIN_COMPLETED_TRADES = 5
RISK_FREE_RATE = 0.0


def _number(value: Any) -> float | None:
    if value is None or value is pd.NA:
        return None
    try:
        parsed = float(value)
    except (TypeError, ValueError):
        return None
    return parsed if math.isfinite(parsed) else None


def _round(value: float | None, digits: int = 6) -> float | None:
    return None if value is None or not math.isfinite(value) else round(float(value), digits)


def _metric(
    value: float | int | str | None,
    *,
    status: str = "ok",
    reason: str | None = None,
    unit: str | None = None,
) -> dict[str, Any]:
    if isinstance(value, float):
        value = _round(value)
    return {"value": value, "status": status, "reason": reason, "unit": unit}


def _unavailable(status: str, reason: str, unit: str | None = None) -> dict[str, Any]:
    return _metric(None, status=status, reason=reason, unit=unit)


def _parse_date(value: Any) -> pd.Timestamp | None:
    if value is None:
        return None
    try:
        parsed = pd.Timestamp(value)
    except (TypeError, ValueError):
        return None
    if pd.isna(parsed):
        return None
    if parsed.tzinfo is not None:
        parsed = parsed.tz_convert("Asia/Tokyo").tz_localize(None)
    return parsed.normalize()


def _history_frame(history: Sequence[Mapping[str, Any]]) -> pd.DataFrame:
    rows: list[dict[str, Any]] = []
    for item in history:
        date = _parse_date(item.get("date"))
        equity = _number(item.get("equity"))
        if date is None or equity is None or equity <= 0:
            continue
        rows.append(
            {
                "date": date,
                "equity": equity,
                "realized_pnl": _number(item.get("realized_pnl")),
                "unrealized_pnl": _number(item.get("unrealized_pnl")),
                "total_pnl": _number(item.get("total_pnl")),
                "turnover": _number(item.get("turnover_today")) or 0.0,
            }
        )
    if not rows:
        return pd.DataFrame(
            columns=["equity", "realized_pnl", "unrealized_pnl", "total_pnl", "turnover"]
        )
    frame = (
        pd.DataFrame(rows)
        .sort_values("date", kind="stable")
        .drop_duplicates("date", keep="last")
        .set_index("date")
    )
    return frame


def _benchmark_frame(history: Sequence[Mapping[str, Any]] | None) -> pd.Series:
    if not history:
        return pd.Series(dtype=float)
    rows: list[tuple[pd.Timestamp, float]] = []
    for item in history:
        date = _parse_date(item.get("date"))
        value = _number(item.get("equity") or item.get("close") or item.get("value"))
        if date is not None and value is not None and value > 0:
            rows.append((date, value))
    if not rows:
        return pd.Series(dtype=float)
    return (
        pd.Series({date: value for date, value in rows}, dtype=float)
        .sort_index()
        .loc[lambda series: ~series.index.duplicated(keep="last")]
    )


def _drawdown_details(equity: pd.Series) -> dict[str, Any]:
    if equity.empty:
        return {
            "series": pd.Series(dtype=float),
            "max_drawdown_pct": None,
            "current_drawdown_pct": None,
            "start": None,
            "trough": None,
            "recovery": None,
            "duration_days": None,
            "recovery_days": None,
            "amount": None,
        }
    running_peak = equity.cummax()
    drawdown = equity / running_peak - 1.0
    trough = drawdown.idxmin()
    peak_value = float(running_peak.loc[trough])
    before = equity.loc[:trough]
    peak_candidates = before[before == peak_value]
    start = peak_candidates.index[-1] if not peak_candidates.empty else before.idxmax()
    after = equity.loc[trough:]
    recovered = after[after >= peak_value]
    recovery = recovered.index[0] if not recovered.empty else None
    end = recovery if recovery is not None else equity.index[-1]
    duration = max(0, int((end - start).days))
    recovery_days = None if recovery is None else max(0, int((recovery - trough).days))
    return {
        "series": drawdown,
        "max_drawdown_pct": float(drawdown.min() * 100),
        "current_drawdown_pct": float(drawdown.iloc[-1] * 100),
        "start": start.date().isoformat(),
        "trough": trough.date().isoformat(),
        "recovery": recovery.date().isoformat() if recovery is not None else None,
        "duration_days": duration,
        "recovery_days": recovery_days,
        "amount": float(equity.loc[trough] - peak_value),
    }


def _trade_pnls(trades: Sequence[Mapping[str, Any]]) -> tuple[list[float], list[float]]:
    pnls: list[float] = []
    holding_days: list[float] = []
    for trade in trades:
        side = str(trade.get("side", "")).upper()
        if side not in {"SELL", "SIM_SELL", "CLOSE"}:
            continue
        pnl = _number(trade.get("realized_pnl") or trade.get("pnl"))
        if pnl is None:
            proceeds = _number(trade.get("proceeds") or trade.get("value"))
            cost = _number(trade.get("cost_basis") or trade.get("cost"))
            if proceeds is not None and cost is not None:
                pnl = proceeds - cost
        if pnl is not None:
            pnls.append(pnl)
        holding = _number(trade.get("holding_days"))
        if holding is not None and holding >= 0:
            holding_days.append(holding)
    return pnls, holding_days


def _position_values(
    portfolio: Mapping[str, Any], latest_report: Mapping[str, Any]
) -> tuple[list[float], list[float]]:
    decision_map = {
        str(item.get("symbol")): item for item in latest_report.get("decisions", []) if item.get("symbol")
    }
    values: list[float] = []
    contributions: list[float] = []
    for position in portfolio.get("positions", []):
        quantity = _number(position.get("quantity")) or 0.0
        avg_cost = _number(position.get("avg_cost") or position.get("entry_price"))
        item = decision_map.get(str(position.get("symbol")), {})
        price = _number(item.get("technical", {}).get("price"))
        if price is None:
            price = avg_cost
        if price is None or quantity <= 0:
            continue
        value = price * quantity
        values.append(value)
        cost = (avg_cost or price) * quantity
        contributions.append(value - cost)
    return values, contributions


def _series_records(series: pd.Series, field: str) -> list[dict[str, Any]]:
    return [
        {"date": pd.Timestamp(index).date().isoformat(), field: _round(float(value), 6)}
        for index, value in series.dropna().items()
    ]


def _period_returns(equity: pd.Series, frequency: str) -> list[dict[str, Any]]:
    if equity.empty:
        return []
    sampled = equity.resample(frequency).last().dropna()
    returns = sampled.pct_change().dropna() * 100
    return _series_records(returns, "return_pct")


def calculate_performance_analytics(
    history: Sequence[Mapping[str, Any]],
    *,
    trades: Sequence[Mapping[str, Any]] | None = None,
    portfolio: Mapping[str, Any] | None = None,
    latest_report: Mapping[str, Any] | None = None,
    benchmark_history: Sequence[Mapping[str, Any]] | None = None,
    risk_free_rate: float = RISK_FREE_RATE,
) -> dict[str, Any]:
    trades = trades or []
    portfolio = portfolio or {}
    latest_report = latest_report or {}
    frame = _history_frame(history)
    equity = pd.to_numeric(frame.get("equity", pd.Series(dtype=float)), errors="coerce").dropna()
    returns = equity.pct_change().dropna()
    observations = int(len(returns))
    short_reason = (
        f"年率・リスク調整後指標には{MIN_RETURN_OBSERVATIONS}日以上が必要です。"
        f"現在は{observations}日です。"
    )
    sufficient = observations >= MIN_RETURN_OBSERVATIONS
    summary = latest_report.get("summary", {})
    seed = _number(portfolio.get("seed_cost_basis"))
    if seed is None and not equity.empty:
        seed = float(equity.iloc[0]) - (_number(frame.iloc[0].get("total_pnl")) or 0.0)
    current_equity = float(equity.iloc[-1]) if not equity.empty else _number(summary.get("equity"))
    total_return = (
        (current_equity / seed - 1.0) * 100
        if current_equity is not None and seed is not None and seed > 0
        else None
    )
    daily_return = (
        float(returns.iloc[-1] * 100)
        if not returns.empty
        else _number(summary.get("daily_return_pct"))
    )
    drawdown = _drawdown_details(equity)

    groups: dict[str, dict[str, dict[str, Any]]] = {
        "return": {},
        "risk": {},
        "risk_adjusted": {},
        "trade_quality": {},
        "portfolio": {},
        "benchmark": {},
    }
    groups["return"]["total_return_pct"] = _metric(total_return, unit="pct")
    groups["return"]["daily_return_pct"] = _metric(daily_return, unit="pct")
    groups["return"]["cumulative_return_pct"] = _metric(total_return, unit="pct")

    if sufficient and not equity.empty:
        elapsed_days = max(1, int((equity.index[-1] - equity.index[0]).days))
        years = elapsed_days / 365.2425
        cagr = ((float(equity.iloc[-1]) / float(equity.iloc[0])) ** (1 / years) - 1) * 100
        annual_vol = float(returns.std(ddof=0) * math.sqrt(ANNUALIZATION) * 100)
        downside_values = returns[returns < 0]
        downside = (
            float(downside_values.std(ddof=0) * math.sqrt(ANNUALIZATION) * 100)
            if len(downside_values) >= 2
            else None
        )
        annual_return = float((returns.mean() * ANNUALIZATION - risk_free_rate) * 100)
        sharpe = annual_return / annual_vol if annual_vol > 0 else None
        sortino = annual_return / downside if downside is not None and downside > 0 else None
        calmar = (
            cagr / abs(float(drawdown["max_drawdown_pct"]))
            if drawdown["max_drawdown_pct"] is not None
            and float(drawdown["max_drawdown_pct"]) < 0
            else None
        )
        losses = returns[returns < 0]
        gains = returns[returns > 0]
        omega = float(gains.sum() / abs(losses.sum())) if not losses.empty and losses.sum() != 0 else None
        gain_to_pain = omega
        var95 = float(returns.quantile(0.05) * 100)
        tail = returns[returns <= returns.quantile(0.05)]
        cvar95 = float(tail.mean() * 100) if not tail.empty else None
        groups["return"]["cagr_pct"] = _metric(cagr, unit="pct_pa")
        groups["risk"]["annualized_volatility_pct"] = _metric(annual_vol, unit="pct_pa")
        groups["risk"]["downside_deviation_pct"] = _metric(downside, unit="pct_pa")
        groups["risk_adjusted"]["sharpe_ratio"] = _metric(sharpe, unit="ratio")
        groups["risk_adjusted"]["sortino_ratio"] = _metric(sortino, unit="ratio")
        groups["risk_adjusted"]["calmar_ratio"] = _metric(calmar, unit="ratio")
        groups["risk_adjusted"]["omega_ratio"] = _metric(omega, unit="ratio")
        groups["risk_adjusted"]["gain_to_pain_ratio"] = _metric(gain_to_pain, unit="ratio")
        groups["risk"]["var_95_pct"] = _metric(var95, unit="pct_daily")
        groups["risk"]["cvar_95_pct"] = _metric(cvar95, unit="pct_daily")
    else:
        for key, unit in (
            ("cagr_pct", "pct_pa"),
        ):
            groups["return"][key] = _unavailable("insufficient_history", short_reason, unit)
        for key, unit in (
            ("annualized_volatility_pct", "pct_pa"),
            ("downside_deviation_pct", "pct_pa"),
            ("var_95_pct", "pct_daily"),
            ("cvar_95_pct", "pct_daily"),
        ):
            groups["risk"][key] = _unavailable("insufficient_history", short_reason, unit)
        for key in (
            "sharpe_ratio",
            "sortino_ratio",
            "calmar_ratio",
            "omega_ratio",
            "gain_to_pain_ratio",
        ):
            groups["risk_adjusted"][key] = _unavailable(
                "insufficient_history", short_reason, "ratio"
            )

    drawdown_status = "ok" if observations > 0 else "limited_history"
    drawdown_reason = None if observations > 0 else "比較可能な日次資産履歴がまだありません。"
    groups["risk"]["max_drawdown_pct"] = _metric(
        drawdown["max_drawdown_pct"], status=drawdown_status, reason=drawdown_reason, unit="pct"
    )
    groups["risk"]["current_drawdown_pct"] = _metric(
        drawdown["current_drawdown_pct"], status=drawdown_status, reason=drawdown_reason, unit="pct"
    )
    groups["risk"]["ulcer_index"] = _metric(
        float(np.sqrt(np.mean(np.square(drawdown["series"] * 100))))
        if not drawdown["series"].empty
        else None,
        status=drawdown_status,
        reason=drawdown_reason,
        unit="index",
    )
    groups["risk"]["best_day_pct"] = _metric(
        float(returns.max() * 100) if not returns.empty else None,
        status="ok" if not returns.empty else "insufficient_history",
        reason=None if not returns.empty else "日次リターンがありません。",
        unit="pct_daily",
    )
    groups["risk"]["worst_day_pct"] = _metric(
        float(returns.min() * 100) if not returns.empty else None,
        status="ok" if not returns.empty else "insufficient_history",
        reason=None if not returns.empty else "日次リターンがありません。",
        unit="pct_daily",
    )
    groups["return"]["positive_day_ratio_pct"] = _metric(
        float((returns > 0).mean() * 100) if not returns.empty else None,
        status="ok" if not returns.empty else "insufficient_history",
        reason=None if not returns.empty else "日次リターンがありません。",
        unit="pct",
    )

    pnls, closed_holding_days = _trade_pnls(trades)
    trade_count = len(pnls)
    trade_reason = (
        f"取引品質指標には完了取引が{MIN_COMPLETED_TRADES}件以上必要です。"
        f"現在は{trade_count}件です。"
    )
    groups["trade_quality"]["trade_count"] = _metric(trade_count, unit="count")
    if trade_count >= MIN_COMPLETED_TRADES:
        winners = [value for value in pnls if value > 0]
        losers = [value for value in pnls if value < 0]
        average_win = float(np.mean(winners)) if winners else None
        average_loss = float(np.mean(losers)) if losers else None
        payoff = (
            average_win / abs(average_loss)
            if average_win is not None and average_loss is not None and average_loss != 0
            else None
        )
        gross_profit = sum(winners)
        gross_loss = abs(sum(losers))
        profit_factor = gross_profit / gross_loss if gross_loss > 0 else None
        expectancy = float(np.mean(pnls))
        groups["trade_quality"]["win_rate_pct"] = _metric(
            len(winners) / trade_count * 100, unit="pct"
        )
        groups["trade_quality"]["loss_rate_pct"] = _metric(
            len(losers) / trade_count * 100, unit="pct"
        )
        groups["trade_quality"]["average_win"] = _metric(average_win, unit="jpy")
        groups["trade_quality"]["average_loss"] = _metric(average_loss, unit="jpy")
        groups["trade_quality"]["payoff_ratio"] = _metric(payoff, unit="ratio")
        groups["trade_quality"]["risk_reward_ratio"] = _metric(payoff, unit="ratio")
        groups["trade_quality"]["profit_factor"] = _metric(profit_factor, unit="ratio")
        groups["trade_quality"]["expectancy_per_trade"] = _metric(expectancy, unit="jpy")
    else:
        for key, unit in (
            ("win_rate_pct", "pct"),
            ("loss_rate_pct", "pct"),
            ("average_win", "jpy"),
            ("average_loss", "jpy"),
            ("payoff_ratio", "ratio"),
            ("risk_reward_ratio", "ratio"),
            ("profit_factor", "ratio"),
            ("expectancy_per_trade", "jpy"),
        ):
            groups["trade_quality"][key] = _unavailable(
                "insufficient_trades", trade_reason, unit
            )

    open_holding_days: list[float] = []
    end_date = equity.index[-1] if not equity.empty else pd.Timestamp.now().normalize()
    for position in portfolio.get("positions", []):
        opened = _parse_date(position.get("opened_at"))
        if opened is not None:
            open_holding_days.append(max(0.0, float((end_date - opened).days)))
    all_holding_days = closed_holding_days + open_holding_days
    groups["trade_quality"]["average_holding_days"] = _metric(
        float(np.mean(all_holding_days)) if all_holding_days else None,
        status="ok" if all_holding_days else "unavailable",
        reason=None if all_holding_days else "保有開始日または完了取引がありません。",
        unit="days",
    )

    values, contributions = _position_values(portfolio, latest_report)
    market_value = sum(values)
    cash = _number(portfolio.get("cash")) or 0.0
    equity_value = current_equity if current_equity is not None else market_value + cash
    weights = [value / market_value for value in values] if market_value > 0 else []
    hhi = sum(weight * weight for weight in weights) if weights else None
    max_weight = max(weights) * 100 if weights else None
    exposure = market_value / equity_value * 100 if equity_value and equity_value > 0 else None
    cash_ratio = cash / equity_value * 100 if equity_value and equity_value > 0 else None
    turnover_total = float(frame["turnover"].fillna(0.0).sum()) if not frame.empty else 0.0
    turnover_ratio = turnover_total / float(equity.mean()) if not equity.empty and equity.mean() > 0 else None
    groups["portfolio"]["turnover_ratio"] = _metric(turnover_ratio, unit="ratio")
    groups["portfolio"]["gross_exposure_pct"] = _metric(exposure, unit="pct")
    groups["portfolio"]["net_exposure_pct"] = _metric(exposure, unit="pct")
    groups["portfolio"]["cash_ratio_pct"] = _metric(cash_ratio, unit="pct")
    groups["portfolio"]["concentration_hhi"] = _metric(hhi, unit="ratio")
    groups["portfolio"]["max_position_weight_pct"] = _metric(max_weight, unit="pct")
    groups["portfolio"]["position_count"] = _metric(len(values), unit="count")
    groups["portfolio"]["recovery_factor"] = _metric(
        (_number(summary.get("total_pnl")) or 0.0) / abs(float(drawdown["amount"]))
        if drawdown["amount"] is not None and float(drawdown["amount"]) < 0
        else None,
        status="ok" if drawdown["amount"] is not None and float(drawdown["amount"]) < 0 else "unavailable",
        reason=None
        if drawdown["amount"] is not None and float(drawdown["amount"]) < 0
        else "観測された資産ドローダウン額がありません。",
        unit="ratio",
    )

    benchmark_equity = _benchmark_frame(benchmark_history)
    benchmark_returns = benchmark_equity.pct_change().dropna()
    aligned = pd.concat([returns.rename("portfolio"), benchmark_returns.rename("benchmark")], axis=1).dropna()
    benchmark_reason = "同一日付で20日以上のベンチマーク履歴が必要です。"
    if len(aligned) >= MIN_RETURN_OBSERVATIONS:
        variance = float(aligned["benchmark"].var(ddof=0))
        beta = (
            float(aligned["portfolio"].cov(aligned["benchmark"], ddof=0) / variance)
            if variance > 0
            else None
        )
        alpha = (
            float((aligned["portfolio"].mean() - (beta or 0.0) * aligned["benchmark"].mean()) * ANNUALIZATION * 100)
            if beta is not None
            else None
        )
        correlation = float(aligned["portfolio"].corr(aligned["benchmark"]))
        excess = aligned["portfolio"] - aligned["benchmark"]
        tracking_error = float(excess.std(ddof=0) * math.sqrt(ANNUALIZATION) * 100)
        information = (
            float(excess.mean() * ANNUALIZATION * 100 / tracking_error)
            if tracking_error > 0
            else None
        )
        portfolio_total = float((1 + aligned["portfolio"]).prod() - 1) * 100
        benchmark_total = float((1 + aligned["benchmark"]).prod() - 1) * 100
        groups["benchmark"]["beta"] = _metric(beta, unit="ratio")
        groups["benchmark"]["alpha_pct"] = _metric(alpha, unit="pct_pa")
        groups["benchmark"]["correlation"] = _metric(correlation, unit="ratio")
        groups["benchmark"]["tracking_error_pct"] = _metric(tracking_error, unit="pct_pa")
        groups["benchmark"]["information_ratio"] = _metric(information, unit="ratio")
        groups["benchmark"]["benchmark_excess_return_pct"] = _metric(
            portfolio_total - benchmark_total, unit="pct"
        )
    else:
        status = "benchmark_unavailable" if benchmark_equity.empty else "insufficient_history"
        for key, unit in (
            ("beta", "ratio"),
            ("alpha_pct", "pct_pa"),
            ("correlation", "ratio"),
            ("tracking_error_pct", "pct_pa"),
            ("information_ratio", "ratio"),
            ("benchmark_excess_return_pct", "pct"),
        ):
            groups["benchmark"][key] = _unavailable(status, benchmark_reason, unit)

    cumulative_pnl = equity - (seed or (float(equity.iloc[0]) if not equity.empty else 0.0))
    daily_pnl = equity.diff()
    if not frame.empty and not daily_pnl.empty and pd.isna(daily_pnl.iloc[0]):
        daily_pnl.iloc[0] = _number(frame.iloc[0].get("total_pnl")) or 0.0
    contribution_rows: list[dict[str, Any]] = []
    positions = portfolio.get("positions", [])
    for index, contribution in enumerate(contributions):
        position = positions[index] if index < len(positions) else {}
        contribution_rows.append(
            {
                "symbol": position.get("symbol"),
                "company_name": position.get("company_name"),
                "contribution": _round(contribution, 2),
                "contribution_pct": _round(contribution / seed * 100, 6) if seed else None,
            }
        )

    warnings: list[str] = []
    if not sufficient:
        warnings.append(short_reason)
    if trade_count < MIN_COMPLETED_TRADES:
        warnings.append(trade_reason)
    if benchmark_equity.empty:
        warnings.append("ベンチマーク履歴がないため相対指標は未計算です。")

    return {
        "schema_version": 1,
        "generated_at": dt.datetime.now(dt.timezone.utc).isoformat(),
        "risk_free_rate": risk_free_rate,
        "annualization": ANNUALIZATION,
        "observation_count": observations,
        "completed_trade_count": trade_count,
        "history_status": "ok" if sufficient else "insufficient_history",
        "trade_status": "ok" if trade_count >= MIN_COMPLETED_TRADES else "insufficient_trades",
        "benchmark_status": "ok" if len(aligned) >= MIN_RETURN_OBSERVATIONS else "benchmark_unavailable",
        "groups": groups,
        "drawdown_details": {
            "start": drawdown["start"],
            "trough": drawdown["trough"],
            "recovery": drawdown["recovery"],
            "duration_days": drawdown["duration_days"],
            "recovery_days": drawdown["recovery_days"],
            "recovered": drawdown["recovery"] is not None,
        },
        "series": {
            "equity": _series_records(equity, "equity"),
            "daily_pnl": _series_records(daily_pnl, "pnl"),
            "cumulative_pnl": _series_records(cumulative_pnl, "pnl"),
            "drawdown": _series_records(drawdown["series"] * 100, "drawdown_pct"),
            "weekly_returns": _period_returns(equity, "W-FRI"),
            "monthly_returns": _period_returns(equity, "ME"),
            "contributions": contribution_rows,
        },
        "warnings": warnings,
        "disclaimer": "デモ運用の分析です。短い履歴から年率値を推測せず、利益を保証しません。",
    }


def _load_json(path: Path, default: Any) -> Any:
    if not path.exists():
        return default
    return json.loads(path.read_text(encoding="utf-8"))


def _write_json(path: Path, payload: Any) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(
        json.dumps(payload, ensure_ascii=False, indent=2, allow_nan=False) + "\n",
        encoding="utf-8",
    )


def update_paper_report(root: Path) -> dict[str, Any]:
    data_dir = root / "web" / "data" / "paper-trading"
    latest_path = data_dir / "latest-report.json"
    latest = _load_json(latest_path, {})
    if not latest:
        raise FileNotFoundError(f"paper report not found: {latest_path}")
    history_payload = _load_json(data_dir / "equity-history.json", {"history": []})
    trades_payload = _load_json(data_dir / "trades.json", {"trades": []})
    portfolio = _load_json(data_dir / "portfolio.json", {})
    benchmark_payload = _load_json(data_dir / "benchmark-history.json", {"history": []})
    analytics = calculate_performance_analytics(
        history_payload.get("history", []),
        trades=trades_payload.get("trades", []),
        portfolio=portfolio,
        latest_report=latest,
        benchmark_history=benchmark_payload.get("history", []),
    )
    latest["performance_analytics"] = analytics
    _write_json(latest_path, latest)
    trading_date = latest.get("trading_date")
    if trading_date:
        daily_path = data_dir / "daily-reports" / f"{trading_date}.json"
        if daily_path.exists():
            daily = _load_json(daily_path, {})
            daily["performance_analytics"] = analytics
            _write_json(daily_path, daily)
    _write_json(data_dir / "performance-analytics.json", analytics)
    return analytics


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description="Calculate paper portfolio performance analytics")
    parser.add_argument("--root", type=Path, default=Path.cwd())
    args = parser.parse_args(argv)
    result = update_paper_report(args.root)
    print(
        json.dumps(
            {
                "observation_count": result["observation_count"],
                "completed_trade_count": result["completed_trade_count"],
                "history_status": result["history_status"],
                "trade_status": result["trade_status"],
                "benchmark_status": result["benchmark_status"],
            },
            ensure_ascii=False,
        )
    )
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
