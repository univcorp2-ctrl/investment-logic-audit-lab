from __future__ import annotations

import json
from pathlib import Path

import pandas as pd

from investment_audit.adaptive_learning import (
    bounded_change,
    collect_feature_history,
    load_strategy_config,
    mature_feature_rows,
    purged_date_splits,
    train_adaptive_model,
)


def feature_row(date: str, code: str, price: float) -> dict:
    return {
        "date": date,
        "code": code,
        "company_name": code,
        "price": price,
        "quote_valid": True,
        "action": "WATCH",
        "holding_quantity": 0,
        "fundamental_score": 60.0,
        "value_score": 60.0,
        "quality_score": 60.0,
        "growth_score": 60.0,
        "trap_risk": 40.0,
        "completeness": 80.0,
        "earnings_yield": 0.05,
        "book_to_market": 0.4,
        "fcf_yield": 0.03,
        "roe": 0.12,
        "operating_margin": 0.1,
        "technical_score": 60.0,
        "rsi14": 55.0,
        "momentum20": 3.0,
        "momentum60": 5.0,
        "volatility20": 30.0,
        "drawdown20": -4.0,
        "price_vs_sma20": 2.0,
        "price_vs_sma60": 4.0,
        "forward_return_1d_pct": None,
        "matured_at": None,
    }


def write_json(path: Path, payload: object) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps(payload), encoding="utf-8")


def test_feature_maturation_uses_only_next_observed_date() -> None:
    rows = [
        feature_row("2026-08-03", "1000", 100),
        feature_row("2026-08-04", "1000", 110),
        feature_row("2026-08-05", "1000", 99),
    ]
    matured = mature_feature_rows(rows)
    assert matured[0]["forward_return_1d_pct"] == 10.0
    assert matured[0]["matured_at"] == "2026-08-04"
    assert matured[1]["forward_return_1d_pct"] == -10.0
    assert matured[2]["forward_return_1d_pct"] is None


def test_purged_split_has_no_adjacent_leakage() -> None:
    dates = [date.date().isoformat() for date in pd.date_range("2026-01-01", periods=40, freq="B")]
    splits = purged_date_splits(dates, train_days=20, test_days=5, purge_days=2)
    assert splits
    train, test = splits[0]
    all_dates = sorted(set(dates))
    assert all_dates.index(test[0]) - all_dates.index(train[-1]) == 3


def test_bounded_parameter_change_never_exceeds_weekly_limit() -> None:
    assert bounded_change(100, 150, 0.1) == 110
    assert bounded_change(100, 50, 0.1) == 90
    assert bounded_change(0, 10, 0.1) == 0.1


def test_insufficient_history_stays_collecting_and_does_not_apply(tmp_path: Path) -> None:
    policy = {
        "mode": "guarded_auto",
        "minimum_training_days": 126,
        "minimum_matured_rows": 500,
        "minimum_securities": 8,
        "minimum_oos_folds": 3,
        "minimum_oos_days": 42,
        "train_days": 126,
        "test_days": 21,
        "purge_days": 1,
        "top_fraction": 0.3,
        "random_seed": 42,
        "auto_apply": {
            "minimum_confidence": 0.75,
            "minimum_sharpe_improvement": 0.15,
            "maximum_total_return_disadvantage_pct": 1.0,
            "minimum_parameter_stability": 0.7,
            "maximum_relative_change": 0.1,
            "maximum_turnover": 8.0,
        },
        "rollback": {
            "evaluation_days": 10,
            "maximum_underperformance_pct": 2.0,
            "maximum_drawdown_worsening_pct": 2.0,
        },
    }
    active = {
        "version": 1,
        "status": "collecting_data",
        "approved": False,
        "strategy_config": {},
        "versions": [],
    }
    write_json(tmp_path / "config/ai-learning-policy.json", policy)
    write_json(tmp_path / "config/adaptive-paper-strategy.json", active)
    feature_path = tmp_path / "web/data/adaptive-learning/feature-history.jsonl"
    feature_path.parent.mkdir(parents=True)
    feature_path.write_text(json.dumps({**feature_row("2026-08-03", "1000", 100), "forward_return_1d_pct": 1.0}) + "\n", encoding="utf-8")

    result = train_adaptive_model(tmp_path)

    assert result["status"] == "collecting_data"
    assert result["applied"] is False
    assert result["gates"]["passed"] is False
    unchanged = json.loads((tmp_path / "config/adaptive-paper-strategy.json").read_text())
    assert unchanged["version"] == 1
    assert unchanged["approved"] is False


def test_feature_collection_is_idempotent(tmp_path: Path) -> None:
    report = {
        "trading_date": "2026-08-03",
        "decisions": [
            {
                "code": "1000",
                "company_name": "Example",
                "holding": {"quantity": 0},
                "quote": {"valid": True},
                "fundamental": {"score": 60},
                "technical": {"price": 100, "score": 60},
                "decision": {"action": "WATCH"},
            }
        ],
    }
    first = collect_feature_history(tmp_path, report)
    second = collect_feature_history(tmp_path, report)
    assert first["added"] == 1
    assert second["added"] == 0


def test_unapproved_config_cannot_change_daily_strategy(tmp_path: Path) -> None:
    write_json(
        tmp_path / "config/adaptive-paper-strategy.json",
        {
            "version": 4,
            "status": "collecting_data",
            "approved": False,
            "strategy_config": {"stop_loss_pct": -2.0},
        },
    )
    config, version, source = load_strategy_config(tmp_path)
    assert version == 4
    assert source == "default_guarded"
    assert config.stop_loss_pct == -8.0
