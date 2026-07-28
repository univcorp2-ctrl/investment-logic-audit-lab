import json

import numpy as np
import pandas as pd

from investment_audit.fundamentals import (
    FundamentalConfig,
    derive_fundamental_metrics,
    score_fundamentals,
)


def sample_fundamentals() -> pd.DataFrame:
    return pd.DataFrame(
        {
            "sector": ["A", "A", "A", "B", "B", "B"],
            "market_cap": [100, 100, 100, 200, 200, 200],
            "enterprise_value": [80, 100, 160, 140, 210, 400],
            "net_income": [14, 8, -5, 22, 10, -15],
            "book_value": [90, 60, 20, 180, 100, 30],
            "free_cash_flow": [16, 6, -8, 24, 7, -20],
            "ebitda": [20, 12, 3, 30, 18, 4],
            "dividends": [3, 1, 0, 5, 2, 0],
            "buybacks": [2, 0, -2, 2, 0, -4],
            "net_cash": [30, 5, -40, 40, -20, -100],
            "revenue": [120, 110, 90, 250, 230, 180],
            "gross_profit": [55, 35, 15, 110, 65, 20],
            "operating_income": [20, 10, -4, 35, 14, -12],
            "operating_cash_flow": [19, 8, -4, 30, 9, -14],
            "total_assets": [150, 140, 160, 300, 320, 400],
            "invested_capital": [100, 100, 130, 210, 240, 350],
            "total_debt": [10, 35, 90, 20, 80, 220],
            "revenue_growth": [0.12, 0.03, -0.2, 0.10, 0.01, -0.25],
            "eps_growth": [0.15, 0.02, -0.3, 0.11, -0.02, -0.4],
            "fcf_growth": [0.18, 0.01, -0.4, 0.12, -0.05, -0.5],
            "margin_stability": [0.9, 0.7, 0.2, 0.85, 0.6, 0.1],
            "earnings_volatility": [0.1, 0.2, 0.8, 0.12, 0.3, 1.0],
            "earnings_stability": [0.9, 0.7, 0.1, 0.85, 0.6, 0.05],
            "fcf_stability": [0.9, 0.65, 0.05, 0.8, 0.5, 0.01],
            "share_count_growth": [-0.02, 0.0, 0.12, -0.01, 0.02, 0.2],
            "debt_to_ebitda_change": [-0.2, 0.1, 1.0, -0.1, 0.2, 1.5],
            "operating_margin_change": [0.02, 0.0, -0.08, 0.01, -0.01, -0.12],
            "negative_earnings_years": [0, 0, 3, 0, 0, 4],
            "negative_fcf_years": [0, 0, 3, 0, 0, 4],
        },
        index=["A1", "A2", "A3", "B1", "B2", "B3"],
    )


def test_derivation_preserves_missing_and_avoids_infinity() -> None:
    frame = pd.DataFrame(
        {"market_cap": [0.0, 100.0], "net_income": [10.0, np.nan]},
        index=["X", "Y"],
    )
    metrics = derive_fundamental_metrics(frame)
    assert np.isnan(metrics.loc["X", "earnings_yield"])
    assert np.isnan(metrics.loc["Y", "earnings_yield"])
    assert not np.isinf(metrics.select_dtypes(include="number").to_numpy()).any()


def test_good_value_quality_beats_value_trap() -> None:
    scored = score_fundamentals(sample_fundamentals())
    assert scored.loc["A1", "undervaluation_score"] > scored.loc["A3", "undervaluation_score"]
    assert scored.loc["B1", "quality_score"] > scored.loc["B3", "quality_score"]
    assert scored.loc["B3", "value_trap_risk"] > scored.loc["B1", "value_trap_risk"]
    bounded = [
        column
        for column in scored.columns
        if column.endswith("_score") and not column.endswith("_contribution")
    ]
    bounded += ["value_trap_risk", "data_completeness", "confidence"]
    assert scored[bounded].min().min() >= 0
    assert scored[bounded].max().max() <= 100
    assert isinstance(json.loads(scored.loc["A1", "reasons"]), list)


def test_sector_neutral_and_extreme_values_are_deterministic() -> None:
    frame = sample_fundamentals()
    frame.loc["A1", "net_income"] = 1e12
    config = FundamentalConfig(sector_neutral=True)
    first = score_fundamentals(frame, config)
    second = score_fundamentals(frame.sample(frac=1.0, random_state=7), config).reindex(first.index)
    pd.testing.assert_series_equal(first["undervaluation_score"], second["undervaluation_score"])


def test_piotroski_handles_partial_data() -> None:
    frame = sample_fundamentals().iloc[:2].copy()
    frame["roa_change"] = [0.01, -0.02]
    frame["current_ratio_change"] = [0.1, -0.1]
    frame["gross_margin_change"] = [0.02, -0.01]
    frame["asset_turnover_change"] = [0.03, -0.04]
    scored = score_fundamentals(frame, FundamentalConfig(sector_neutral=False))
    assert scored.loc["A1", "piotroski_f_score"] > scored.loc["A2", "piotroski_f_score"]
    assert scored["piotroski_completeness"].between(0, 100).all()
