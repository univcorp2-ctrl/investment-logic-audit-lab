from __future__ import annotations

import json
from pathlib import Path

import numpy as np
import pandas as pd
import pytest

from investment_audit.jquants_pipeline import (
    JQuantsScreenConfig,
    effective_cutoff,
    filter_common_stock_universe,
    point_in_time_financials,
    run_screen,
)


def test_free_plan_uses_twelve_week_cutoff() -> None:
    assert effective_cutoff("2026-08-03", "free") == pd.Timestamp("2026-05-11")
    assert effective_cutoff("2026-08-03", "light") == pd.Timestamp("2026-08-03")


def test_universe_removes_funds_reits_and_preferred_stock() -> None:
    master = pd.DataFrame(
        {
            "code": ["13010", "13020", "13030", "13011", "13040"],
            "company_name": ["普通株式会社", "日本ETF", "東京投資法人", "種類株", "成長株式会社"],
            "market_name": ["Prime", "ETF/ETN", "REIT", "Prime", "Growth"],
        }
    )
    result = filter_common_stock_universe(master)
    assert result["code"].tolist() == ["13010", "13040"]


def test_point_in_time_excludes_future_disclosures() -> None:
    financials = pd.DataFrame(
        {
            "code": ["13010", "13010"],
            "disclosed_date": ["2026-05-01", "2026-06-01"],
            "profit": [100.0, 999.0],
        }
    )
    result = point_in_time_financials(financials, pd.Timestamp("2026-05-11"))
    assert result["profit"].tolist() == [100.0]


class FakeProvider:
    def __init__(self) -> None:
        self.dates = pd.bdate_range("2024-01-01", "2026-05-11")

    def get_master(self, as_of: object = None) -> pd.DataFrame:
        return pd.DataFrame(
            {
                "code": ["13010", "13040", "13430"],
                "company_name": ["アルファ", "ベータ", "日本ETF"],
                "market_name": ["Prime", "Standard", "ETF/ETN"],
                "sector_33": ["電気機器", "卸売業", "ETF"],
            }
        )

    def get_daily_bars(self, start: object = None, end: object = None) -> pd.DataFrame:
        rows: list[dict[str, object]] = []
        for offset, code in enumerate(("13010", "13040")):
            close = np.linspace(900 + offset * 100, 1200 + offset * 120, len(self.dates))
            for date, price in zip(self.dates, close, strict=True):
                rows.append(
                    {
                        "code": code,
                        "date": date,
                        "open": price * 0.998,
                        "high": price * 1.01,
                        "low": price * 0.99,
                        "close": price,
                        "volume": 1_500_000 + offset * 100_000,
                        "adjusted_close": price,
                    }
                )
        return pd.DataFrame(rows)

    def get_financial_summary(self, start: object = None, end: object = None) -> pd.DataFrame:
        rows: list[dict[str, object]] = []
        for offset, code in enumerate(("13010", "13040")):
            rows.extend(
                [
                    {
                        "code": code,
                        "disclosed_date": "2025-05-01",
                        "period_end": "2025-03-31",
                        "net_sales": 1_000_000 + offset * 100_000,
                        "operating_profit": 120_000 + offset * 10_000,
                        "profit": 80_000 + offset * 5_000,
                        "eps": 80 + offset * 5,
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
                        "net_sales": 1_150_000 + offset * 100_000,
                        "operating_profit": 145_000 + offset * 10_000,
                        "profit": 95_000 + offset * 5_000,
                        "eps": 95 + offset * 5,
                        "total_assets": 2_100_000,
                        "equity": 1_100_000,
                        "operating_cash_flow": 125_000,
                        "investing_cash_flow": -35_000,
                        "ShOutFY": 1_000_000,
                        "BPS": 1100,
                        "DivAnn": 36,
                    },
                    {
                        "code": code,
                        "disclosed_date": "2026-06-01",
                        "period_end": "2026-03-31",
                        "profit": 9_999_999,
                    },
                ]
            )
        return pd.DataFrame(rows)


def test_pipeline_is_deterministic_and_never_writes_secret(tmp_path: Path, monkeypatch: pytest.MonkeyPatch) -> None:
    secret = "unit-test-secret-value-that-must-never-appear"
    monkeypatch.setenv("JQUANTS_API_KEY", secret)
    config = JQuantsScreenConfig(
        as_of="2026-08-03",
        plan="free",
        out_dir=tmp_path / "out",
        cache_dir=tmp_path / "cache",
        min_average_daily_value=1.0,
        minimum_data_completeness=20.0,
        top_n=2,
    )
    paths = run_screen(config, provider=FakeProvider(), sleep_fn=lambda _: None)
    payload = json.loads(paths["ranking_json"].read_text(encoding="utf-8"))
    assert [row["code"] for row in payload["rows"]] == sorted(
        [row["code"] for row in payload["rows"]],
        key=lambda code: next(
            row["rank"] for row in payload["rows"] if row["code"] == code
        ),
    )
    assert payload["metadata"]["effective_data_cutoff"] == "2026-05-11"
    assert payload["rows"]
    for path in paths.values():
        assert secret not in path.read_text(encoding="utf-8")


def test_invalid_plan_is_rejected() -> None:
    with pytest.raises(ValueError, match="unknown J-Quants plan"):
        JQuantsScreenConfig(plan="enterprise")
