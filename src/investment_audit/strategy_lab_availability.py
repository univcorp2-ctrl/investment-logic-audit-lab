from __future__ import annotations

import argparse
import json
from pathlib import Path
from typing import Any

import pandas as pd


def _parse_timestamp(value: Any) -> pd.Timestamp | None:
    if not value:
        return None
    try:
        parsed = pd.Timestamp(value)
    except (TypeError, ValueError):
        return None
    if pd.isna(parsed):
        return None
    if parsed.tzinfo is None:
        parsed = parsed.tz_localize("UTC")
    return parsed.tz_convert("Asia/Tokyo")


def _next_business_day(value: pd.Timestamp) -> pd.Timestamp:
    return (value.normalize() + pd.offsets.BDay(1)).normalize()


def annotate_operational_availability(root: Path) -> dict[str, Any]:
    ranking_path = root / "web" / "jquants-ranking.json"
    report_path = root / "web" / "data" / "strategy-lab" / "latest.json"
    ranking = json.loads(ranking_path.read_text(encoding="utf-8"))
    report = json.loads(report_path.read_text(encoding="utf-8"))

    generated_at = _parse_timestamp(ranking.get("metadata", {}).get("generated_at"))
    evaluation_end = _parse_timestamp(report.get("evaluation_end"))
    operational_start = _next_business_day(generated_at) if generated_at is not None else None

    operational_observations = 0
    if operational_start is not None and evaluation_end is not None and operational_start <= evaluation_end:
        operational_observations = len(pd.bdate_range(operational_start, evaluation_end))

    warning = (
        "Free-plan data with an effective cutoff of 2026-05-11 was not available to this app "
        "until the ranking was generated on 2026-08-03. Returns measured from 2026-05-12 are "
        "counterfactual diagnostics and were not executable with the Free plan at that time."
    )
    warnings = list(report.get("warnings", []))
    if warning not in warnings:
        warnings.insert(0, warning)

    report["availability_model"] = {
        "effective_data_cutoff": ranking.get("metadata", {}).get("effective_data_cutoff"),
        "snapshot_generated_at": generated_at.isoformat() if generated_at is not None else None,
        "operational_start": operational_start.isoformat() if operational_start is not None else None,
        "counterfactual_observations": int(report.get("observations", 0)),
        "operational_observations": operational_observations,
        "counterfactual_only": True,
    }
    report["research_candidate"] = None
    report["auto_adopt"] = False
    report["adoption_status"] = "not_eligible_operational_history"
    report["warnings"] = warnings
    report["disclaimer"] = (
        "Historical counterfactual research only. The delayed snapshot was not operationally "
        "available during most of the displayed comparison period. No paper or broker rule is "
        "changed automatically and no future return is guaranteed."
    )

    report_path.write_text(
        json.dumps(report, ensure_ascii=False, indent=2, allow_nan=False) + "\n",
        encoding="utf-8",
    )
    return report


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description="Annotate strategy research with delayed-data availability")
    parser.add_argument("--root", type=Path, default=Path.cwd())
    args = parser.parse_args(argv)
    report = annotate_operational_availability(args.root)
    print(
        json.dumps(
            {
                "adoption_status": report["adoption_status"],
                "operational_observations": report["availability_model"]["operational_observations"],
                "counterfactual_observations": report["availability_model"]["counterfactual_observations"],
            },
            ensure_ascii=False,
        )
    )
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
