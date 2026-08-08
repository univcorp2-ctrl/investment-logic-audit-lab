from __future__ import annotations

import json
from pathlib import Path

import numpy as np
import pandas as pd

from investment_audit.open_source_strategy_lab import LabConfig
from investment_audit.operational_strategy_evaluation import (
    build_operational_evaluation,
)


def _history(_: str) -> pd.DataFrame:
    index = pd.date_range("2026-01-01", periods=220, freq="B", tz="Asia/Tokyo")
    return pd.DataFrame(
        {
            "close": 100 + np.linspace(0, 30, len(index)),
            "volume": np.full(len(index), 1_000_000),
        },
        index=index,
    )


def test_operational_start_is_after_snapshot_and_no_prior_rows(tmp_path: Path) -> None:
    web = tmp_path / "web"
    web.mkdir()
    (web / "jquants-ranking.json").write_text(
        json.dumps(
            {
                "metadata": {"generated_at": "2026-06-01T06:00:00+00:00"},
                "rows": [
                    {
                        "code": "10000",
                        "value_score": 60,
                        "quality_score": 60,
                    }
                ],
            }
        ),
        encoding="utf-8",
    )
    (web / "demo-portfolio.json").write_text(
        json.dumps({"positions": [{"symbol": "1000.T", "code": "1000"}]}),
        encoding="utf-8",
    )
    result = build_operational_evaluation(
        tmp_path,
        loader=_history,
        config=LabConfig(train_days=20, test_days=5, purge_days=1, min_oos_days=10),
    )
    start = pd.Timestamp(result["evaluation_start"])
    snapshot = pd.Timestamp("2026-06-01T15:00:00+09:00")
    assert start > snapshot.normalize()
    assert result["lookahead_safe"] is True
    assert result["observations"] > 0
    assert all(
        pd.Timestamp(row["evaluation_start"]) >= pd.Timestamp(result["operational_start"])
        for row in [result]
    )
