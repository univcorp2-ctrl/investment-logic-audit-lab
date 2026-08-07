from __future__ import annotations

import argparse
import datetime as dt
import json
import math
from dataclasses import asdict, dataclass
from pathlib import Path
from typing import Any


@dataclass(frozen=True)
class AdaptiveConfig:
    minimum_oos_sessions: int = 63
    minimum_windows: int = 3
    minimum_fundamental_snapshots: int = 4
    minimum_reporting_periods: int = 2
    improvement_margin: float = 0.5
    max_drawdown_tolerance_pct: float = 1.0
    max_turnover: float = 12.0
    minimum_stability: float = 0.60
    rollback_drawdown_pct: float = -10.0
    rollback_relative_return_pct: float = -5.0
    auto_apply_paper: bool = True


DEFAULT_POLICY: dict[str, Any] = {
    "version": 1,
    "name": "balanced",
    "paper_only": True,
    "fundamental": {
        "buy_fundamental": 58.0,
        "buy_quality": 55.0,
        "buy_completeness": 35.0,
        "buy_max_trap": 50.0,
        "sell_fundamental": 40.0,
        "sell_trap": 70.0,
    },
    "technical": {"buy_technical": 60.0, "sell_technical": 35.0},
    "risk": {"stop_loss_pct": -8.0, "max_drawdown_pct": -12.0},
}

PROFILES: dict[str, dict[str, Any]] = {
    "balanced": DEFAULT_POLICY,
    "value": {
        **DEFAULT_POLICY,
        "name": "value",
        "fundamental": {**DEFAULT_POLICY["fundamental"], "buy_fundamental": 62.0, "buy_quality": 50.0, "buy_max_trap": 48.0},
        "technical": {"buy_technical": 50.0, "sell_technical": 32.0},
    },
    "quality": {
        **DEFAULT_POLICY,
        "name": "quality",
        "fundamental": {**DEFAULT_POLICY["fundamental"], "buy_quality": 68.0, "buy_completeness": 45.0, "buy_max_trap": 42.0},
        "technical": {"buy_technical": 52.0, "sell_technical": 36.0},
    },
    "trend": {
        **DEFAULT_POLICY,
        "name": "trend",
        "fundamental": {**DEFAULT_POLICY["fundamental"], "buy_fundamental": 52.0, "buy_quality": 50.0},
        "technical": {"buy_technical": 68.0, "sell_technical": 42.0},
        "risk": {"stop_loss_pct": -7.0, "max_drawdown_pct": -10.0},
    },
    "low_volatility": {
        **DEFAULT_POLICY,
        "name": "low_volatility",
        "fundamental": {**DEFAULT_POLICY["fundamental"], "buy_quality": 62.0, "buy_completeness": 45.0, "buy_max_trap": 40.0},
        "technical": {"buy_technical": 55.0, "sell_technical": 40.0},
        "risk": {"stop_loss_pct": -6.0, "max_drawdown_pct": -9.0},
    },
    "conservative": {
        **DEFAULT_POLICY,
        "name": "conservative",
        "fundamental": {**DEFAULT_POLICY["fundamental"], "buy_fundamental": 64.0, "buy_quality": 66.0, "buy_completeness": 55.0, "buy_max_trap": 35.0},
        "technical": {"buy_technical": 60.0, "sell_technical": 42.0},
        "risk": {"stop_loss_pct": -5.0, "max_drawdown_pct": -8.0},
    },
}


def _load(path: Path, default: Any) -> Any:
    if not path.exists():
        return default
    return json.loads(path.read_text(encoding="utf-8"))


def _write(path: Path, payload: Any) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps(payload, ensure_ascii=False, indent=2, allow_nan=False) + "\n", encoding="utf-8")


def _number(value: Any) -> float | None:
    try:
        parsed = float(value)
    except (TypeError, ValueError):
        return None
    return parsed if math.isfinite(parsed) else None


def objective(metrics: dict[str, Any]) -> dict[str, float | None]:
    total = _number(metrics.get("total_return_pct"))
    excess = _number(metrics.get("benchmark_excess_pct") or metrics.get("baseline_excess_pct"))
    sortino = _number(metrics.get("sortino"))
    calmar = _number(metrics.get("calmar"))
    drawdown = _number(metrics.get("max_drawdown_pct"))
    turnover = _number(metrics.get("turnover"))
    stability = _number(metrics.get("parameter_stability"))
    score = 0.0
    score += 0.30 * (total or 0.0)
    score += 0.20 * (excess or 0.0)
    score += 2.0 * (sortino or 0.0)
    score += 1.5 * (calmar or 0.0)
    score -= 0.25 * abs(drawdown or 0.0)
    score -= 0.08 * (turnover or 0.0)
    score += 2.0 * (stability or 0.0)
    return {
        "value": round(score, 6),
        "total_return_component": total,
        "excess_return_component": excess,
        "sortino_component": sortino,
        "calmar_component": calmar,
        "drawdown_penalty": drawdown,
        "turnover_penalty": turnover,
        "stability_component": stability,
    }


