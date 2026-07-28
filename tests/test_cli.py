from __future__ import annotations

from investment_audit.cli import main, run_sample
from investment_audit.data import make_synthetic_fundamentals


def test_run_sample_writes_outputs(tmp_path) -> None:
    files = run_sample(tmp_path)
    assert files["summary_csv"].exists()
    assert files["excel"].exists()
    assert files["text"].exists()


def test_value_screen_cli_writes_csv_and_json(tmp_path) -> None:
    source = tmp_path / "fundamentals.csv"
    ranking = tmp_path / "ranking.csv"
    json_output = tmp_path / "ranking.json"
    make_synthetic_fundamentals().to_csv(source)
    status = main(
        [
            "value-screen",
            "--fundamentals",
            str(source),
            "--out",
            str(ranking),
            "--json",
            str(json_output),
        ]
    )
    assert status == 0
    assert ranking.exists()
    assert json_output.exists()


def test_value_screen_demo_is_offline_and_reproducible(tmp_path) -> None:
    ranking = tmp_path / "demo.csv"
    json_output = tmp_path / "demo.json"
    status = main(
        [
            "value-screen-demo",
            "--out",
            str(ranking),
            "--json",
            str(json_output),
        ]
    )
    assert status == 0
    first = ranking.read_text(encoding="utf-8")
    status = main(
        [
            "value-screen-demo",
            "--out",
            str(ranking),
            "--json",
            str(json_output),
        ]
    )
    assert status == 0
    assert ranking.read_text(encoding="utf-8") == first
