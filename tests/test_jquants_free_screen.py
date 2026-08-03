from __future__ import annotations

import json
from pathlib import Path

import numpy as np
import pandas as pd

from investment_audit.jquants_free_screen import run_free_liquid_screen
from investment_audit.jquants_pipeline import JQuantsScreenConfig


class StagedFakeProvider:
    def __init__(self) -> None:
        self.dates = pd.bdate_range("2024-05-13", "2026-05-11")
        self.codes = ["11110", "22220", "33330"]
        self.calls: list[tuple[str, str | None]] = []

    def get_master(self, as_of: object = None) -> pd.DataFrame:
        self.calls.append(("master", None))
        return pd.DataFrame(
            {
                "code": self.codes,
                "company_name": ["アルファ", "ベータ", "ガンマ"],
                "market_name": ["Prime", "Prime", "Standard"],
                "sector_33": ["電気機器", "卸売業", "情報通信"],
            }
        )

    def get_daily_bars(
        self,
        code: str | None = None,
        start: object = None,
        end: object = None,
        as_of: object = None,
    ) -> pd.DataFrame:
        self.calls.append(("bars", code))
        if code is None:
            return pd.DataFrame(
                {
                    "code": self.codes,
                    "date": ["2026-05-11"] * 3,
                    "close": [1500.0, 1000.0, 500.0],
                    "volume": [3_000_000.0, 2_000_000.0, 1_000_000.0],
                    "adjusted_close": [1500.0, 1000.0, 500.0],
                    "adjusted_volume": [3_000_000.0, 2_000_000.0, 1_000_000.0],
                }
            )
        index = self.codes.index(code)
        close = np.linspace(800 + index * 100, 1200 + index * 100, len(self.dates))
        return pd.DataFrame(
            {
                "code": code,
                "date": self.dates,
                "open": close * 0.998,
                "high": close * 1.01,
                "low": close * 0.99,
                "close": close,
                "adjusted_close": close,
                "volume": 1_500_000.0,
            }
        )

    def get_financial_summary(
        self,
        code: str | None = None,
        start: object = None,
        end: object = None,
        as_of: object = None,
    ) -> pd.DataFrame:
        self.calls.append(("financials", code))
        assert code is not None
        return pd.DataFrame(
            [
                {
                    "code": code,
                    "disclosed_date": "2025-05-01",
                    "period_end": "2025-03-31",
                    "net_sales": 1_000_000,
                    "operating_profit": 100_000,
                    "profit": 70_000,
                    "eps": 70,
                    "total_assets": 2_000_000,
                    "equity": 1_000_000,
                    "operating_cash_flow": 100_000,
                    "investing_cash_flow": -30_000,
                    "ShOutFY": 1_000_000,
                    "BPS": 1000,
                    "DivAnn": 30,
                },
                {
                    "code": code,
                    "disclosed_date": "2026-05-01",
                    "period_end": "2026-03-31",
                    "net_sales": 1_150_000,
                    "operating_profit": 125_000,
                    "profit": 85_000,
                    "eps": 85,
                    "total_assets": 2_100_000,
                    "equity": 1_100_000,
                    "operating_cash_flow": 125_000,
                    "investing_cash_flow": -35_000,
                    "ShOutFY": 1_000_000,
                    "BPS": 1100,
                    "DivAnn": 35,
                },
            ]
        )


def test_staged_free_screen_avoids_bulk_range_and_outputs_jquants_metadata(tmp_path: Path) -> None:
    provider = StagedFakeProvider()
    config = JQuantsScreenConfig(
        as_of="2026-08-03",
        plan="free",
        out_dir=tmp_path / "out",
        cache_dir=tmp_path / "cache",
        top_n=2,
        markets=("Prime", "Standard"),
        min_average_daily_value=1.0,
        minimum_data_completeness=20.0,
    )
    paths = run_free_liquid_screen(
        config,
        universe_size=2,
        provider=provider,
        sleep_fn=lambda _: None,
    )
    payload = json.loads(paths["ranking_json"].read_text(encoding="utf-8"))
    assert payload["metadata"]["source"].startswith("J-Quants API V2")
    assert payload["metadata"]["effective_data_cutoff"] == "2026-05-11"
    assert payload["metadata"]["selected_count"] == 2
    assert len(payload["rows"]) == 2
    assert all(code is not None for kind, code in provider.calls if kind in {"financials"})
    assert not any(kind == "bars" and code is None for kind, code in provider.calls[2:])