def guardrails(
    champion: dict[str, Any],
    challenger: dict[str, Any],
    observations: int,
    windows: int,
    config: AdaptiveConfig,
    data_quality_ok: bool,
) -> dict[str, Any]:
    champion_obj = _number(champion.get("objective", {}).get("value")) or 0.0
    challenger_obj = _number(challenger.get("objective", {}).get("value")) or -math.inf
    champion_dd = _number(champion.get("metrics", {}).get("max_drawdown_pct"))
    challenger_dd = _number(challenger.get("metrics", {}).get("max_drawdown_pct"))
    turnover = _number(challenger.get("metrics", {}).get("turnover"))
    stability = _number(challenger.get("metrics", {}).get("parameter_stability"))
    checks = {
        "enough_oos_sessions": observations >= config.minimum_oos_sessions,
        "enough_windows": windows >= config.minimum_windows,
        "objective_improvement": challenger_obj - champion_obj >= config.improvement_margin,
        "drawdown_not_worse": challenger_dd is not None and (
            champion_dd is None or challenger_dd >= champion_dd - config.max_drawdown_tolerance_pct
        ),
        "turnover_within_limit": turnover is not None and turnover <= config.max_turnover,
        "parameter_stability": stability is not None and stability >= config.minimum_stability,
        "data_quality_ok": data_quality_ok,
    }
    return {"passed": all(checks.values()), "checks": checks}


def _strategy_metrics(strategy_lab: dict[str, Any]) -> dict[str, dict[str, Any]]:
    output: dict[str, dict[str, Any]] = {}
    aliases = {
        "baseline_equal_weight": "balanced",
        "trend_confirmed": "trend",
        "quality_value": "quality",
        "low_volatility": "low_volatility",
        "inverse_volatility": "low_volatility",
        "momentum_confirmed": "trend",
    }
    stability = _number(strategy_lab.get("walk_forward", {}).get("parameter_stability"))
    for row in strategy_lab.get("strategies", []):
        name = aliases.get(str(row.get("name")))
        if not name:
            continue
        metrics = {**(row.get("metrics") or {})}
        metrics["baseline_excess_pct"] = row.get("baseline_excess_pct")
        metrics["parameter_stability"] = stability
        current = output.get(name)
        if current is None or (_number(metrics.get("total_return_pct")) or -math.inf) > (
            _number(current.get("total_return_pct")) or -math.inf
        ):
            output[name] = metrics
    return output


