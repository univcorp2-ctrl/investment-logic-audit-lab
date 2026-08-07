from __future__ import annotations

import argparse
import datetime as dt
import json
import math
from dataclasses import asdict, dataclass, replace
from pathlib import Path
from typing import Any

from .daily_monitor import StrategyConfig


@dataclass(frozen=True)
class LearningPolicy:
    min_operational_observations: int = 169
    min_oos_observations: int = 42
    min_parameter_stability: float = 0.60
    min_sharpe_improvement: float = 0.15
    min_baseline_excess_pct: float = 1.0
    max_drawdown_worsening_pct: float = 2.0
    required_confirmations: int = 2
    active_ttl_days: int = 35


STRATEGY_OVERRIDES: dict[str, dict[str, float]] = {
    "trend_confirmed": {
        "buy_technical": 68.0,
        "sell_technical": 42.0,
        "stop_loss_pct": -7.0,
        "max_drawdown_pct": -10.0,
    },
    "quality_value": {
        "buy_fundamental": 65.0,
        "buy_quality": 65.0,
        "buy_max_trap": 45.0,
        "sell_fundamental": 45.0,
        "sell_trap": 65.0,
    },
    "low_volatility": {
        "buy_quality": 60.0,
        "buy_technical": 55.0,
        "stop_loss_pct": -6.0,
        "max_drawdown_pct": -8.0,
    },
    "momentum_confirmed": {
        "buy_technical": 66.0,
        "sell_technical": 40.0,
        "stop_loss_pct": -7.0,
        "max_drawdown_pct": -10.0,
    },
    "inverse_volatility": {},
}

OVERRIDE_CATEGORY = {
    "buy_fundamental": "Fundamental",
    "buy_quality": "Fundamental",
    "buy_completeness": "Fundamental",
    "buy_max_trap": "Fundamental",
    "sell_fundamental": "Fundamental",
    "sell_trap": "Fundamental",
    "buy_technical": "Technical",
    "sell_technical": "Technical",
    "stop_loss_pct": "Risk",
    "max_drawdown_pct": "Risk",
}


def _number(value: Any) -> float | None:
    if value is None:
        return None
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


def _strategy_map(payload: dict[str, Any]) -> dict[str, dict[str, Any]]:
    return {
        str(row.get("name")): row
        for row in payload.get("strategies", [])
        if row.get("name")
    }


def _metric(row: dict[str, Any] | None, key: str) -> float | None:
    return _number((row or {}).get("metrics", {}).get(key))


def _objective(row: dict[str, Any] | None) -> float | None:
    if not row:
        return None
    sharpe = _metric(row, "sharpe")
    total_return = _metric(row, "total_return_pct")
    max_drawdown = _metric(row, "max_drawdown_pct")
    turnover = _metric(row, "turnover")
    if total_return is None:
        return None
    return round(
        (sharpe or 0.0) * 2.0
        + total_return * 0.08
        - abs(max_drawdown or 0.0) * 0.06
        - (turnover or 0.0) * 0.002,
        6,
    )


def _candidate(payload: dict[str, Any]) -> tuple[str | None, dict[str, Any] | None]:
    strategies = _strategy_map(payload)
    selected = payload.get("walk_forward", {}).get("selected_strategy")
    if selected in STRATEGY_OVERRIDES and selected in strategies:
        return str(selected), strategies[str(selected)]
    candidates = [
        row
        for name, row in strategies.items()
        if name in STRATEGY_OVERRIDES and name != "baseline_equal_weight"
    ]
    candidates.sort(key=lambda row: _objective(row) or -math.inf, reverse=True)
    if not candidates:
        return None, None
    return str(candidates[0].get("name")), candidates[0]


def _gate(name: str, passed: bool, actual: Any, required: Any, explanation: str) -> dict[str, Any]:
    return {
        "name": name,
        "passed": bool(passed),
        "actual": actual,
        "required": required,
        "explanation": explanation,
    }


def _expiry(now: dt.datetime, days: int) -> str:
    return (now + dt.timedelta(days=days)).isoformat()


