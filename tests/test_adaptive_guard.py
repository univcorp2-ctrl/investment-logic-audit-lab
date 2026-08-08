from __future__ import annotations

import json
from pathlib import Path

from investment_audit.adaptive_guard import PostPromotionGuardConfig, evaluate_post_promotion_guard


def write(path: Path, payload: object) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps(payload), encoding="utf-8")


def setup_root(tmp_path: Path, observations: int, active_return: float = 5, previous_return: float = 4, active_dd: float = -5, previous_dd: float = -5) -> None:
    data = tmp_path / "web" / "data"
    active = {"name":"trend_confirmed","status":"active","paper_only":True,"guardrails_passed":True,"previous_policy":{"name":"balanced","status":"active","paper_only":True,"guardrails_passed":True}}
    write(data / "adaptive-strategy" / "active-policy.json", active)
    write(data / "adaptive-strategy" / "status.json", {"status":"active"})
    write(data / "adaptive-strategy" / "audit-log.json", {"events":[]})
    write(data / "paper-trading" / "equity-history.json", {"history":[{"date":f"2026-01-{index+1:02d}"} for index in range(observations)]})
    write(data / "strategy-lab" / "latest.json", {"strategies":[
        {"name":"trend_confirmed","metrics":{"total_return_pct":active_return,"max_drawdown_pct":active_dd}},
        {"name":"balanced","metrics":{"total_return_pct":previous_return,"max_drawdown_pct":previous_dd}},
    ],"walk_forward":{"windows":[]}})


def test_initializes_post_promotion_baseline(tmp_path: Path) -> None:
    setup_root(tmp_path, 20)
    result = evaluate_post_promotion_guard(tmp_path)
    assert result["status"] == "monitoring"
    assert result["promotion_observations"] == 20
    assert result["rollback"] is False


def test_does_not_rollback_before_ten_new_observations(tmp_path: Path) -> None:
    setup_root(tmp_path, 20, active_return=0, previous_return=10)
    evaluate_post_promotion_guard(tmp_path)
    setup_root(tmp_path, 29, active_return=0, previous_return=10)
    result = evaluate_post_promotion_guard(tmp_path)
    assert result["elapsed_observations"] == 9
    assert result["rollback"] is False


def test_rolls_back_for_relative_return_underperformance(tmp_path: Path) -> None:
    setup_root(tmp_path, 20)
    evaluate_post_promotion_guard(tmp_path)
    setup_root(tmp_path, 30, active_return=2, previous_return=5, active_dd=-5, previous_dd=-5)
    result = evaluate_post_promotion_guard(tmp_path)
    assert result["rollback"] is True
    restored = json.loads((tmp_path / "web/data/adaptive-strategy/active-policy.json").read_text())
    assert restored["name"] == "balanced"
    assert restored["status"] == "active"
    assert "relative_return_underperformance" in result["reasons"]


def test_rolls_back_for_relative_drawdown_worsening(tmp_path: Path) -> None:
    setup_root(tmp_path, 20)
    evaluate_post_promotion_guard(tmp_path)
    setup_root(tmp_path, 30, active_return=6, previous_return=5, active_dd=-9, previous_dd=-5)
    result = evaluate_post_promotion_guard(tmp_path)
    assert result["rollback"] is True
    assert "relative_drawdown_worsening" in result["reasons"]


def test_keeps_profile_when_relative_results_are_acceptable(tmp_path: Path) -> None:
    setup_root(tmp_path, 20)
    evaluate_post_promotion_guard(tmp_path)
    setup_root(tmp_path, 30, active_return=6, previous_return=5, active_dd=-5, previous_dd=-6)
    result = evaluate_post_promotion_guard(tmp_path, PostPromotionGuardConfig())
    assert result["status"] == "passed"
    assert result["rollback"] is False