def run_adaptive_strategy(root: Path, config: AdaptiveConfig = AdaptiveConfig()) -> dict[str, Any]:
    output_dir = root / "web" / "data" / "adaptive-strategy"
    history_payload = _load(root / "web" / "data" / "paper-trading" / "equity-history.json", {"history": []})
    strategy_lab = _load(root / "web" / "data" / "strategy-lab" / "latest.json", {})
    diagnostics = _load(root / "web" / "data" / "paper-trading" / "drawdown-diagnostics.json", {})
    active = _load(output_dir / "active-policy.json", {**DEFAULT_POLICY, "status": "default", "guardrails_passed": False})
    audit = _load(output_dir / "audit-log.json", {"events": []})
    observations = len(history_payload.get("history", []))
    windows = len(strategy_lab.get("walk_forward", {}).get("windows", []))
    point_in_time_dir = root / "web" / "data" / "fundamental-snapshots"
    snapshots = list(point_in_time_dir.glob("*.json")) if point_in_time_dir.exists() else []
    fundamental_snapshots = max(1, len(snapshots))
    reporting_periods = len({path.stem[:7] for path in snapshots}) if snapshots else 1
    fundamental_locked = (
        fundamental_snapshots < config.minimum_fundamental_snapshots
        or reporting_periods < config.minimum_reporting_periods
    )
    data_quality_ok = not any(
        cause.get("code") == "data_quality" and cause.get("severity") in {"high", "medium"}
        for cause in diagnostics.get("causes", [])
    )
    metric_map = _strategy_metrics(strategy_lab)
    candidates: list[dict[str, Any]] = []
    for name, policy in PROFILES.items():
        metrics = metric_map.get(name, {})
        candidate = {
            "name": name,
            "policy": policy,
            "metrics": metrics,
            "objective": objective(metrics),
            "eligible_for_promotion": False,
            "parameter_groups": {
                "fundamental": "fixed" if fundamental_locked else "ai_candidate",
                "technical": "ai_candidate",
                "risk": "ai_candidate",
            },
        }
        candidates.append(candidate)
    champion_name = str(active.get("name") or "balanced")
    champion = next((item for item in candidates if item["name"] == champion_name), candidates[0])
    challenger = max(candidates, key=lambda item: _number(item["objective"]["value"]) or -math.inf)
    promotion = guardrails(champion, challenger, observations, windows, config, data_quality_ok)
    challenger["eligible_for_promotion"] = promotion["passed"] and challenger["name"] != champion["name"]
    status = "collecting_data"
    promoted = False
    rollback = None
    current_dd = _number(diagnostics.get("snapshot", {}).get("current_drawdown_pct"))
    if active.get("status") == "active" and current_dd is not None and current_dd <= config.rollback_drawdown_pct:
        previous = active.get("previous_policy") or DEFAULT_POLICY
        rollback = {
            "reason": "post_promotion_drawdown",
            "drawdown_pct": current_dd,
            "from": active.get("name"),
            "to": previous.get("name", "balanced"),
        }
        active = {**previous, "status": "rolled_back", "guardrails_passed": True, "paper_only": True}
        status = "rolled_back"
        audit.setdefault("events", []).append({"at": dt.datetime.now(dt.timezone.utc).isoformat(), "type": "rollback", **rollback})
    elif challenger["eligible_for_promotion"] and config.auto_apply_paper:
        previous = {key: value for key, value in active.items() if key != "previous_policy"}
        active = {
            **challenger["policy"],
            "status": "active",
            "guardrails_passed": True,
            "effective_from": dt.datetime.now(dt.timezone.utc).isoformat(),
            "previous_policy": previous,
            "promotion_metrics": challenger["metrics"],
            "paper_only": True,
        }
        status = "active"
        promoted = True
        audit.setdefault("events", []).append({
            "at": dt.datetime.now(dt.timezone.utc).isoformat(),
            "type": "promotion",
            "from": champion["name"],
            "to": challenger["name"],
            "guardrails": promotion,
        })
    elif observations >= config.minimum_oos_sessions:
        status = "challenger_testing"
    status_payload = {
        "schema_version": 1,
        "generated_at": dt.datetime.now(dt.timezone.utc).isoformat(),
        "status": status,
        "paper_only": True,
        "auto_apply_paper": config.auto_apply_paper,
        "promoted_now": promoted,
        "observations": observations,
        "required_observations": config.minimum_oos_sessions,
        "walk_forward_windows": windows,
        "required_windows": config.minimum_windows,
        "fundamental_locked": fundamental_locked,
        "fundamental_snapshots": fundamental_snapshots,
        "reporting_periods": reporting_periods,
        "champion": champion,
        "challenger": challenger,
        "promotion_guardrails": promotion,
        "rollback": rollback,
        "next_review": "次回週次ワークフロー",
        "parameter_classification": [
            {"group": "fundamental", "label": "Fundamental", "ownership": "固定中" if fundamental_locked else "AI候補", "user_adjustable": True},
            {"group": "technical", "label": "Technical", "ownership": "AI候補", "user_adjustable": True},
            {"group": "risk", "label": "Risk", "ownership": "AI候補", "user_adjustable": True},
        ],
        "objective_formula": "0.30*OOS return + 0.20*excess + 2*Sortino + 1.5*Calmar - 0.25*abs(maxDD) - 0.08*turnover + 2*stability",
        "warnings": [
            "実証券注文には接続しません。",
            *(["Fundamentalスナップショット不足のためFundamental閾値は自動学習しません。"] if fundamental_locked else []),
            *([f"OOS履歴が不足しています（{observations}/{config.minimum_oos_sessions}営業日）。自動修正は行っていません。"] if observations < config.minimum_oos_sessions else []),
        ],
        "config": asdict(config),
    }
    _write(output_dir / "status.json", status_payload)
    _write(output_dir / "active-policy.json", active)
    _write(output_dir / "candidates.json", {"generated_at": status_payload["generated_at"], "candidates": candidates})
    _write(output_dir / "audit-log.json", audit)
    history = _load(output_dir / "history.json", {"history": []})
    history.setdefault("history", []).append({
        "generated_at": status_payload["generated_at"],
        "status": status,
        "observations": observations,
        "champion": champion["name"],
        "challenger": challenger["name"],
        "promoted": promoted,
    })
    history["history"] = history["history"][-260:]
    _write(output_dir / "history.json", history)
    return status_payload


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description="Guarded adaptive learning for the paper-only strategy")
    parser.add_argument("--root", type=Path, default=Path.cwd())
    args = parser.parse_args(argv)
    result = run_adaptive_strategy(args.root)
    print(json.dumps({
        "status": result["status"],
        "observations": result["observations"],
        "fundamental_locked": result["fundamental_locked"],
        "promoted_now": result["promoted_now"],
        "paper_only": True,
    }, ensure_ascii=False))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
