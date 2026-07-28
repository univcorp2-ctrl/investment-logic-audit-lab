import json

import pandas as pd

from investment_audit.screening import ValueScreenConfig, screen_value_stocks, write_screen_results
from test_fundamentals import sample_fundamentals


def test_screen_ranks_good_candidates_and_filters_traps() -> None:
    fundamentals = sample_fundamentals()
    fundamentals["average_daily_value"] = [100, 90, 10, 120, 80, 5]
    technical = pd.DataFrame(
        {"technical_score": [70, 55, 20, 68, 52, 15], "risk_score": [80, 60, 20, 75, 55, 10]},
        index=fundamentals.index,
    )
    result = screen_value_stocks(fundamentals, technical_scores=technical)
    assert result.index[0] in {"A1", "B1"}
    assert not bool(result.loc["A3", "eligible"])
    assert not bool(result.loc["B3", "eligible"])
    assert json.loads(result.loc["B3", "filter_reasons"])
    assert result["rank"].tolist() == list(range(1, len(result) + 1))


def test_thresholds_are_configurable() -> None:
    fundamentals = sample_fundamentals()
    strict = ValueScreenConfig(minimum_quality=90, maximum_value_trap_risk=20)
    result = screen_value_stocks(fundamentals, config=strict)
    assert not result["eligible"].any()


def test_csv_and_json_outputs(tmp_path) -> None:
    result = screen_value_stocks(sample_fundamentals())
    outputs = write_screen_results(result, tmp_path / "ranking.csv", tmp_path / "ranking.json")
    assert outputs["ranking"].exists()
    assert outputs["json"].exists()
    loaded = pd.read_csv(outputs["ranking"], index_col=0)
    assert "overall_score" in loaded.columns
