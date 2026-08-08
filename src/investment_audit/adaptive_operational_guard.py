from __future__ import annotations

import argparse
import datetime as dt
import json
import math
from dataclasses import asdict, dataclass
from pathlib import Path
from typing import Any

from .adaptive_strategy import DEFAULT_POLICY, PROFILES, objective


@dataclass(frozen=True)
class OperationalGuardConfig:
    minimum_operational_sessions: int = 169
    minimum_oos_sessions: int = 42
    minimum_windows: int = 3
    minimum_stability: float = 0.60
    improvement_margin: float = 0.50
    max_drawdown_tolerance_pct: float = 1.0
    max_turnover: float = 12.0
    required_confirmations: int = 2


def _number(value: Any) -> float | None:
    try:
        parsed = float(value)
    except (TypeError, ValueError):
        return None
    return parsed if math.isfinite(parsed) else None


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


def _profile_metrics(operational: dict[str, Any]) -> dict[str, dict[str, Any]]:
    aliases = {
        "baseline_equal_weight": "balanced",
        "trend_confirmed": "trend",
        "quality_value": "quality",
        "low_volatility": "low_volatility",
        "inverse_volatility": "low_volatility",
        "momentum_confirmed": "trend",
    }
    stability = _number(
        operational.get("walk_forward", {}).get("parameter_stability")
    )
    output: dict[str, dict[str, Any]] = {}
    for row in operational.get("strategies", []):
        name = aliases.get(str(row.get("name")))
        if not name:
            continue
        values = {**(row.get("metrics") or {})}
        values["baseline_excess_pct"] = row.get("baseline_excess_pct")
        values["parameter_stability"] = stability
        current = output.get(name)
        if current is None or (_number(values.get("total_return_pct")) or -math.inf) > (
            _number(current.get("total_return_pct")) or -math.inf
        ):
            output[name] = values
    return output


def evaluate_operational_guard(
    operational: dict[str, Any],
    diagnostics: dict[str, Any],
    paper_observations: int,
    previous_history: list[dict[str, Any]],
    config: OperationalGuardConfig = OperationalGuardConfig(),
    now: dt.datetime | None = None,
) -> dict[str, Any]:
    now = now or dt.datetime.now(dt.timezone.utc)
    metrics_by_profile = _profile_metrics(operational)
    champion_metrics = metrics_by_profile.get("balanced", {})
    candidates: list[dict[str, Any]] = []
    for name, policy in PROFILES.items():
        values = metrics_by_profile.get(name, {})
        candidates.append(
            {
                "name": name,
                "policy": policy,
                "metrics": values,
                "objective": objective(values),
            }
        )
    champion = next(item for item in candidates if item["name"] == "balanced")
    challenger = max(
        candidates,
        key=lambda item: _number(item["objective"].get("value")) or -math.inf,
    )
    observations = int(operational.get("observations") or 0)
    walk_forward = operational.get("walk_forward", {})
    oos_observations = int(walk_forward.get("metrics", {}).get("observations") or 0)
    windows = len(walk_forward.get("windows", []))
    stability = _number(walk_forward.get("parameter_stability"))
    champion_obj = _number(champion["objective"].get("value")) or 0.0
    challenger_obj = _number(challenger["objective"].get("value")) or -math.inf
    champion_dd = _number(champion_metrics.get("max_drawdown_pct"))
    challenger_dd = _number(challenger["metrics"].get("max_drawdown_pct"))
    turnover = _number(challenger["metrics"].get("turnover"))
    data_quality_ok = not any(
        cause.get("code") == "data_quality"
        and cause.get("severity") in {"high", "medium"}
        for cause in diagnostics.get("causes", [])
    )
    checks = {
        "operational_data_only": operational.get("lookahead_safe") is True,
        "enough_operational_sessions": observations >= config.minimum_operational_sessions,
        "enough_oos_sessions": oos_observations >= config.minimum_oos_sessions,
        "enough_windows": windows >= config.minimum_windows,
        "challenger_available": bool(challenger["metrics"]),
        "objective_improvement": challenger_obj - champion_obj >= config.improvement_margin,
        "drawdown_not_worse": challenger_dd is not None
        and (
            champion_dd is None
            or challenger_dd
            >= champion_dd - config.max_drawdown_tolerance_pct
        ),
        "turnover_within_limit": turnover is not None and turnover <= config.max_turnover,
        "parameter_stability": stability is not None
        and stability >= config.minimum_stability,
        "data_quality_ok": data_quality_ok,
    }
    all_passed = all(checks.values()) and challenger["name"] != "balanced"
    run_id = str(operational.get("generated_at") or now.isoformat())
    confirmation = 1 if all_passed else 0
    if all_passed:
        for row in reversed(previous_history):
            if row.get("challenger") != challenger["name"] or row.get("all_passed") is not True:
                break
            confirmation += 1
    approved = all_passed and confirmation >= config.required_confirmations
    return {
        "schema_version": 1,
        "generated_at": now.isoformat(),
        "run_id": run_id,
        "paper_only": True,
        "real_order_allowed": False,
        "status": (
            "active_verified"
            if approved
            else "pending_operational_confirmation"
            if all_passed
            else "collecting_operational_data"
        ),
        "approved": approved,
        "operational_data_verified": approved,
        "operational_observations": observations,
        "required_operational_observations": config.minimum_operational_sessions,
        "oos_observations": oos_observations,
        "required_oos_observations": config.minimum_oos_sessions,
        "paper_observations": int(paper_observations),
        "walk_forward_windows": windows,
        "parameter_stability": stability,
        "champion": champion,
        "challenger": challenger,
        "checks": checks,
        "all_passed": all_passed,
        "confirmation": confirmation,
        "required_confirmations": config.required_confirmations,
        "config": asdict(config),
    }


