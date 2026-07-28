from __future__ import annotations

from scripts.update_live_ranking import build_fundamental_row


def test_build_fundamental_row_derives_value_and_quality_metrics() -> None:
    info = {
        "marketCap": 1_000.0,
        "enterpriseValue": 1_200.0,
        "netIncomeToCommon": 100.0,
        "freeCashflow": 120.0,
        "ebitda": 200.0,
        "totalRevenue": 2_000.0,
        "grossProfits": 800.0,
        "operatingCashflow": 160.0,
        "totalAssets": 3_000.0,
        "totalDebt": 300.0,
        "totalCash": 500.0,
        "sharesOutstanding": 100.0,
        "bookValue": 8.0,
        "operatingMargins": 0.12,
        "returnOnEquity": 0.18,
        "priceToBook": 1.25,
        "trailingPE": 10.0,
        "enterpriseToEbitda": 6.0,
        "dividendYield": 0.03,
        "revenueGrowth": 0.08,
        "earningsGrowth": 0.12,
    }
    row = build_fundamental_row(
        info,
        {"ticker": "0000.T", "symbol": "0000", "company_name": "Sample", "sector": "Test"},
    )
    assert row["earnings_yield"] == 0.1
    assert row["book_to_market"] == 0.8
    assert row["fcf_yield"] == 0.12
    assert row["net_cash_to_market_cap"] == 0.2
    assert row["roe"] == 0.18
    assert row["negative_earnings_years"] == 0


def test_negative_results_create_trap_inputs() -> None:
    row = build_fundamental_row(
        {"marketCap": 100.0, "netIncomeToCommon": -10.0, "freeCashflow": -5.0},
        {"ticker": "0000.T", "symbol": "0000", "company_name": "Sample", "sector": "Test"},
    )
    assert row["negative_earnings_years"] == 1
    assert row["negative_fcf_years"] == 1
