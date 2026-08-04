from __future__ import annotations

import json
from pathlib import Path

from investment_audit.strategy_lab_availability import annotate_operational_availability


def test_delayed_snapshot_cannot_promote_counterfactual_result(tmp_path: Path) -> None:
    web = tmp_path / "web"
    output = web / "data" / "strategy-lab"
    output.mkdir(parents=True)
    (web / "jquants-ranking.json").write_text(
        json.dumps(
            {
                "metadata": {
                    "generated_at": "2026-08-03T05:07:31+00:00",
                    "effective_data_cutoff": "2026-05-11",
                }
            }
        ),
        encoding="utf-8",
    )
    (output / "latest.json").write_text(
        json.dumps(
            {
                "evaluation_end": "2026-08-03T00:00:00+09:00",
                "observations": 59,
                "research_candidate": "low_volatility",
                "adoption_status": "research_candidate",
                "auto_adopt": False,
                "warnings": [],
            }
        ),
        encoding="utf-8",
    )

    result = annotate_operational_availability(tmp_path)

    assert result["availability_model"]["counterfactual_observations"] == 59
    assert result["availability_model"]["operational_observations"] == 0
    assert result["research_candidate"] is None
    assert result["adoption_status"] == "not_eligible_operational_history"
    assert result["availability_model"]["counterfactual_only"] is True
