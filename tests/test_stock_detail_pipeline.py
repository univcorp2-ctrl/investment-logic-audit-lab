from __future__ import annotations

import json
from pathlib import Path

import pandas as pd

from investment_audit.stock_detail_pipeline import (
    build_stock_detail_payload,
    generate_stock_details,
    jquants_code,
    normalize_code,
    sanitize_financial_rows,
    selected_securities,
)


class FakeProvider:
    def get_financial_summary(self, code: str | None = None) -> pd.DataFrame:
        return pd.DataFrame(
            [
                {
                    "code": code,
                    "disclosed_date": "2026-05-01",
                    "period_end": "2026-03-31",
                    "net_sales": 100,
                    "operating_profit": 20,
                    "profit": 10,
                    "eps": 5,
                }
            ]
        )

    def get_financial_earnings_dates(self, code: str | None = None) -> pd.DataFrame:
        return pd.DataFrame([{"code": code, "earnings_date": "2026-10-30"}])


def write_json(path: Path, payload: object) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps(payload), encoding="utf-8")


def test_code_normalization_for_jquants() -> None:
    assert normalize_code("80350") == "8035"
    assert normalize_code("285A.T") == "285A"
    assert jquants_code("8035") == "80350"
    assert jquants_code("285A") == "285A0"


def test_financial_sanitation_keeps_only_display_fields() -> None:
    frame = pd.DataFrame(
        [
            {
                "Code": "80350",
                "DiscDate": "2026-05-01",
                "Sales": 100,
                "OP": 20,
                "SecretColumn": "must-not-leak",
            }
        ]
    )
    rows = sanitize_financial_rows(frame)
    assert rows[0]["net_sales"] == 100
    assert rows[0]["operating_profit"] == 20
    assert "SecretColumn" not in rows[0]


def test_plan_capability_flags_are_honest() -> None:
    security = {"code": "8035", "symbol": "8035.T", "company_name": "Example"}
    free = build_stock_detail_payload(security, pd.DataFrame(), pd.DataFrame(), "free", "now")
    premium = build_stock_detail_payload(security, pd.DataFrame(), pd.DataFrame(), "premium", "now")
    premium_with_output = build_stock_detail_payload(
        security,
        pd.DataFrame(),
        pd.DataFrame(),
        "premium",
        "now",
        detailed_statements=[{"TotalAssets": 100}],
    )
    assert free["financial_capabilities"]["summary"] is True
    assert free["financial_capabilities"]["full_statements_entitled"] is False
    assert free["financial_capabilities"]["full_statements_available"] is False
    assert premium["financial_capabilities"]["full_statements_entitled"] is True
    assert premium["financial_capabilities"]["full_statements_available"] is False
    assert premium["financial_capabilities"]["full_statements_status"] == "not_generated"
    assert premium_with_output["financial_capabilities"]["full_statements_available"] is True
    assert premium_with_output["financial_capabilities"]["full_statements"] is True
    assert free["official_disclosures"] == []


def test_pipeline_generates_sanitized_files(tmp_path: Path) -> None:
    write_json(
        tmp_path / "web/demo-portfolio.json",
        {"positions": [{"code": "8035", "company_name": "Example"}]},
    )
    write_json(tmp_path / "web/jquants-ranking.json", {"rows": []})
    result = generate_stock_details(
        tmp_path,
        provider=FakeProvider(),
        plan="free",
        limit=1,
        sleep_fn=lambda _: None,
    )
    assert result["updated"] == 1
    payload = json.loads((tmp_path / "web/data/stock-details/8035.json").read_text())
    assert payload["financial_history_status"] == "available"
    assert payload["next_earnings_date"] == "2026-10-30"
    assert payload["financial_capabilities"]["full_statements_available"] is False
    text = json.dumps(payload).lower()
    assert "api_key" not in text and "secretcolumn" not in text


def test_selected_securities_are_deduplicated(tmp_path: Path) -> None:
    write_json(
        tmp_path / "web/demo-portfolio.json",
        {"positions": [{"code": "8035"}]},
    )
    write_json(
        tmp_path / "web/jquants-ranking.json",
        {"rows": [{"code": "80350"}, {"code": "68570"}]},
    )
    assert [row["code"] for row in selected_securities(tmp_path)] == ["8035", "6857"]
