from __future__ import annotations

from investment_audit.drawdown_diagnostics import DiagnosticThresholds, diagnose_drawdown


def test_large_drawdown_and_position_loss_generate_explanations() -> None:
    latest = {
        "generated_at": "2026-08-07T08:00:00+09:00",
        "summary": {"equity": 9_000, "unrealized_pnl": -1_000},
        "decisions": [
            {"code": "1000", "company_name": "A", "technical": {"score": 20}, "fundamental": {"score": 70, "value_trap_risk": 20}, "quote": {"valid": True}},
        ],
    }
    analytics = {
        "sample": {"seed_cost_basis": 10_000, "observations": 10},
        "risk": {"max_drawdown_pct": {"value": -10}, "current_drawdown_pct": {"value": -9}},
        "series": {"contributions": [{"code": "1000", "company_name": "A", "return_pct": -10, "weight_pct": 60, "pnl": -1_000}]},
    }
    ranking = {"metadata": {"effective_data_cutoff": "2026-05-01"}, "rows": [{"code": "1000", "sector": "電気"}]}
    result = diagnose_drawdown(latest, analytics, ranking, DiagnosticThresholds())
    codes = {row["code"] for row in result["causes"]}
    assert "portfolio_drawdown" in codes
    assert "unrealized_loss" in codes
    assert "position_losses" in codes
    assert "concentration" in codes
    assert "technical_breakdown" in codes
    assert result["stability_plan"]["rule_change_allowed"] is False


def test_enough_observations_allow_comparison_not_auto_apply() -> None:
    latest = {"generated_at": "2026-08-07T08:00:00+09:00", "summary": {"equity": 11_000, "unrealized_pnl": 500}, "decisions": []}
    analytics = {"sample": {"seed_cost_basis": 10_000, "observations": 70}, "risk": {"max_drawdown_pct": {"value": -2}, "current_drawdown_pct": {"value": 0}}, "series": {"contributions": []}}
    ranking = {"metadata": {}, "rows": []}
    result = diagnose_drawdown(latest, analytics, ranking)
    assert result["stability_plan"]["rule_change_allowed"] is True
    assert all(action["auto_apply"] is False for action in result["improvement_candidates"])
