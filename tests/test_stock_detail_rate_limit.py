from __future__ import annotations

import json
from pathlib import Path

import pandas as pd

from investment_audit.stock_detail_pipeline import generate_stock_details


class FakeProvider:
    def __init__(self) -> None:
        self.events: list[str] = []

    def get_financial_summary(self, code: str | None = None) -> pd.DataFrame:
        self.events.append(f"summary:{code}")
        return pd.DataFrame([{"DisclosedDate": "2026-05-01", "NetSales": 100, "OperatingProfit": 20}])

    def get_financial_earnings_dates(self, code: str | None = None) -> pd.DataFrame:
        self.events.append(f"earnings:{code}")
        return pd.DataFrame([{"earnings_date": "2026-10-30"}])


def _write(path: Path, payload: object) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps(payload), encoding="utf-8")


def test_free_plan_paces_every_api_call(tmp_path: Path) -> None:
    _write(tmp_path / "web/demo-portfolio.json", {"positions": [{"code": "8035"}, {"code": "6857"}]})
    _write(tmp_path / "web/jquants-ranking.json", {"rows": []})
    provider = FakeProvider()
    sleeps: list[float] = []
    result = generate_stock_details(tmp_path, provider=provider, plan="free", limit=2, sleep_fn=sleeps.append)
    assert result["api_calls"] == 4
    assert result["updated"] == 2
    assert sleeps == [12.2, 12.2, 12.2]
    assert provider.events == ["summary:80350", "earnings:80350", "summary:68570", "earnings:68570"]
