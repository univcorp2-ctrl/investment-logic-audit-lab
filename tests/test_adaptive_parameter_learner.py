from __future__ import annotations

import datetime as dt
import json
from pathlib import Path

from investment_audit.adaptive_parameter_learner import (
    LearningPolicy,
    evaluate_adaptive_learning,
    load_active_strategy_config,
)
from investment_audit.daily_monitor import StrategyConfig


def strategy_payload(counterfactual: bool = False) -> dict:
    return {
        "generated_at": "2026-08-08T00:00:00+00:00",
        "availability_model": {
            "counterfactual_only": counterfactual,
            "operational_observations": 200,
        },
        "strategies": [
            {
                "name": "baseline_equal_weight",
                "baseline_excess_pct": 0,
                "metrics": {
                    "status": "ok",
                    "observations": 200,
                    "total_return_pct": 5,
                    "sharpe": 0.7,
                    "max_drawdown_pct": -10,
                    "turnover": 1,
                },
            },
            {
                "name": "low_volatility",
                "baseline_excess_pct": 3,
                "metrics": {
                    "status": "ok",
                    "observations": 200,
                    "total_return_pct": 8,
                    "sharpe": 1.1,
                    "max_drawdown_pct": -8,
                    "turnover": 2,
                },
            },
        ],
        "walk_forward": {
            "status": "ok",
            "selected_strategy": "low_volatility",
            "parameter_stability": 0.75,
            "metrics": {"status": "ok", "observations": 63},
        },
    }


def test_counterfactual_data_can_never_auto_apply() -> None:
    latest, active, _ = evaluate_adaptive_learning(strategy_payload(True))
    assert latest["mode"] == "learning_only"
    assert active["approved"] is False
    assert "operational_data_only" in latest["gate_summary"]["failed"]


def test_two_consecutive_safe_runs_approve_paper_only() -> None:
    first, _, history = evaluate_adaptive_learning(strategy_payload(False))
    assert first["mode"] == "pending_confirmation"
    second_payload = strategy_payload(False)
    second_payload["generated_at"] = "2026-08-15T00:00:00+00:00"
    second, active, _ = evaluate_adaptive_learning(
        second_payload,
        history,
        now=dt.datetime(2026, 8, 15, tzinfo=dt.timezone.utc),
    )
    assert second["mode"] == "approved_for_paper"
    assert active["approved"] is True
    assert active["paper_only"] is True
    assert active["real_order_allowed"] is False
    assert active["strategy"] == "low_volatility"
    assert active["overrides"]["max_drawdown_pct"] == -8.0


def test_drawdown_regression_blocks_candidate() -> None:
    payload = strategy_payload(False)
    payload["strategies"][1]["metrics"]["max_drawdown_pct"] = -15
    latest, active, _ = evaluate_adaptive_learning(payload)
    assert latest["mode"] == "learning_only"
    assert active["approved"] is False
    assert "drawdown_protection" in latest["gate_summary"]["failed"]


def test_active_config_requires_approval_and_expiry(tmp_path: Path) -> None:
    output = tmp_path / "web" / "data" / "auto-learning"
    output.mkdir(parents=True)
    active = {
        "approved": True,
        "paper_only": True,
        "strategy": "trend_confirmed",
        "mode": "adaptive-paper",
        "expires_at": "2026-09-01T00:00:00+00:00",
        "overrides": {"buy_technical": 68, "sell_technical": 42},
    }
    (output / "active-parameters.json").write_text(json.dumps(active), encoding="utf-8")
    config, meta = load_active_strategy_config(
        tmp_path,
        StrategyConfig(),
        dt.datetime(2026, 8, 20, tzinfo=dt.timezone.utc),
    )
    assert config.buy_technical == 68
    assert config.sell_technical == 42
    assert meta["approved"] is True
    expired, expired_meta = load_active_strategy_config(
        tmp_path,
        StrategyConfig(),
        dt.datetime(2026, 10, 1, tzinfo=dt.timezone.utc),
    )
    assert expired.buy_technical == StrategyConfig().buy_technical
    assert expired_meta["approved"] is False


def test_inverse_volatility_needs_manual_position_sizing_review() -> None:
    payload = strategy_payload(False)
    payload["strategies"][1]["name"] = "inverse_volatility"
    payload["walk_forward"]["selected_strategy"] = "inverse_volatility"
    latest, active, _ = evaluate_adaptive_learning(payload)
    assert latest["mode"] == "manual_review_required"
    assert active["approved"] is False