def _parse_time(value: Any) -> dt.datetime | None:
    if not value:
        return None
    try:
        parsed = dt.datetime.fromisoformat(str(value).replace("Z", "+00:00"))
    except ValueError:
        return None
    if parsed.tzinfo is None:
        parsed = parsed.replace(tzinfo=dt.timezone.utc)
    return parsed.astimezone(dt.timezone.utc)


def _existing_active_is_valid(active: dict[str, Any], now: dt.datetime) -> bool:
    if active.get("approved") is not True or active.get("paper_only") is not True:
        return False
    expires = _parse_time(active.get("expires_at"))
    return expires is not None and expires > now


def _confirmation_count(
    history: list[dict[str, Any]],
    candidate: str | None,
    gates_passed: bool,
) -> int:
    if not candidate or not gates_passed:
        return 0
    count = 1
    for row in reversed(history):
        if row.get("candidate") != candidate or row.get("all_gates_passed") is not True:
            break
        count += 1
    return count


def evaluate_adaptive_learning(
    strategy_lab: dict[str, Any],
    history_payload: dict[str, Any] | None = None,
    existing_active: dict[str, Any] | None = None,
    policy: LearningPolicy = LearningPolicy(),
    now: dt.datetime | None = None,
) -> tuple[dict[str, Any], dict[str, Any], dict[str, Any]]:
    now = now or dt.datetime.now(dt.timezone.utc)
    history_payload = history_payload or {"history": []}
    existing_active = existing_active or {}
    history = list(history_payload.get("history", []))
    availability = strategy_lab.get("availability_model", {})
    walk_forward = strategy_lab.get("walk_forward", {})
    strategies = _strategy_map(strategy_lab)
    baseline = strategies.get("baseline_equal_weight")
    candidate_name, candidate_row = _candidate(strategy_lab)
    candidate_metrics = (candidate_row or {}).get("metrics", {})
    baseline_sharpe = _metric(baseline, "sharpe")
    candidate_sharpe = _metric(candidate_row, "sharpe")
    sharpe_improvement = (
        candidate_sharpe - baseline_sharpe
        if candidate_sharpe is not None and baseline_sharpe is not None
        else None
    )
    baseline_dd = _metric(baseline, "max_drawdown_pct")
    candidate_dd = _metric(candidate_row, "max_drawdown_pct")
    drawdown_worsening = (
        max(0.0, abs(candidate_dd) - abs(baseline_dd))
        if candidate_dd is not None and baseline_dd is not None
        else None
    )
    excess = _number((candidate_row or {}).get("baseline_excess_pct"))
    operational_observations = int(availability.get("operational_observations") or 0)
    oos_observations = int(walk_forward.get("metrics", {}).get("observations") or 0)
    stability = _number(walk_forward.get("parameter_stability"))
    selected_strategy = walk_forward.get("selected_strategy")
    gates = [
        _gate(
            "operational_data_only",
            availability.get("counterfactual_only") is False,
            availability.get("counterfactual_only"),
            False,
            "実際にその時点で利用できたデータだけで評価する",
        ),
        _gate(
            "operational_observations",
            operational_observations >= policy.min_operational_observations,
            operational_observations,
            policy.min_operational_observations,
            "学習126日・purge1日・OOS42日以上を確保する",
        ),
        _gate(
            "walk_forward",
            walk_forward.get("status") == "ok",
            walk_forward.get("status"),
            "ok",
            "時系列walk-forward検証が完了している",
        ),
        _gate(
            "oos_observations",
            oos_observations >= policy.min_oos_observations,
            oos_observations,
            policy.min_oos_observations,
            "未使用期間で十分な観測数を確保する",
        ),
        _gate(
            "parameter_stability",
            stability is not None and stability >= policy.min_parameter_stability,
            stability,
            policy.min_parameter_stability,
            "期間を変えても同じ候補が選ばれる",
        ),
        _gate(
            "candidate_selected_oos",
            candidate_name is not None and candidate_name == selected_strategy,
            {"candidate": candidate_name, "selected": selected_strategy},
            "same strategy",
            "学習期間ではなくOOS選択と一致する",
        ),
        _gate(
            "candidate_metrics",
            candidate_metrics.get("status") == "ok",
            candidate_metrics.get("status"),
            "ok",
            "候補戦略の指標が算定可能である",
        ),
        _gate(
            "sharpe_improvement",
            sharpe_improvement is not None
            and sharpe_improvement >= policy.min_sharpe_improvement,
            sharpe_improvement,
            policy.min_sharpe_improvement,
            "ベースラインよりリスク調整後収益が改善する",
        ),
        _gate(
            "baseline_excess",
            excess is not None and excess >= policy.min_baseline_excess_pct,
            excess,
            policy.min_baseline_excess_pct,
            "ベースラインに対して十分なOOS超過収益がある",
        ),
        _gate(
            "drawdown_protection",
            drawdown_worsening is not None
            and drawdown_worsening <= policy.max_drawdown_worsening_pct,
            drawdown_worsening,
            policy.max_drawdown_worsening_pct,
            "収益改善の代わりに最大DDを大幅悪化させない",
        ),
    ]
    all_gates_passed = all(gate["passed"] for gate in gates)
    confirmations = _confirmation_count(history, candidate_name, all_gates_passed)
    if not all_gates_passed:
        mode = "learning_only"
    elif confirmations < policy.required_confirmations:
        mode = "pending_confirmation"
    else:
        mode = "approved_for_paper"
    overrides = dict(STRATEGY_OVERRIDES.get(candidate_name or "", {}))
    if candidate_name == "inverse_volatility" and all_gates_passed:
        mode = "manual_review_required"
    run_id = str(strategy_lab.get("generated_at") or now.isoformat())
    history_entry = {
        "run_id": run_id,
        "evaluated_at": now.isoformat(),
        "candidate": candidate_name,
        "objective_score": _objective(candidate_row),
        "all_gates_passed": all_gates_passed,
        "confirmation_count": confirmations,
        "mode": mode,
        "operational_observations": operational_observations,
        "oos_observations": oos_observations,
        "parameter_stability": stability,
    }
    history = [row for row in history if row.get("run_id") != run_id]
    history.append(history_entry)
    history = history[-104:]
    approved = mode == "approved_for_paper" and bool(overrides)
    if approved:
        active = {
            "schema_version": 1,
            "approved": True,
            "mode": "adaptive-paper",
            "strategy": candidate_name,
            "overrides": overrides,
            "effective_from": now.isoformat(),
            "expires_at": _expiry(now, policy.active_ttl_days),
            "paper_only": True,
            "real_order_allowed": False,
            "reason": "全安全ゲートと連続確認を通過したためデモルールへ期限付き反映",
        }
    elif _existing_active_is_valid(existing_active, now):
        active = dict(existing_active)
        active["reason"] = "既存の期限付きデモ設定を維持。次回学習で再評価"
    else:
        active = {
            "schema_version": 1,
            "approved": False,
            "mode": "baseline",
            "strategy": None,
            "overrides": {},
            "effective_from": None,
            "expires_at": None,
            "paper_only": True,
            "real_order_allowed": False,
            "reason": "安全ゲート未通過のため既定デモルールを使用",
        }
    categories: dict[str, dict[str, float]] = {
        "Fundamental": {},
        "Technical": {},
        "Risk": {},
    }
    for key, value in overrides.items():
        categories[OVERRIDE_CATEGORY.get(key, "Risk")][key] = value
    failed = [gate for gate in gates if not gate["passed"]]
    latest = {
        "schema_version": 1,
        "generated_at": now.isoformat(),
        "model": "gated-walk-forward-rule-selection-v1",
        "mode": mode,
        "paper_only": True,
        "real_order_allowed": False,
        "candidate": {
            "strategy": candidate_name,
            "objective_score": _objective(candidate_row),
            "metrics": candidate_metrics,
            "baseline_excess_pct": excess,
            "sharpe_improvement": sharpe_improvement,
            "drawdown_worsening_pct": drawdown_worsening,
            "proposed_overrides": overrides,
            "parameter_categories": categories,
        },
        "active": active,
        "gates": gates,
        "gate_summary": {
            "passed": len(gates) - len(failed),
            "total": len(gates),
            "all_passed": all_gates_passed,
            "failed": [gate["name"] for gate in failed],
        },
        "confirmation": {
            "current": confirmations,
            "required": policy.required_confirmations,
        },
        "observations": {
            "operational": operational_observations,
            "required_operational": policy.min_operational_observations,
            "oos": oos_observations,
            "required_oos": policy.min_oos_observations,
        },
        "policy": asdict(policy),
        "learning_principles": [
            "実運用時点で利用可能だったデータだけを使う",
            "学習期間と未使用OOS期間を分離する",
            "収益だけでなく最大DDと安定性を同時評価する",
            "同じ候補が2週連続で安全ゲートを通るまで反映しない",
            "反映先はデモ取引だけで、実注文は送信しない",
            "期限切れ後は既定ルールへ戻して再学習する",
        ],
        "next_action": (
            "安全ゲート通過。次回確認待ち"
            if mode == "pending_confirmation"
            else "デモルールへ期限付き反映"
            if mode == "approved_for_paper"
            else "履歴を蓄積し、既定ルールで監視を継続"
        ),
        "disclaimer": "自動学習は将来利益を保証しません。過学習を避けるため実注文へは接続しません。",
    }
    return latest, active, {"schema_version": 1, "history": history}