def run_operational_guard(
    root: Path,
    config: OperationalGuardConfig = OperationalGuardConfig(),
) -> dict[str, Any]:
    output = root / "web" / "data" / "adaptive-strategy"
    operational = _load(
        root / "web" / "data" / "strategy-lab" / "operational.json",
        {},
    )
    diagnostics = _load(
        root / "web" / "data" / "paper-trading" / "drawdown-diagnostics.json",
        {},
    )
    paper_history = _load(
        root / "web" / "data" / "paper-trading" / "equity-history.json",
        {"history": []},
    )
    guard_history = _load(output / "operational-guard-history.json", {"history": []})
    result = evaluate_operational_guard(
        operational,
        diagnostics,
        len(paper_history.get("history", [])),
        guard_history.get("history", []),
        config,
    )
    if result["approved"]:
        policy = {
            **result["challenger"]["policy"],
            "status": "active",
            "guardrails_passed": True,
            "operational_data_verified": True,
            "operational_observations": result["operational_observations"],
            "oos_observations": result["oos_observations"],
            "real_order_allowed": False,
            "paper_only": True,
            "effective_from": result["generated_at"],
        }
    else:
        policy = {
            **DEFAULT_POLICY,
            "status": "default",
            "guardrails_passed": False,
            "operational_data_verified": False,
            "real_order_allowed": False,
            "paper_only": True,
            "reason": "運用可能データの安全ゲート未通過",
        }
    status = _load(output / "status.json", {})
    status.update(
        {
            "status": result["status"],
            "promoted_now": result["approved"],
            "paper_only": True,
            "real_order_allowed": False,
            "observations": result["operational_observations"],
            "required_observations": result["required_operational_observations"],
            "operational_observations": result["operational_observations"],
            "required_operational_observations": result[
                "required_operational_observations"
            ],
            "oos_observations": result["oos_observations"],
            "required_oos_observations": result["required_oos_observations"],
            "paper_observations": result["paper_observations"],
            "walk_forward_windows": result["walk_forward_windows"],
            "promotion_guardrails": {
                "passed": result["approved"],
                "checks": result["checks"],
            },
            "operational_data_verified": result["approved"],
            "operational_confirmation": {
                "current": result["confirmation"],
                "required": result["required_confirmations"],
            },
            "champion": result["champion"],
            "challenger": result["challenger"],
            "warnings": [
                "反実仮想の研究結果はデモルールへ自動反映しません。",
                "実注文には接続しません。",
                *(
                    []
                    if result["approved"]
                    else [
                        "運用可能履歴・OOS・安定性・DD等の安全ゲートを満たすまで既定ルールを使用します。"
                    ]
                ),
            ],
        }
    )
    history = list(guard_history.get("history", []))
    history = [row for row in history if row.get("run_id") != result["run_id"]]
    history.append(
        {
            "run_id": result["run_id"],
            "generated_at": result["generated_at"],
            "challenger": result["challenger"]["name"],
            "all_passed": result["all_passed"],
            "approved": result["approved"],
            "operational_observations": result["operational_observations"],
            "oos_observations": result["oos_observations"],
        }
    )
    _write(output / "active-policy.json", policy)
    _write(output / "status.json", status)
    _write(output / "operational-guard.json", result)
    _write(output / "operational-guard-history.json", {"history": history[-104:]})
    return result


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description="Operational-only adaptive safety gate")
    parser.add_argument("--root", type=Path, default=Path.cwd())
    args = parser.parse_args(argv)
    result = run_operational_guard(args.root)
    print(
        json.dumps(
            {
                "status": result["status"],
                "approved": result["approved"],
                "operational_observations": result["operational_observations"],
                "oos_observations": result["oos_observations"],
                "confirmation": result["confirmation"],
                "paper_only": True,
            },
            ensure_ascii=False,
        )
    )
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
