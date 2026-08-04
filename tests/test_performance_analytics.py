from __future__ import annotations

import math

import numpy as np
import pandas as pd

from investment_audit.performance_analytics import calculate_performance_analytics


def history_from_equity(values: list[float], start: str = "2026-01-01") -> list[dict[str, object]]:
    dates = pd.date_range(start, periods=len(values), freq="B")
    return [
        {"date": date.date().isoformat(), "equity": value, "turnover_today": 0.0}
        for date, value in zip(dates, values, strict=True)
    ]


def metric(result: dict[str, object], group: str, name: str) -> dict[str, object]:
    return result["groups"][group][name]  # type: ignore[index]


def test_drawdown_dates_duration_and_current_drawdown() -> None:
    result = calculate_performance_analytics(history_from_equity([100, 120, 90, 100, 120, 110]))
    details = result["drawdown_details"]
    assert details["start"] == "2026-01-02"
    assert details["trough"] == "2026-01-05"
    assert details["recovery"] == "2026-01-07"
    assert details["duration_days"] == 5
    assert math.isclose(float(metric(result, "risk", "max_drawdown_pct")["value"]), -25.0)
    assert math.isclose(
        float(metric(result, "risk", "current_drawdown_pct")["value"]),
        -8.333333,
        rel_tol=1e-5,
    )


def test_sufficient_history_calculates_risk_adjusted_metrics() -> None:
    returns = np.array([0.004, -0.002, 0.003, -0.001, 0.005] * 10)
    equity = (100_000 * np.cumprod(1 + returns)).tolist()
    result = calculate_performance_analytics(history_from_equity([100_000, *equity]))
    assert result["history_status"] == "ok"
    assert metric(result, "return", "cagr_pct")["value"] is not None
    assert metric(result, "risk", "annualized_volatility_pct")["value"] is not None
    assert metric(result, "risk_adjusted", "sharpe_ratio")["value"] is not None
    assert metric(result, "risk_adjusted", "sortino_ratio")["value"] is not None
    assert metric(result, "risk_adjusted", "calmar_ratio")["value"] is not None
    assert metric(result, "risk_adjusted", "omega_ratio")["value"] is not None
    assert metric(result, "risk", "var_95_pct")["value"] is not None
    assert metric(result, "risk", "cvar_95_pct")["value"] is not None


def test_trade_quality_metrics_use_realized_trade_pnl() -> None:
    trades = [
        {"side": "SIM_SELL", "realized_pnl": value, "holding_days": 10 + index}
        for index, value in enumerate([100, -50, 200, -100, 150, -50])
    ]
    result = calculate_performance_analytics(
        history_from_equity(list(np.linspace(1000, 1100, 25))), trades=trades
    )
    assert result["trade_status"] == "ok"
    payoff = float(metric(result, "trade_quality", "payoff_ratio")["value"])
    risk_reward = float(metric(result, "trade_quality", "risk_reward_ratio")["value"])
    assert math.isclose(payoff, risk_reward)
    assert math.isclose(payoff, 2.0)
    assert math.isclose(float(metric(result, "trade_quality", "profit_factor")["value"]), 3.0)
    assert math.isclose(
        float(metric(result, "trade_quality", "expectancy_per_trade")["value"]),
        41.666667,
        rel_tol=1e-5,
    )


def test_concentration_and_exposure() -> None:
    portfolio = {
        "seed_cost_basis": 300,
        "cash": 100,
        "positions": [
            {"symbol": "A.T", "quantity": 1, "avg_cost": 100},
            {"symbol": "B.T", "quantity": 1, "avg_cost": 200},
        ],
    }
    report = {
        "summary": {"equity": 400, "total_pnl": 0},
        "decisions": [
            {"symbol": "A.T", "technical": {"price": 100}},
            {"symbol": "B.T", "technical": {"price": 200}},
        ],
    }
    result = calculate_performance_analytics(
        history_from_equity([400]), portfolio=portfolio, latest_report=report
    )
    assert math.isclose(float(metric(result, "portfolio", "gross_exposure_pct")["value"]), 75.0)
    assert math.isclose(float(metric(result, "portfolio", "cash_ratio_pct")["value"]), 25.0)
    assert math.isclose(
        float(metric(result, "portfolio", "concentration_hhi")["value"]),
        5 / 9,
        rel_tol=1e-5,
    )
    assert math.isclose(
        float(metric(result, "portfolio", "max_position_weight_pct")["value"]),
        66.666667,
        rel_tol=1e-5,
    )


def test_benchmark_metrics_and_excess_return() -> None:
    dates = pd.date_range("2026-01-01", periods=31, freq="B")
    portfolio_returns = np.array([0.002, -0.001, 0.003] * 10)
    benchmark_returns = np.array([0.001, -0.0005, 0.0015] * 10)
    portfolio_equity = [100.0, *(100 * np.cumprod(1 + portfolio_returns)).tolist()]
    benchmark_equity = [100.0, *(100 * np.cumprod(1 + benchmark_returns)).tolist()]
    history = [
        {"date": date.date().isoformat(), "equity": value}
        for date, value in zip(dates, portfolio_equity, strict=True)
    ]
    benchmark = [
        {"date": date.date().isoformat(), "close": value}
        for date, value in zip(dates, benchmark_equity, strict=True)
    ]
    result = calculate_performance_analytics(history, benchmark_history=benchmark)
    assert result["benchmark_status"] == "ok"
    assert metric(result, "benchmark", "beta")["value"] is not None
    assert metric(result, "benchmark", "alpha_pct")["value"] is not None
    assert metric(result, "benchmark", "correlation")["value"] is not None
    assert metric(result, "benchmark", "tracking_error_pct")["value"] is not None
    assert metric(result, "benchmark", "information_ratio")["value"] is not None
    assert float(metric(result, "benchmark", "benchmark_excess_return_pct")["value"]) > 0


def test_insufficient_history_trades_and_benchmark_are_explicit() -> None:
    result = calculate_performance_analytics(history_from_equity([100, 101]))
    assert result["history_status"] == "insufficient_history"
    assert result["trade_status"] == "insufficient_trades"
    assert result["benchmark_status"] == "benchmark_unavailable"
    assert metric(result, "return", "cagr_pct")["value"] is None
    assert metric(result, "return", "cagr_pct")["status"] == "insufficient_history"
    assert metric(result, "trade_quality", "risk_reward_ratio")["value"] is None
    assert metric(result, "trade_quality", "risk_reward_ratio")["status"] == "insufficient_trades"
    assert metric(result, "benchmark", "beta")["value"] is None
