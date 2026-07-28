from __future__ import annotations

import numpy as np
import pandas as pd

from investment_audit.cli import main


def test_factor_audit_cli_writes_diagnostics(tmp_path) -> None:
    index = pd.date_range("2024-01-01", periods=90, freq="B")
    symbols = [f"S{i}" for i in range(6)]
    factor = pd.DataFrame(
        [np.arange(1, 7, dtype=float) + day * 0.001 for day in range(len(index))],
        index=index,
        columns=symbols,
    )
    daily_returns = pd.DataFrame(
        [np.arange(1, 7, dtype=float) * 0.0002 for _ in index],
        index=index,
        columns=symbols,
    )
    prices = 100.0 * (1.0 + daily_returns).cumprod()
    score_path = tmp_path / "scores.csv"
    price_path = tmp_path / "prices.csv"
    output = tmp_path / "factor-audit"
    factor.to_csv(score_path)
    prices.to_csv(price_path)

    status = main(
        [
            "factor-audit",
            "--scores",
            str(score_path),
            "--prices",
            str(price_path),
            "--horizons",
            "1,5,21",
            "--quantiles",
            "3",
            "--out",
            str(output),
        ]
    )

    assert status == 0
    assert (output / "factor-summary.csv").exists()
    assert (output / "factor-summary.json").exists()
    assert (output / "information-coefficient.csv").exists()
    assert (output / "quantile-returns.csv").exists()
    assert (output / "quantile-turnover.csv").exists()
    assert (output / "rank-autocorrelation.csv").exists()
