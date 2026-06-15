from __future__ import annotations

from pathlib import Path
from typing import Mapping

import pandas as pd


def ensure_out_dir(out_dir: str | Path) -> Path:
    path = Path(out_dir)
    path.mkdir(parents=True, exist_ok=True)
    return path


def write_report(
    out_dir: str | Path,
    summary: pd.DataFrame,
    equity_curve: pd.DataFrame,
    walk_forward: pd.DataFrame | None = None,
    fee_sensitivity: pd.DataFrame | None = None,
    notes: Mapping[str, str] | None = None,
) -> dict[str, Path]:
    out = ensure_out_dir(out_dir)
    files = {
        "summary_csv": out / "summary.csv",
        "equity_csv": out / "equity_curve.csv",
        "excel": out / "report.xlsx",
        "text": out / "report.txt",
    }
    summary.to_csv(files["summary_csv"], index=False)
    equity_curve.to_csv(files["equity_csv"])
    if walk_forward is not None:
        files["walk_forward_csv"] = out / "walk_forward.csv"
        walk_forward.to_csv(files["walk_forward_csv"], index=False)
    if fee_sensitivity is not None:
        files["fee_sensitivity_csv"] = out / "fee_sensitivity.csv"
        fee_sensitivity.to_csv(files["fee_sensitivity_csv"], index=False)

    with pd.ExcelWriter(files["excel"], engine="openpyxl") as writer:
        summary.to_excel(writer, sheet_name="summary", index=False)
        equity_curve.to_excel(writer, sheet_name="equity_curve")
        if walk_forward is not None:
            walk_forward.to_excel(writer, sheet_name="walk_forward", index=False)
        if fee_sensitivity is not None:
            fee_sensitivity.to_excel(writer, sheet_name="fee_sensitivity", index=False)
        if notes:
            pd.DataFrame([{"key": k, "value": v} for k, v in notes.items()]).to_excel(writer, sheet_name="notes", index=False)

    with files["text"].open("w", encoding="utf-8") as fh:
        fh.write("Investment Logic Audit Report\n")
        fh.write("=============================\n\n")
        fh.write(summary.to_string(index=False))
        fh.write("\n\n")
        if walk_forward is not None and not walk_forward.empty:
            fh.write("Walk-forward windows\n")
            fh.write(walk_forward.to_string(index=False))
            fh.write("\n\n")
        if notes:
            fh.write("Notes\n")
            for key, value in notes.items():
                fh.write(f"- {key}: {value}\n")
    return files
