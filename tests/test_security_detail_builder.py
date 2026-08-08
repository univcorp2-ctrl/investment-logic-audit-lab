from __future__ import annotations

from pathlib import Path

import pandas as pd
import pytest

from investment_audit.security_detail_builder import (
    DetailBuildConfig,
    add_moving_averages,
    build_security_details,
    normalize_code,
    recommendation_block,
    trend_status,
)


class FakeProvider:
    def get_daily_bars(self, code: str) -> pd.DataFrame:
        index = pd.date_range("2026-01-01", periods=80, freq="B")
        return pd.DataFrame(
            {
                "date": index,
                "open": range(100, 180),
                "high": range(102, 182),
                "low": range(98, 178),
                "close": range(101, 181),
                "volume": [1000] * 80,
            }
        )

    def get_financial_summary(self, code: str) -> pd.DataFrame:
        return pd.DataFrame(
            [
                {
                    "disclosed_date": "2025-08-01",
                    "net_sales": 100,
                    "operating_profit": 10,
                },
                {
                    "disclosed_date": "2026-08-01",
                    "net_sales": 120,
                    "operating_profit": 15,
                },
            ]
        )

    _client = object()

    @staticmethod
    def _as_frame(payload: object) -> pd.DataFrame:
        return pd.DataFrame(payload)


def test_normalize_code_and_moving_averages() -> None:
    assert normalize_code("80350") == "8035"
    rows = [
        {"date": f"2026-01-{index:02d}", "close": float(index)}
        for index in range(1, 29)
    ]
    calculated = add_moving_averages(rows)
    assert calculated[-1]["sma20"] is not None
    assert calculated[-1]["sma60"] is not None


def test_trend_status_detects_growth() -> None:
    result = trend_status(
        [
            {"net_sales": 100, "operating_profit": 10},
            {"net_sales": 120, "operating_profit": 15},
        ]
    )
    assert result["label"] == "増収増益"
    assert result["sales_change_pct"] == pytest.approx(20.0)


def test_recommendation_separates_fundamental_and_technical() -> None:
    block = recommendation_block(
        "8035",
        {"positive_reasons": "割安 / FCF", "negative_reasons": ""},
        {
            "fundamental": {
                "positive_reasons": ["品質"],
                "risk_reasons": ["欠損"],
            },
            "technical": {
                "positive_reasons": ["SMA上向き"],
                "risk_reasons": ["高ボラ"],
            },
            "decision": {"action": "SIM_HOLD", "confidence": 70},
        },
    )
    assert "品質" in block["fundamental"]["positive_reasons"]
    assert "SMA上向き" in block["technical"]["positive_reasons"]
    assert "高ボラ" not in block["fundamental"]["risk_reasons"]


def test_builder_writes_sanitized_detail_files(
    tmp_path: Path,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    web = tmp_path / "web"
    (web / "data" / "paper-trading").mkdir(parents=True)
    (web / "jquants-ranking.json").write_text(
        '{"metadata":{"effective_data_cutoff":"2026-05-11"},'
        '"rows":[{"rank":1,"code":"80350",'
        '"company_name":"東京エレクトロン"}]}',
        encoding="utf-8",
    )
    (web / "data" / "paper-trading" / "latest-report.json").write_text(
        '{"decisions":[{"code":"8035","fundamental":{},'
        '"technical":{},"decision":{"action":"WATCH"}}]}',
        encoding="utf-8",
    )
    monkeypatch.setattr(
        "investment_audit.security_detail_builder.fetch_news",
        lambda *args, **kwargs: [],
    )
    result = build_security_details(
        tmp_path,
        provider=FakeProvider(),
        config=DetailBuildConfig(max_codes=1, jquants_interval_seconds=0),
        sleep_fn=lambda _: None,
    )
    detail_path = web / "data" / "security-details" / "8035.json"
    assert result["securities"][0]["code"] == "8035"
    assert detail_path.exists()
    text = detail_path.read_text(encoding="utf-8").lower()
    assert "api_key" not in text
    assert "sma20" in text
