from __future__ import annotations

import json
from pathlib import Path

import pandas as pd

from investment_audit.performance_report import build_performance_report


def write(path: Path, payload: object) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps(payload), encoding="utf-8")


def test_report_builder_publishes_backward_compatible_analytics(tmp_path: Path) -> None:
    data = tmp_path / "web" / "data" / "paper-trading"
    write(
        data / "latest-report.json",
        {
            "generated_at": "2026-08-04T16:15:00+09:00",
            "trading_date": "2026-08-04",
            "summary": {
                "equity": 1100,
                "cash": 100,
                "realized_pnl": 20,
                "unrealized_pnl": 80,
                "total_pnl": 100,
            },
            "decisions": [
                {"symbol": "A.T", "technical": {"price": 100}, "holding": {"quantity": 10}}
            ],
        },
    )
    write(
        data / "portfolio.json",
        {
            "cash": 100,
            "seed_cost_basis": 1000,
            "positions": [{"symbol": "A.T", "quantity": 10, "avg_cost": 90}],
        },
    )
    write(
        data / "equity-history.json",
        {"history": [{"date": "2026-08-03", "equity": 1000}, {"date": "2026-08-04", "equity": 1100}]},
    )
    write(data / "trades.json", {"trades": []})
    write(
        tmp_path / "web" / "demo-portfolio.json",
        {"positions": [{"symbol": "A.T", "entry_price": 90, "entry_time": "2026-08-03"}]},
    )
    write(data / "daily-reports" / "2026-08-04.json", {"trading_date": "2026-08-04"})

    benchmark = pd.DataFrame(
        {"close": [100.0, 101.0]}, index=pd.to_datetime(["2026-08-03", "2026-08-04"])
    )
    result = build_performance_report(tmp_path, benchmark_loader=lambda symbol: benchmark)

    assert result["reliability"]["status"] == "insufficient_history"
    assert result["metrics"]["basic"]["total_return_pct"]["value"] == 10.0
    assert result["metrics"]["risk_adjusted"]["sharpe_ratio"]["value"] is None
    latest = json.loads((data / "latest-report.json").read_text(encoding="utf-8"))
    daily = json.loads(
        (data / "daily-reports" / "2026-08-04.json").read_text(encoding="utf-8")
    )
    assert "performance_analytics" in latest
    assert "performance_analytics" in daily
    assert (data / "performance-analytics.json").exists()
