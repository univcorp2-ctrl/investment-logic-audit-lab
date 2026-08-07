from __future__ import annotations

import argparse
import datetime as dt
import json
from pathlib import Path

from .adaptive_parameter_learner import load_active_strategy_config
from .daily_monitor import StrategyConfig, run_monitor, write_json


def run_adaptive_monitor(
    root: Path,
    execute_simulation: bool = False,
    trading_date: dt.date | None = None,
) -> dict:
    config, learning = load_active_strategy_config(root, StrategyConfig())
    report = run_monitor(
        root,
        execute_simulation=execute_simulation,
        trading_date=trading_date,
        config=config,
    )
    report["adaptive_learning"] = learning
    data_dir = root / "web" / "data" / "paper-trading"
    write_json(data_dir / "latest-report.json", report)
    write_json(
        data_dir / "daily-reports" / f"{report['trading_date']}.json",
        report,
    )
    return report


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description="Daily adaptive paper-only monitor")
    parser.add_argument("--root", type=Path, default=Path.cwd())
    parser.add_argument("--execute-simulation", action="store_true")
    parser.add_argument("--date", type=dt.date.fromisoformat)
    args = parser.parse_args(argv)
    report = run_adaptive_monitor(args.root, args.execute_simulation, args.date)
    summary = report["summary"]
    print(
        json.dumps(
            {
                "trading_date": report["trading_date"],
                "mode": report["mode"],
                "adaptive_learning": report["adaptive_learning"],
                "equity": summary["equity"],
                "total_pnl": summary["total_pnl"],
                "paper_only": True,
            },
            ensure_ascii=False,
        )
    )
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
