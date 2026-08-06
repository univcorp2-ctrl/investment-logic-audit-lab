from __future__ import annotations

import pandas as pd

from investment_audit.performance_analytics import AnalyticsConfig, calculate_performance_analytics


def base_report(equity: float, total_pnl: float) -> dict:
    return {
        "summary": {
            "equity": equity,
            "realized_pnl": 100.0,
            "unrealized_pnl": total_pnl - 100.0,
            "total_pnl": total_pnl,
            "cumulative_return_pct": (equity / 10_000.0 - 1) * 100,
            "turnover_today": 0.0,
        },
        "decisions": [
            {
                "code": "1000",
                "company_name": "例社",
                "holding": {"quantity": 100, "avg_cost": 100.0},
                "technical": {"price": equity / 100.0},
                "quote": {"valid": True},
            }
        ],
    }


def test_short_history_suppresses_annualized_ratios() -> None:
    history = [
        {"date": "2026-08-03", "equity": 10_100.0, "total_pnl": 100.0, "daily_return_pct": 1.0, "cumulative_return_pct": 1.0},
        {"date": "2026-08-04", "equity": 10_000.0, "total_pnl": 0.0, "daily_return_pct": -0.9901, "cumulative_return_pct": 0.0},
    ]
    result = calculate_performance_analytics(history, base_report(10_000.0, 0.0), {"seed_cost_basis": 10_000.0}, [], pd.Series(dtype=float))
    assert result["sample"]["observations"] == 2
    assert result["risk_adjusted"]["sharpe_ratio"]["value"] is None
    assert result["risk_adjusted"]["sharpe_ratio"]["status"] == "insufficient_history"
    assert result["risk"]["annualized_volatility_pct"]["value"] is None


def test_drawdown_peak_trough_and_recovery_are_identified() -> None:
    history = [
        {"date": "2026-01-02", "equity": 11_000.0, "total_pnl": 1_000.0, "daily_return_pct": 10.0, "cumulative_return_pct": 10.0},
        {"date": "2026-01-05", "equity": 9_900.0, "total_pnl": -100.0, "daily_return_pct": -10.0, "cumulative_return_pct": -1.0},
        {"date": "2026-01-06", "equity": 11_100.0, "total_pnl": 1_100.0, "daily_return_pct": 12.1212, "cumulative_return_pct": 11.0},
    ]
    result = calculate_performance_analytics(history, base_report(11_100.0, 1_100.0), {"seed_cost_basis": 10_000.0}, [], pd.Series(dtype=float))
    details = result["drawdown_details"]
    assert round(result["risk"]["max_drawdown_pct"]["value"], 2) == -10.0
    assert str(details["peak_date"]).startswith("2026-01-02")
    assert str(details["trough_date"]).startswith("2026-01-05")
    assert str(details["recovery_date"]).startswith("2026-01-06")
    assert details["drawdown_duration_periods"] == 1
    assert details["recovery_duration_periods"] == 1


def test_distribution_metrics_and_benchmark_are_calculated_with_enough_data() -> None:
    dates = pd.date_range("2026-01-01", periods=80, freq="B")
    daily = [0.4 if index % 3 else -0.2 for index in range(80)]
    equity = 10_000.0
    history = []
    benchmark = []
    for date, daily_pct in zip(dates, daily, strict=True):
        equity *= 1 + daily_pct / 100
        history.append({"date": date.date().isoformat(), "equity": equity, "total_pnl": equity - 10_000.0, "daily_return_pct": daily_pct, "cumulative_return_pct": (equity / 10_000.0 - 1) * 100})
        benchmark.append(100.0 + len(benchmark) * 0.1)
    benchmark_series = pd.Series(benchmark, index=dates)
    result = calculate_performance_analytics(history, base_report(equity, equity - 10_000.0), {"seed_cost_basis": 10_000.0}, [], benchmark_series, AnalyticsConfig())
    assert result["risk_adjusted"]["sharpe_ratio"]["status"] == "ok"
    assert result["risk"]["historical_var_95_pct"]["value"] is not None
    assert result["trading_quality"]["profit_factor"]["value"] is not None
    assert result["benchmark"]["paired_observations"] > 20


def test_contribution_series_uses_validated_mark() -> None:
    history = [{"date": "2026-08-03", "equity": 10_500.0, "total_pnl": 500.0, "daily_return_pct": 5.0, "cumulative_return_pct": 5.0}]
    result = calculate_performance_analytics(history, base_report(10_500.0, 500.0), {"seed_cost_basis": 10_000.0}, [], pd.Series(dtype=float))
    contribution = result["series"]["contributions"][0]
    assert contribution["pnl"] == 500.0
    assert contribution["return_pct"] == 5.0
