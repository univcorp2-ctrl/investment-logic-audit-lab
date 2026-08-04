from __future__ import annotations

import math

import numpy as np
import pandas as pd
import pytest

from investment_audit.performance_analytics import PerformanceConfig, analyze_performance


def history(values: list[float]) -> list[dict[str, object]]:
    dates = pd.date_range("2025-01-01", periods=len(values), freq="B")
    return [
        {
            "date": date.date().isoformat(),
            "equity": value,
            "realized_pnl": 0.0,
            "unrealized_pnl": value - values[0],
            "total_pnl": value - values[0],
        }
        for date, value in zip(dates, values, strict=True)
    ]


def metric(result: dict[str, object], category: str, name: str) -> dict[str, object]:
    return result["metrics"][category][name]  # type: ignore[index]


def test_drawdown_duration_and_recovery() -> None:
    result = analyze_performance(
        history([100, 120, 110, 90, 100, 120, 130]),
        [],
        [],
        {"equity": 130, "seed_cost_basis": 100, "realized_pnl": 0, "unrealized_pnl": 30, "total_pnl": 30},
    )
    assert metric(result, "risk", "max_drawdown_pct")["value"] == pytest.approx(-25.0)
    assert metric(result, "risk", "max_drawdown_duration_days")["value"] == 3
    assert metric(result, "risk", "max_recovery_duration_days")["value"] == 2


def test_short_history_explains_unavailable_ratios() -> None:
    result = analyze_performance(
        history([100]),
        [],
        [],
        {"equity": 105, "seed_cost_basis": 100, "realized_pnl": 0, "unrealized_pnl": 5, "total_pnl": 5},
    )
    sharpe = metric(result, "risk_adjusted", "sharpe_ratio")
    assert sharpe["value"] is None
    assert sharpe["status"] == "unavailable"
    assert "30" in str(sharpe["reason"])
    assert result["reliability"]["status"] == "insufficient_history"
    assert len(result["chart_series"]) == 1
    assert result["chart_series"][0]["daily_pnl"] is None


def test_sharpe_sortino_calmar_and_omega_are_finite_with_long_history() -> None:
    returns = np.array([0.004, -0.002, 0.003, 0.001, -0.001] * 30)
    values = [100.0]
    for value in returns:
        values.append(values[-1] * (1 + value))
    config = PerformanceConfig(min_annualized_returns=30, min_long_horizon_returns=126)
    result = analyze_performance(
        history(values),
        [],
        [],
        {"equity": values[-1], "seed_cost_basis": values[0], "realized_pnl": 0, "unrealized_pnl": values[-1] - values[0], "total_pnl": values[-1] - values[0]},
        config=config,
    )
    for name in ("sharpe_ratio", "sortino_ratio", "calmar_ratio", "omega_ratio"):
        value = metric(result, "risk_adjusted", name)["value"]
        assert value is not None and math.isfinite(float(value))


def test_var_cvar_profit_factor_payoff_expectancy_and_streaks() -> None:
    values = [100, 110, 104.5, 115, 103.5, 108.675]
    result = analyze_performance(
        history(values),
        [],
        [],
        {"equity": values[-1], "seed_cost_basis": 100, "realized_pnl": 0, "unrealized_pnl": 8.675, "total_pnl": 8.675},
        config=PerformanceConfig(min_annualized_returns=4, min_long_horizon_returns=5),
    )
    assert metric(result, "risk", "cvar_expected_shortfall_pct")["value"] <= metric(result, "risk", "historical_var_pct")["value"]
    assert metric(result, "win_loss", "profit_factor")["value"] is not None
    assert metric(result, "win_loss", "payoff_ratio")["value"] is not None
    assert metric(result, "win_loss", "expectancy_pct")["value"] is not None
    assert metric(result, "win_loss", "longest_winning_streak")["value"] == 1


def test_benchmark_alpha_beta_and_information_ratio() -> None:
    portfolio_returns = np.array([0.002, -0.001, 0.003, 0.001] * 40)
    benchmark_returns = portfolio_returns * 0.6
    portfolio_values = [100.0]
    benchmark_values = [100.0]
    for left, right in zip(portfolio_returns, benchmark_returns, strict=True):
        portfolio_values.append(portfolio_values[-1] * (1 + left))
        benchmark_values.append(benchmark_values[-1] * (1 + right))
    dates = pd.date_range("2025-01-01", periods=len(benchmark_values), freq="B")
    benchmark = pd.DataFrame({"close": benchmark_values}, index=dates)
    result = analyze_performance(
        history(portfolio_values),
        [],
        [],
        {"equity": portfolio_values[-1], "seed_cost_basis": 100, "realized_pnl": 0, "unrealized_pnl": portfolio_values[-1] - 100, "total_pnl": portfolio_values[-1] - 100},
        benchmark_history=benchmark,
    )
    assert metric(result, "risk_adjusted", "beta")["value"] == pytest.approx(1 / 0.6, rel=0.1)
    assert metric(result, "risk_adjusted", "information_ratio")["value"] is not None
    assert metric(result, "risk_adjusted", "annualized_alpha_pct")["value"] is not None


def test_concentration_closed_trade_win_rate_and_holding_period() -> None:
    result = analyze_performance(
        history([100, 101]),
        [{"date": "2025-01-10", "side": "SIM_SELL", "symbol": "A.T", "price": 120, "value": 1200}],
        [
            {"symbol": "B.T", "quantity": 5, "avg_cost": 100, "current_price": 100},
            {"symbol": "C.T", "quantity": 5, "avg_cost": 100, "current_price": 100},
        ],
        {"equity": 1000, "cash": 0, "seed_cost_basis": 100, "realized_pnl": 20, "unrealized_pnl": 0, "total_pnl": 20},
        seed_positions=[{"symbol": "A.T", "entry_price": 100, "entry_time": "2025-01-01"}],
    )
    assert metric(result, "trading_portfolio", "hhi_concentration")["value"] == pytest.approx(0.5)
    assert metric(result, "trading_portfolio", "effective_positions")["value"] == pytest.approx(2.0)
    assert metric(result, "trading_portfolio", "closed_trade_win_rate_pct")["value"] == 100.0
    assert metric(result, "trading_portfolio", "average_holding_period_days")["value"] == 9.0
