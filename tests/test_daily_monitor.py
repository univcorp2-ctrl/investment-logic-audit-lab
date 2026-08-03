from __future__ import annotations

import datetime as dt

import numpy as np
import pandas as pd

from investment_audit.daily_monitor import (
    StrategyConfig,
    fundamental_snapshot,
    make_decision,
    portfolio_summary,
    technical_snapshot,
    validate_quote,
)


def history(up: bool = True) -> pd.DataFrame:
    prices = np.linspace(100, 150, 90) if up else np.linspace(150, 90, 90)
    return pd.DataFrame(
        {"close": prices, "volume": np.full(90, 1_000_000)},
        index=pd.date_range("2026-03-01", periods=90, tz="Asia/Tokyo"),
    )


def fundamentals(**overrides: float) -> dict[str, object]:
    row: dict[str, object] = {
        "value_score": 75.0,
        "quality_score": 75.0,
        "growth_stability_score": 70.0,
        "value_trap_risk": 20.0,
        "data_completeness": 70.0,
    }
    row.update(overrides)
    return fundamental_snapshot(row)


def test_technical_snapshot_separates_trend_reasons() -> None:
    result = technical_snapshot(history(up=True))
    assert result.score is not None and result.score >= 65
    assert result.regime == "UPTREND"
    assert result.sma20 is not None and result.sma60 is not None
    assert result.momentum20_pct is not None and result.momentum20_pct > 0


def test_buy_hold_sell_and_no_data_rules() -> None:
    config = StrategyConfig()
    strong = technical_snapshot(history(up=True))
    weak = technical_snapshot(history(up=False))
    buy = make_decision(fundamentals(), strong, None, True, [], config)
    assert buy.action == "SIM_BUY"
    hold = make_decision(
        fundamentals(),
        strong,
        {"quantity": 100, "avg_cost": 100.0},
        True,
        [],
        config,
    )
    assert hold.action == "SIM_HOLD"
    sell = make_decision(
        fundamentals(value_trap_risk=80.0),
        weak,
        {"quantity": 100, "avg_cost": 100.0},
        True,
        [],
        config,
    )
    assert sell.action == "SIM_SELL"
    no_data = make_decision(fundamental_snapshot(None), technical_snapshot(pd.DataFrame()), None, False, ["missing"], config)
    assert no_data.action == "NO_DATA"


def test_stale_or_discrepant_quote_is_not_executable() -> None:
    config = StrategyConfig()
    price, valid, risks = validate_quote(
        {
            "current_price": 100,
            "usable": True,
            "max_difference_pct": 4.1,
            "quote_time": "2026-07-01T15:00:00+09:00",
        },
        dt.date(2026, 8, 3),
        config,
    )
    assert price == 100
    assert not valid
    assert len(risks) >= 2


def test_portfolio_summary_calculates_pnl_and_drawdown() -> None:
    portfolio = {
        "cash": 0.0,
        "realized_pnl": 500.0,
        "seed_cost_basis": 10_000.0,
        "positions": [{"symbol": "1000.T", "quantity": 100, "avg_cost": 100.0}],
    }
    decisions = [
        {
            "symbol": "1000.T",
            "technical": {"price": 110.0},
            "quote": {"valid": True},
        }
    ]
    summary = portfolio_summary(portfolio, decisions, [{"equity": 12_000.0}])
    assert summary["equity"] == 11_000.0
    assert summary["unrealized_pnl"] == 1_000.0
    assert summary["total_pnl"] == 1_500.0
    assert summary["max_drawdown_pct"] < 0