def run_adaptive_learning(
    root: Path,
    policy: LearningPolicy = LearningPolicy(),
    now: dt.datetime | None = None,
) -> dict[str, Any]:
    strategy_path = root / "web" / "data" / "strategy-lab" / "latest.json"
    output = root / "web" / "data" / "auto-learning"
    strategy_lab = _load(strategy_path, {})
    if not strategy_lab:
        raise FileNotFoundError(f"strategy lab report not found: {strategy_path}")
    history = _load(output / "history.json", {"schema_version": 1, "history": []})
    active = _load(output / "active-parameters.json", {})
    latest, active_payload, history_payload = evaluate_adaptive_learning(
        strategy_lab,
        history,
        active,
        policy,
        now,
    )
    _write(output / "latest.json", latest)
    _write(output / "active-parameters.json", active_payload)
    _write(output / "history.json", history_payload)
    return latest


def load_active_strategy_config(
    root: Path,
    base: StrategyConfig = StrategyConfig(),
    now: dt.datetime | None = None,
) -> tuple[StrategyConfig, dict[str, Any]]:
    now = now or dt.datetime.now(dt.timezone.utc)
    path = root / "web" / "data" / "auto-learning" / "active-parameters.json"
    active = _load(path, {})
    allowed = set(StrategyConfig.__dataclass_fields__)
    valid = _existing_active_is_valid(active, now)
    overrides = {
        key: value
        for key, value in active.get("overrides", {}).items()
        if key in allowed and isinstance(value, (int, float))
    }
    if not valid or not overrides:
        return base, {
            "mode": "baseline",
            "approved": False,
            "strategy": None,
            "overrides": {},
            "reason": active.get("reason", "承認済み学習設定なし"),
            "paper_only": True,
        }
    return replace(base, **overrides), {
        "mode": active.get("mode", "adaptive-paper"),
        "approved": True,
        "strategy": active.get("strategy"),
        "overrides": overrides,
        "expires_at": active.get("expires_at"),
        "reason": active.get("reason"),
        "paper_only": True,
    }


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description="Gated adaptive paper-strategy learner")
    parser.add_argument("--root", type=Path, default=Path.cwd())
    args = parser.parse_args(argv)
    result = run_adaptive_learning(args.root)
    print(
        json.dumps(
            {
                "mode": result["mode"],
                "candidate": result["candidate"]["strategy"],
                "gates": result["gate_summary"],
                "confirmation": result["confirmation"],
                "active": result["active"]["strategy"],
                "paper_only": True,
            },
            ensure_ascii=False,
        )
    )
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
