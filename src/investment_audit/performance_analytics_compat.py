from __future__ import annotations

from dataclasses import dataclass
from typing import Any

import pandas as pd

from .performance_analytics import AnalyticsConfig, calculate_performance_analytics


@dataclass(frozen=True)
class PerformanceConfig:
    annualization: int = 252
    minimum_reliable_observations: int = 60
    minimum_distribution_observations: int = 20
    benchmark_symbol: str = "1306.T"
    benchmark_name: str = "TOPIX連動型上場投資信託 (1306.T proxy)"
    risk_free_rate_annual: float = 0.0
    var_level: float = 0.95


def _number(value: Any) -> float | None:
    if value is None:
        return None
    try:
        parsed = float(value)
    except (TypeError, ValueError):
        return None
    return parsed if pd.notna(parsed) else None


def _seed_cost(summary: dict[str, Any], seed_positions: list[dict[str, Any]]) -> float | None:
    direct = _number(summary.get("seed_cost_basis"))
    if direct is not None:
        return direct
    total = 0.0
    found = False
    for position in seed_positions:
        price = _number(position.get("entry_price"))
        quantity = _number(position.get("quantity")) or 100.0
        if price is None:
            continue
        total += price * quantity
        found = True
    return total if found else None


def analyze_performance(
    history: list[dict[str, Any]],
    trades: list[dict[str, Any]],
    positions: list[dict[str, Any]],
    summary: dict[str, Any],
    *,
    seed_positions: list[dict[str, Any]] | None = None,
    benchmark_history: pd.DataFrame | None = None,
    benchmark_error: str | None = None,
    config: PerformanceConfig = PerformanceConfig(),
    generated_at: str | None = None,
) -> dict[str, Any]:
    seed_positions = seed_positions or []
    seed_cost = _seed_cost(summary, seed_positions)
    decisions = []
    for position in positions:
        symbol = str(position.get("symbol") or "")
        code = symbol.removesuffix(".T")
        current_price = _number(position.get("current_price"))
        decisions.append(
            {
                "symbol": symbol,
                "code": code,
                "company_name": position.get("company_name") or code,
                "holding": {
                    "quantity": position.get("quantity", 0),
                    "avg_cost": position.get("avg_cost"),
                },
                "technical": {"price": current_price},
                "quote": {"valid": current_price is not None},
            }
        )
    latest_report = {
        "generated_at": generated_at,
        "summary": summary,
        "decisions": decisions,
    }
    portfolio_state = {
        "seed_cost_basis": seed_cost,
        "cash": summary.get("cash", 0.0),
    }
    benchmark_prices = pd.Series(dtype=float)
    if benchmark_history is not None and not benchmark_history.empty and "close" in benchmark_history:
        benchmark_prices = pd.to_numeric(benchmark_history["close"], errors="coerce").dropna()
    history_for_engine = [
        {
            **row,
            "daily_return_pct": row.get("daily_return_pct"),
            "realized_pnl": row.get("realized_pnl"),
            "unrealized_pnl": row.get("unrealized_pnl"),
            "total_pnl": row.get("total_pnl"),
        }
        for row in history
    ]
    analytics = calculate_performance_analytics(
        history_for_engine,
        latest_report,
        portfolio_state,
        trades,
        benchmark_prices,
        AnalyticsConfig(
            annualization=config.annualization,
            min_distribution_observations=config.minimum_distribution_observations,
            min_annualized_observations=config.minimum_reliable_observations,
            var_level=config.var_level,
            risk_free_rate_annual=config.risk_free_rate_annual,
            benchmark_symbol=config.benchmark_symbol,
            benchmark_name=config.benchmark_name,
        ),
    )
    observations = int(analytics.get("sample", {}).get("observations") or 0)
    equity_observations = len(history)
    reliability_status = "ok" if observations >= config.minimum_reliable_observations else "insufficient_history"
    benchmark_status = "unavailable" if benchmark_error else (
        "ok" if int(analytics.get("benchmark", {}).get("paired_observations") or 0) >= config.minimum_distribution_observations else "insufficient_history"
    )
    benchmark = {
        "status": benchmark_status,
        "symbol": config.benchmark_symbol,
        "name": config.benchmark_name,
        "error": benchmark_error,
        **analytics.get("benchmark", {}),
    }
    benchmark["status"] = benchmark_status
    return {
        "schema_version": 2,
        "generated_at": generated_at,
        "reliability": {
            "status": reliability_status,
            "equity_observations": equity_observations,
            "return_observations": observations,
            "minimum_reliable_observations": config.minimum_reliable_observations,
            "note": None if reliability_status == "ok" else f"年率指標は{config.minimum_reliable_observations}営業日以上を推奨。現在{observations}日。",
        },
        "metrics": {
            "basic": analytics.get("performance", {}),
            "risk": analytics.get("risk", {}),
            "risk_adjusted": analytics.get("risk_adjusted", {}),
            "trading_quality": analytics.get("trading_quality", {}),
        },
        "drawdown": analytics.get("drawdown_details", {}),
        "benchmark": benchmark,
        "series": analytics.get("series", {}),
        "warnings": analytics.get("warnings", []),
        "definitions": analytics.get("definitions", {}),
        "paper_only": True,
    }
