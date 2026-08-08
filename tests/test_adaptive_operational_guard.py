from __future__ import annotations

import datetime as dt
import json
from pathlib import Path

from investment_audit.adaptive_daily_monitor import strategy_config_from_policy
from investment_audit.adaptive_operational_guard import (
    OperationalGuardConfig,
    evaluate_operational_guard,
)
from investment_audit.daily_monitor import StrategyConfig


def _operational(observations: int = 200, lookahead_safe: bool = True) -> dict:
    return {
        "generated_at": "2026-08-08T00:00:00+00:00",
        "lookahead_safe": lookahead_safe,
        "observations": observations,
        "strategies": [
            {
                "name": "baseline_equal_weight",
                "baseline_excess_pct": 0,
                "metrics": {
                    "total_return_pct": 4,
                    "sortino": 0.5,
                    "calmar": 0.4,
                    "max_drawdown_pct": -8,
                    "turnover": 2,
                    "status": "ok",
                },
            },
            {
                "name": "low_volatility",
                "baseline_excess_pct": 3,
                "metrics": {
                    "total_return_pct": 8,
                    "sortino": 1.4,
                    "calmar": 1.0,
                    "max_drawdown_pct": -7,
                    "turnover": 3,
                    "status": "ok",
                },
            },
        ],
        "walk_forward": {
            "status": "ok",
            "parameter_stability": 0.8,
            "windows": [{}, {}, {}],
            "metrics": {"observations": 63, "status": "ok"},
        },
    }


def test_counterfactual_or_short_history_never_approves() -> None:
    unsafe = evaluate_operational_guard(_operational(200, False), {}, 80, [])
    short = evaluate_operational_guard(_operational(100, True), {}, 80, [])
    assert unsafe["approved"] is False
    assert unsafe["checks"]["operational_data_only"] is False
    assert short["approved"] is False
    assert short["checks"]["enough_operational_sessions"] is False


def test_two_consecutive_verified_runs_approve_paper_only() -> None:
    config = OperationalGuardConfig(required_confirmations=2)
    first = evaluate_operational_guard(_operational(), {}, 80, [], config)
    history = [
        {
            "challenger": first["challenger"]["name"],
            "all_passed": first["all_passed"],
        }
    ]
    second = evaluate_operational_guard(
        {**_operational(), "generated_at": "2026-08-15T00:00:00+00:00"},
        {},
        85,
        history,
        config,
        dt.datetime(2026, 8, 15, tzinfo=dt.timezone.utc),
    )
    assert first["approved"] is False
    assert second["approved"] is True
    assert second["operational_data_verified"] is True
    assert second["real_order_allowed"] is False


def test_daily_monitor_ignores_old_unverified_policy(tmp_path: Path) -> None:
    output = tmp_path / "web" / "data" / "adaptive-strategy"
    output.mkdir(parents=True)
    policy = {
        "name": "trend",
        "status": "active",
        "paper_only": True,
        "guardrails_passed": True,
        "fundamental": {"buy_fundamental": 70},
        "technical": {"buy_technical": 75},
        "risk": {"stop_loss_pct": -5},
    }
    (output / "active-policy.json").write_text(json.dumps(policy), encoding="utf-8")
    config, meta = strategy_config_from_policy(tmp_path)
    assert config == StrategyConfig()
    assert meta["applied"] is False


def test_daily_monitor_applies_verified_paper_policy(tmp_path: Path) -> None:
    output = tmp_path / "web" / "data" / "adaptive-strategy"
    output.mkdir(parents=True)
    policy = {
        "name": "trend",
        "status": "active",
        "paper_only": True,
        "real_order_allowed": False,
        "guardrails_passed": True,
        "operational_data_verified": True,
        "fundamental": {"buy_fundamental": 65, "buy_quality": 60},
        "technical": {"buy_technical": 70},
        "risk": {"stop_loss_pct": -6, "max_drawdown_pct": -9},
    }
    (output / "active-policy.json").write_text(json.dumps(policy), encoding="utf-8")
    config, meta = strategy_config_from_policy(tmp_path)
    assert config.buy_fundamental == 65
    assert config.buy_technical == 70
    assert config.stop_loss_pct == -6
    assert meta["applied"] is True
