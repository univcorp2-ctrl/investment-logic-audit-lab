from __future__ import annotations

import json
from pathlib import Path

from investment_audit.adaptive_daily_monitor import strategy_config_from_policy
from investment_audit.adaptive_strategy import (
    AdaptiveConfig,
    guardrails,
    objective,
    run_adaptive_strategy,
)


def test_objective_penalizes_drawdown_and_turnover() -> None:
    good = objective(
        {
            "total_return_pct": 10,
            "sortino": 1.2,
            "max_drawdown_pct": -5,
            "turnover": 2,
        }
    )
    bad = objective(
        {
            "total_return_pct": 10,
            "sortino": 1.2,
            "max_drawdown_pct": -20,
            "turnover": 20,
        }
    )
    assert good["value"] > bad["value"]


def test_guardrails_require_history_windows_and_stability() -> None:
    champion = {"objective": {"value": 1}, "metrics": {"max_drawdown_pct": -5}}
    challenger = {
        "objective": {"value": 3},
        "metrics": {
            "max_drawdown_pct": -5,
            "turnover": 2,
            "parameter_stability": 0.8,
        },
    }
    result = guardrails(champion, challenger, 20, 1, AdaptiveConfig(), True)
    assert result["passed"] is False
    result = guardrails(champion, challenger, 80, 4, AdaptiveConfig(), True)
    assert result["passed"] is True


def test_initial_run_collects_data_and_locks_fundamentals(tmp_path: Path) -> None:
    data = tmp_path / "web" / "data"
    (data / "paper-trading").mkdir(parents=True)
    (data / "paper-trading" / "equity-history.json").write_text(
        json.dumps({"history": [{"date": "2026-08-03"}]}),
        encoding="utf-8",
    )
    (data / "paper-trading" / "drawdown-diagnostics.json").write_text(
        json.dumps({"causes": []}),
        encoding="utf-8",
    )
    (data / "strategy-lab").mkdir(parents=True)
    (data / "strategy-lab" / "latest.json").write_text(
        json.dumps({"strategies": [], "walk_forward": {"windows": []}}),
        encoding="utf-8",
    )
    result = run_adaptive_strategy(tmp_path)
    assert result["status"] == "collecting_data"
    assert result["fundamental_locked"] is True
    assert result["promoted_now"] is False


def test_daily_monitor_ignores_unapproved_policy(tmp_path: Path) -> None:
    path = tmp_path / "web" / "data" / "adaptive-strategy"
    path.mkdir(parents=True)
    (path / "active-policy.json").write_text(
        json.dumps(
            {
                "name": "trend",
                "status": "collecting_data",
                "paper_only": True,
                "guardrails_passed": False,
            }
        ),
        encoding="utf-8",
    )
    config, metadata = strategy_config_from_policy(tmp_path)
    assert metadata["applied"] is False
    assert config.buy_technical == 60.0


def test_daily_monitor_applies_only_verified_paper_policy(tmp_path: Path) -> None:
    path = tmp_path / "web" / "data" / "adaptive-strategy"
    path.mkdir(parents=True)
    policy = {
        "name": "trend",
        "status": "active",
        "paper_only": True,
        "real_order_allowed": False,
        "guardrails_passed": True,
        "operational_data_verified": True,
        "fundamental": {},
        "technical": {"buy_technical": 70, "sell_technical": 45},
        "risk": {"stop_loss_pct": -6, "max_drawdown_pct": -9},
    }
    (path / "active-policy.json").write_text(
        json.dumps(policy),
        encoding="utf-8",
    )
    config, metadata = strategy_config_from_policy(tmp_path)
    assert metadata["applied"] is True
    assert config.buy_technical == 70
    assert config.stop_loss_pct == -6
