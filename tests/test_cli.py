from __future__ import annotations

from investment_audit.cli import run_sample


def test_run_sample_writes_outputs(tmp_path) -> None:
    files = run_sample(tmp_path)
    assert files["summary_csv"].exists()
    assert files["excel"].exists()
    assert files["text"].exists()
