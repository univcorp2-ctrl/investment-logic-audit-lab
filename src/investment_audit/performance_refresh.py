from __future__ import annotations

import argparse
import json
from pathlib import Path
from typing import Any

import pandas as pd
import requests

from .daily_monitor import fetch_chart
from .performance_analytics import PerformanceConfig, analyze_performance


def _load(path: Path, default: Any) -> Any:
    if not path.exists():
        return default
    return json.loads(path.read_text(encoding="utf-8"))


def _write(path: Path, payload: Any) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(
        json.dumps(payload, ensure_ascii=False, indent=2, allow_nan=False) + "\n",
        encoding="utf-8",
    )


def refresh_performance(root: Path, config: PerformanceConfig = PerformanceConfig()) -> dict[str, Any]:
    data = root / "web" / "data" / "paper-trading"
    report_path = data / "latest-report.json"
    report = _load(report_path, {"summary": {}, "decisions": []})
    history = _load(data / "equity-history.json", {"history": []}).get("history", [])
    trades = _load(data / "trades.json", {"trades": []}).get("trades", [])
    portfolio = _load(data / "portfolio.json", {"positions": [], "cash": 0.0})
    demo = _load(root / "web" / "demo-portfolio.json", {"positions": []})
    decision_map = {str(item.get("symbol")): item for item in report.get("decisions", [])}
    positions: list[dict[str, Any]] = []
    for position in portfolio.get("positions", []):
        enriched = dict(position)
        decision = decision_map.get(str(position.get("symbol")), {})
        if decision.get("quote", {}).get("valid"):
            enriched["current_price"] = decision.get("technical", {}).get("price")
        else:
            enriched["current_price"] = position.get("avg_cost")
        positions.append(enriched)
    summary = dict(report.get("summary", {}))
    summary.setdefault("cash", portfolio.get("cash", 0.0))
    summary.setdefault("seed_cost_basis", portfolio.get("seed_cost_basis"))

    benchmark = pd.DataFrame()
    benchmark_error: str | None = None
    try:
        benchmark = fetch_chart(config.benchmark_symbol)
    except (requests.RequestException, ValueError, KeyError) as exc:
        benchmark_error = f"{type(exc).__name__}: benchmark fetch failed"

    analytics = analyze_performance(
        history,
        trades,
        positions,
        summary,
        seed_positions=demo.get("positions", []),
        benchmark_history=benchmark,
        benchmark_error=benchmark_error,
        config=config,
        generated_at=report.get("generated_at"),
    )
    _write(data / "performance-analytics.json", analytics)
    report["performance_analytics"] = {
        "reliability": analytics["reliability"],
        "period": analytics["period"],
        "basic": analytics["metrics"]["basic"],
        "risk": {
            key: analytics["metrics"]["risk"][key]
            for key in (
                "max_drawdown_pct",
                "current_drawdown_pct",
                "annualized_volatility_pct",
                "historical_var_pct",
            )
        },
        "risk_adjusted": analytics["metrics"]["risk_adjusted"],
    }
    _write(report_path, report)
    daily_path = data / "daily-reports" / f"{report.get('trading_date', 'latest')}.json"
    if daily_path.exists():
        daily = _load(daily_path, {})
        daily["performance_analytics"] = report["performance_analytics"]
        _write(daily_path, daily)
    return analytics


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description="Refresh paper portfolio performance analytics")
    parser.add_argument("--root", type=Path, default=Path.cwd())
    parser.add_argument("--risk-free-rate", type=float, default=0.0)
    parser.add_argument("--target-return", type=float, default=0.0)
    parser.add_argument("--var-confidence", type=float, default=0.95)
    args = parser.parse_args(argv)
    analytics = refresh_performance(
        args.root,
        PerformanceConfig(
            risk_free_rate_annual_pct=args.risk_free_rate,
            target_return_annual_pct=args.target_return,
            var_confidence=args.var_confidence,
        ),
    )
    print(
        json.dumps(
            {
                "status": analytics["reliability"]["status"],
                "observations": analytics["reliability"]["equity_observations"],
                "period": analytics["period"],
            },
            ensure_ascii=False,
        )
    )
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
