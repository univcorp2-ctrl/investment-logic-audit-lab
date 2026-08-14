from __future__ import annotations

import math

import pandas as pd

from investment_audit.performance_analytics import calculate_performance_analytics, repair_equity_history_rows


def test_repaired_history_derives_negative_august_7_return() -> None:
    rows = [
        {"date":"2026-08-03","equity":30_809_600.0,"total_pnl":87_500.0,"daily_return_pct":0.2848},
        {"date":"2026-08-04","equity":31_587_500.0,"total_pnl":865_400.0,"daily_return_pct":2.5249},
        {"date":"2026-08-07","equity":31_152_000.0,"total_pnl":429_900.0,"daily_return_pct":0.2868},
    ]
    repaired, changed = repair_equity_history_rows(rows, 30_722_100.0)
    assert changed is True
    assert math.isclose(repaired[2]["daily_return_pct"], -1.37870993, rel_tol=0, abs_tol=1e-7)


def test_current_closed_trade_metrics_match_realized_ledger() -> None:
    seed_positions = [
        {"symbol":"8035.T","entry_price":54720,"quantity":100},
        {"symbol":"6857.T","entry_price":31260,"quantity":100},
        {"symbol":"5803.T","entry_price":4294,"quantity":100},
        {"symbol":"5016.T","entry_price":3827,"quantity":100},
        {"symbol":"6920.T","entry_price":41060,"quantity":100},
        {"symbol":"9983.T","entry_price":79030,"quantity":100},
        {"symbol":"7974.T","entry_price":7588,"quantity":100},
        {"symbol":"285A.T","entry_price":49190,"quantity":100},
        {"symbol":"9984.T","entry_price":5412,"quantity":100},
        {"symbol":"5706.T","entry_price":30840,"quantity":100},
    ]
    trades = [
        {"side":"SIM_SELL","symbol":"285A.T","quantity":100,"price":52090},
        {"side":"SIM_SELL","symbol":"5016.T","quantity":100,"price":3971},
        {"side":"SIM_SELL","symbol":"5706.T","quantity":100,"price":31900},
        {"side":"SIM_SELL","symbol":"5803.T","quantity":100,"price":4628},
        {"side":"SIM_SELL","symbol":"8035.T","quantity":100,"price":56700},
        {"side":"SIM_SELL","symbol":"9984.T","quantity":100,"price":5228},
        {"side":"SIM_SELL","symbol":"6920.T","quantity":100,"price":37460},
        {"side":"SIM_SELL","symbol":"9983.T","quantity":100,"price":78720},
    ]
    history = [
        {"date":"2026-08-03","equity":30_809_600.0,"total_pnl":87_500.0,"cumulative_return_pct":0.2848},
        {"date":"2026-08-04","equity":31_587_500.0,"total_pnl":865_400.0,"cumulative_return_pct":2.8169},
        {"date":"2026-08-07","equity":31_152_000.0,"total_pnl":429_900.0,"cumulative_return_pct":1.3993},
        {"date":"2026-08-10","equity":31_322_200.0,"total_pnl":600_100.0,"cumulative_return_pct":1.9533},
        {"date":"2026-08-11","equity":31_322_200.0,"total_pnl":600_100.0,"cumulative_return_pct":1.9533},
        {"date":"2026-08-12","equity":31_373_500.0,"total_pnl":651_400.0,"cumulative_return_pct":2.1203},
        {"date":"2026-08-13","equity":31_496_200.0,"total_pnl":774_100.0,"cumulative_return_pct":2.5197},
    ]
    report = {"summary":{"equity":31_496_200.0,"total_pnl":774_100.0,"realized_pnl":232_400.0,"unrealized_pnl":541_700.0,"cumulative_return_pct":2.5197,"turnover_today":0.0},"decisions":[]}
    result = calculate_performance_analytics(history, report, {"seed_cost_basis":30_722_100.0,"seed_positions":seed_positions}, trades, pd.Series(dtype=float))
    trading = result["trading_quality"]
    assert trading["basis"] == "closed_trades"
    assert trading["closed_trade_count"]["value"] == 8.0
    assert trading["winning_trades"]["value"] == 5.0
    assert trading["losing_trades"]["value"] == 3.0
    assert math.isclose(trading["win_rate_pct"]["value"], 62.5)
    assert math.isclose(trading["average_win_yen"]["value"], 128_360.0)
    assert math.isclose(trading["average_loss_yen"]["value"], -136_466.66666666666)
    assert math.isclose(trading["risk_reward_ratio"]["value"], 0.9405959941377626)
    assert math.isclose(trading["profit_factor"]["value"], 1.5676599902296042)
    assert math.isclose(trading["expectancy_yen"]["value"], 29_050.0)
    assert result["performance"]["worst_day_pct"]["value"] < 0
    assert result["risk_adjusted"]["sharpe_ratio"]["value"] is None
    assert result["risk_adjusted"]["sharpe_ratio"]["status"] == "insufficient_history"
