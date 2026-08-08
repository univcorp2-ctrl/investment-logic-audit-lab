from __future__ import annotations

import argparse
import datetime as dt
import json
from dataclasses import asdict, dataclass
from pathlib import Path
from typing import Any

from .adaptive_strategy import DEFAULT_POLICY, _load, _strategy_metrics, _write


@dataclass(frozen=True)
class PostPromotionGuardConfig:
    evaluation_observations: int = 10
    maximum_underperformance_pct: float = 2.0
    maximum_drawdown_worsening_pct: float = 2.0


def compare_profiles(active_metrics: dict[str, Any], previous_metrics: dict[str, Any]) -> dict[str, Any]:
    active_return = float(active_metrics.get("total_return_pct") or 0.0)
    previous_return = float(previous_metrics.get("total_return_pct") or 0.0)
    active_drawdown = float(active_metrics.get("max_drawdown_pct") or 0.0)
    previous_drawdown = float(previous_metrics.get("max_drawdown_pct") or 0.0)
    return {
        "relative_return_pct": active_return - previous_return,
        "relative_drawdown_pct": active_drawdown - previous_drawdown,
    }


def should_relative_rollback(comparison: dict[str, Any], config: PostPromotionGuardConfig) -> tuple[bool, list[str]]:
    reasons: list[str] = []
    if float(comparison["relative_return_pct"]) <= -config.maximum_underperformance_pct:
        reasons.append("relative_return_underperformance")
    if float(comparison["relative_drawdown_pct"]) <= -config.maximum_drawdown_worsening_pct:
        reasons.append("relative_drawdown_worsening")
    return bool(reasons), reasons


def evaluate_post_promotion_guard(root: Path, config: PostPromotionGuardConfig = PostPromotionGuardConfig()) -> dict[str, Any]:
    output_dir = root / "web" / "data" / "adaptive-strategy"
    active_path = output_dir / "active-policy.json"
    status_path = output_dir / "status.json"
    audit_path = output_dir / "audit-log.json"
    state_path = output_dir / "guard-state.json"
    active = _load(active_path, dict(DEFAULT_POLICY))
    equity = _load(root / "web" / "data" / "paper-trading" / "equity-history.json", {"history": []})
    observations = len(equity.get("history", []))
    previous = active.get("previous_policy")
    result: dict[str, Any] = {
        "schema_version": 1,
        "generated_at": dt.datetime.now(dt.UTC).isoformat(),
        "paper_only": True,
        "status": "not_monitoring",
        "active_profile": active.get("name"),
        "previous_profile": previous.get("name") if isinstance(previous, dict) else None,
        "observations": observations,
        "elapsed_observations": 0,
        "rollback": False,
        "comparison": None,
        "reasons": [],
    }
    if active.get("status") != "active" or not isinstance(previous, dict) or not previous.get("name"):
        _write(state_path, result)
        return result
    state = _load(state_path, {})
    if state.get("active_profile") != active.get("name") or state.get("previous_profile") != previous.get("name") or "promotion_observations" not in state:
        state = {
            **result,
            "status": "monitoring",
            "promotion_observations": observations,
            "elapsed_observations": 0,
            "required_observations": config.evaluation_observations,
        }
        _write(state_path, state)
        return state
    elapsed = max(0, observations - int(state.get("promotion_observations", observations)))
    result["status"] = "monitoring"
    result["elapsed_observations"] = elapsed
    result["promotion_observations"] = state.get("promotion_observations")
    result["required_observations"] = config.evaluation_observations
    if elapsed < config.evaluation_observations:
        _write(state_path, result)
        return result
    strategy_lab = _load(root / "web" / "data" / "strategy-lab" / "latest.json", {})
    metrics_by_name = {item["name"]: item for item in _strategy_metrics(strategy_lab)}
    active_metrics = metrics_by_name.get(str(active.get("name")))
    previous_metrics = metrics_by_name.get(str(previous.get("name")))
    if not active_metrics or not previous_metrics:
        result["status"] = "metrics_unavailable"
        _write(state_path, result)
        return result
    comparison = compare_profiles(active_metrics.get("metrics", {}), previous_metrics.get("metrics", {}))
    rollback, reasons = should_relative_rollback(comparison, config)
    result["comparison"] = comparison
    result["reasons"] = reasons
    result["status"] = "rollback_required" if rollback else "passed"
    result["rollback"] = rollback
    if rollback:
        now = result["generated_at"]
        restored = {
            **previous,
            "status": "active",
            "paper_only": True,
            "guardrails_passed": True,
            "effective_from": now,
            "rolled_back_from": active.get("name"),
            "rollback": {"at": now, "reasons": reasons, **comparison},
            "previous_policy": None,
        }
        _write(active_path, restored)
        status = _load(status_path, {})
        status.update({
            "status": "rolled_back",
            "promoted_now": False,
            "rolled_back_now": True,
            "champion": {"name": restored.get("name"), "policy": restored},
            "rollback": {"from": active.get("name"), "to": restored.get("name"), "reasons": reasons, **comparison},
        })
        _write(status_path, status)
        audit = _load(audit_path, {"events": []})
        events = list(audit.get("events", []))
        events.append({
            "at": now,
            "type": "rollback",
            "from": active.get("name"),
            "to": restored.get("name"),
            "reason": ", ".join(reasons),
            **comparison,
            "paper_only": True,
        })
        _write(audit_path, {"events": events[-100:]})
        result["restored_profile"] = restored.get("name")
    _write(state_path, result)
    return result


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description="Post-promotion relative performance guard for the paper strategy")
    parser.add_argument("--root", type=Path, default=Path.cwd())
    parser.add_argument("--evaluation-observations", type=int, default=10)
    args = parser.parse_args(argv)
    result = evaluate_post_promotion_guard(args.root, PostPromotionGuardConfig(evaluation_observations=args.evaluation_observations))
    print(json.dumps(result, ensure_ascii=False))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
