from __future__ import annotations

import argparse
import datetime as dt
import json
from pathlib import Path
from typing import Any

from .daily_monitor import StrategyConfig, run_monitor, write_json


def _load(path: Path, default: Any) -> Any:
    if not path.exists():
        return default
    return json.loads(path.read_text(encoding="utf-8"))


def strategy_config_from_policy(root: Path) -> tuple[StrategyConfig, dict[str, Any]]:
    path = root / "web" / "data" / "adaptive-strategy" / "active-policy.json"
    policy = _load(path, {})
    metadata = {
        "source": str(path.relative_to(root)),
        "name": policy.get("name", "default"),
        "status": policy.get("status", "default"),
        "applied": False,
        "reason": "default_strategy",
        "operational_data_verified": policy.get("operational_data_verified") is True,
        "paper_only": True,
    }
    if not (
        policy.get("paper_only") is True
        and policy.get("status") == "active"
        and policy.get("guardrails_passed") is True
        and policy.get("operational_data_verified") is True
        and policy.get("real_order_allowed") is not True
    ):
        metadata["reason"] = "unverified_or_inactive_policy"
        return StrategyConfig(), metadata
    fundamental = policy.get("fundamental", {})
    technical = policy.get("technical", {})
    risk = policy.get("risk", {})
    config = StrategyConfig(
        buy_fundamental=float(fundamental.get("buy_fundamental", 58.0)),
        buy_quality=float(fundamental.get("buy_quality", 55.0)),
        buy_technical=float(technical.get("buy_technical", 60.0)),
        buy_completeness=float(fundamental.get("buy_completeness", 35.0)),
        buy_max_trap=float(fundamental.get("buy_max_trap", 50.0)),
        sell_fundamental=float(fundamental.get("sell_fundamental", 40.0)),
        sell_technical=float(technical.get("sell_technical", 35.0)),
        sell_trap=float(fundamental.get("sell_trap", 70.0)),
        stop_loss_pct=float(risk.get("stop_loss_pct", -8.0)),
        max_drawdown_pct=float(risk.get("max_drawdown_pct", -12.0)),
    )
    metadata.update({"applied": True, "reason": "verified_operational_policy"})
    return config, metadata


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description="Daily paper monitor with guarded adaptive policy")
    parser.add_argument("--root", type=Path, default=Path.cwd())
    parser.add_argument("--execute-simulation", action="store_true")
    parser.add_argument("--date", type=dt.date.fromisoformat)
    args = parser.parse_args(argv)
    config, policy_metadata = strategy_config_from_policy(args.root)
    report = run_monitor(
        args.root,
        execute_simulation=args.execute_simulation,
        trading_date=args.date,
        config=config,
    )
    report["adaptive_policy"] = policy_metadata
    data_dir = args.root / "web" / "data" / "paper-trading"
    write_json(data_dir / "latest-report.json", report)
    write_json(data_dir / "daily-reports" / f"{report['trading_date']}.json", report)
    print(
        json.dumps(
            {
                "trading_date": report["trading_date"],
                "adaptive_policy": policy_metadata,
                "equity": report["summary"]["equity"],
                "paper_only": True,
            },
            ensure_ascii=False,
        )
    )
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
