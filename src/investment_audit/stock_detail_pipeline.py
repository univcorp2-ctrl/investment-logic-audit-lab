from __future__ import annotations

import argparse
import datetime as dt
import json
import os
import time
from pathlib import Path
from typing import Any, Callable

import pandas as pd

from .providers.jquants import (
    JQuantsAuthError,
    JQuantsConfig,
    JQuantsProvider,
    JQuantsProviderError,
)


def normalize_code(value: Any) -> str | None:
    text = str(value or "").strip().upper().removesuffix(".T")
    if len(text) == 5 and text.endswith("0"):
        text = text[:-1]
    return text if len(text) == 4 and text.isalnum() else None


def jquants_code(value: Any) -> str | None:
    code = normalize_code(value)
    return f"{code}0" if code else None


def load_json(path: Path, default: Any) -> Any:
    if not path.exists():
        return default
    return json.loads(path.read_text(encoding="utf-8"))


def write_json(path: Path, payload: Any) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(
        json.dumps(payload, ensure_ascii=False, indent=2, allow_nan=False) + "\n",
        encoding="utf-8",
    )


def json_value(value: Any) -> Any:
    if value is None or value is pd.NA:
        return None
    if isinstance(value, (pd.Timestamp, dt.datetime, dt.date)):
        return value.isoformat()
    if isinstance(value, bool):
        return value
    if isinstance(value, int):
        return value
    if isinstance(value, float):
        return value if pd.notna(value) else None
    if pd.isna(value):
        return None
    if hasattr(value, "item"):
        try:
            return json_value(value.item())
        except (TypeError, ValueError):
            pass
    return str(value)


def first_value(row: dict[str, Any], *names: str) -> Any:
    for name in names:
        if name in row and row[name] is not None and not pd.isna(row[name]):
            return json_value(row[name])
    return None


def sanitize_financial_rows(frame: pd.DataFrame) -> list[dict[str, Any]]:
    if frame.empty:
        return []
    records: list[dict[str, Any]] = []
    for raw in frame.to_dict(orient="records"):
        row = {
            "disclosed_date": first_value(raw, "disclosed_date", "DiscDate", "DisclosedDate"),
            "period_end": first_value(raw, "period_end", "CurPerEn", "CurrentPeriodEndDate"),
            "fiscal_year_end": first_value(raw, "fiscal_year_end", "FYE", "CurrentFiscalYearEndDate"),
            "document_type": first_value(raw, "document_type", "DocType", "TypeOfDocument"),
            "net_sales": first_value(raw, "net_sales", "Sales", "NetSales"),
            "operating_profit": first_value(raw, "operating_profit", "OP", "OperatingProfit"),
            "ordinary_profit": first_value(raw, "ordinary_profit", "OdP", "OrdinaryProfit"),
            "profit": first_value(raw, "profit", "Profit"),
            "eps": first_value(raw, "eps", "EPS", "EarningsPerShare"),
            "total_assets": first_value(raw, "total_assets", "TA", "TotalAssets"),
            "equity": first_value(raw, "equity", "Eq", "Equity"),
            "operating_cash_flow": first_value(raw, "operating_cash_flow", "CFO", "CashFlowsFromOperatingActivities"),
            "investing_cash_flow": first_value(raw, "investing_cash_flow", "CFI", "CashFlowsFromInvestingActivities"),
            "financing_cash_flow": first_value(raw, "financing_cash_flow", "CFF", "CashFlowsFromFinancingActivities"),
            "forecast_sales": first_value(raw, "forecast_sales", "FctSales", "ForecastNetSales"),
            "forecast_operating_profit": first_value(raw, "forecast_operating_profit", "FctOP", "ForecastOperatingProfit"),
            "forecast_profit": first_value(raw, "forecast_profit", "FctProfit", "ForecastProfit"),
            "forecast_eps": first_value(raw, "forecast_eps", "FctEPS", "ForecastEarningsPerShare"),
            "forecast_revision": first_value(raw, "forecast_revision", "ForecastRevision", "MaterialChangesInSubsidiaries"),
        }
        if any(value is not None for value in row.values()):
            records.append(row)
    records.sort(
        key=lambda row: str(row.get("disclosed_date") or row.get("period_end") or ""),
        reverse=True,
    )
    return records[:8]


class StockDetailJQuantsProvider(JQuantsProvider):
    def get_financial_earnings_dates(self, code: str | None = None) -> pd.DataFrame:
        try:
            frame = self._request(
                "get_fin_earnings_date",
                [(('code',), code)],
                {"code": code},
            )
        except JQuantsProviderError:
            return pd.DataFrame()
        return self._normalize(
            frame,
            {
                "code": ("Code",),
                "earnings_date": ("Date", "EarningsDate"),
            },
            ("earnings_date",),
        )


def selected_securities(root: Path, limit: int = 20) -> list[dict[str, Any]]:
    web = root / "web"
    demo = load_json(web / "demo-portfolio.json", {"positions": []})
    ranking = load_json(web / "jquants-ranking.json", {"rows": []})
    selected: list[dict[str, Any]] = []
    seen: set[str] = set()
    for row in [*demo.get("positions", []), *ranking.get("rows", [])]:
        code = normalize_code(row.get("code") or row.get("symbol"))
        if not code or code in seen:
            continue
        seen.add(code)
        selected.append(
            {
                "code": code,
                "symbol": f"{code}.T",
                "company_name": row.get("company_name") or row.get("name") or code,
                "market": row.get("market"),
                "sector": row.get("sector"),
            }
        )
        if len(selected) >= limit:
            break
    return selected


def next_earnings_date(frame: pd.DataFrame) -> str | None:
    if frame.empty or "earnings_date" not in frame:
        return None
    values = pd.to_datetime(frame["earnings_date"], errors="coerce").dropna().sort_values()
    if values.empty:
        return None
    today = pd.Timestamp.now(tz="Asia/Tokyo").tz_localize(None).normalize()
    future = values.loc[values >= today]
    value = future.iloc[0] if not future.empty else values.iloc[-1]
    return value.date().isoformat()


def build_stock_detail_payload(
    security: dict[str, Any],
    frame: pd.DataFrame,
    earnings_frame: pd.DataFrame,
    plan: str,
    generated_at: str,
) -> dict[str, Any]:
    rows = sanitize_financial_rows(frame)
    return {
        "schema_version": 1,
        "generated_at": generated_at,
        "code": security["code"],
        "symbol": security["symbol"],
        "company_name": security["company_name"],
        "market": security.get("market"),
        "sector": security.get("sector"),
        "plan": plan,
        "financial_history_status": "available" if rows else "unavailable_until_jquants_refresh",
        "financial_capabilities": {
            "summary": True,
            "full_statements": plan.lower() == "premium",
            "full_statements_status": "not_requested" if plan.lower() == "premium" else "premium_entitlement_required",
        },
        "financial_summaries": rows,
        "next_earnings_date": next_earnings_date(earnings_frame),
        "official_disclosure_status": "tdnet_addon_not_configured",
        "official_disclosures": [],
        "paper_only": True,
    }


def generate_stock_details(
    root: Path,
    provider: StockDetailJQuantsProvider | None = None,
    plan: str = "free",
    limit: int = 20,
    sleep_fn: Callable[[float], None] = time.sleep,
) -> dict[str, Any]:
    output = root / "web" / "data" / "stock-details"
    securities = selected_securities(root, limit)
    generated_at = dt.datetime.now(dt.UTC).isoformat()
    provider = provider or StockDetailJQuantsProvider(
        JQuantsConfig(
            api_key=os.getenv("JQUANTS_API_KEY"),
            cache_dir=root / ".cache" / "jquants-stock-details",
            cache_ttl_seconds=86_400,
            allow_empty=True,
        )
    )
    delay = 12.2 if plan.lower() == "free" else 1.1
    updated = 0
    preserved = 0
    errors: list[dict[str, str]] = []
    for index, security in enumerate(securities):
        code = security["code"]
        jq_code = jquants_code(code)
        path = output / f"{code}.json"
        try:
            frame = provider.get_financial_summary(code=jq_code)
            earnings = provider.get_financial_earnings_dates(code=jq_code)
            payload = build_stock_detail_payload(
                security,
                frame,
                earnings,
                plan,
                generated_at,
            )
            write_json(path, payload)
            updated += 1
        except (JQuantsAuthError, JQuantsProviderError, ValueError) as exc:
            preserved += 1
            errors.append({"code": code, "error": type(exc).__name__})
            if not path.exists():
                write_json(
                    path,
                    build_stock_detail_payload(
                        security,
                        pd.DataFrame(),
                        pd.DataFrame(),
                        plan,
                        generated_at,
                    ),
                )
        if delay > 0 and index + 1 < len(securities):
            sleep_fn(delay)
    index_payload = {
        "schema_version": 1,
        "generated_at": generated_at,
        "plan": plan,
        "securities": securities,
        "updated": updated,
        "preserved": preserved,
        "errors": errors,
        "paper_only": True,
    }
    write_json(output / "index.json", index_payload)
    return index_payload


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description="Generate sanitized stock-detail financial summaries")
    parser.add_argument("--root", type=Path, default=Path.cwd())
    parser.add_argument("--plan", default="free")
    parser.add_argument("--limit", type=int, default=20)
    args = parser.parse_args(argv)
    try:
        result = generate_stock_details(args.root, plan=args.plan, limit=args.limit)
    except JQuantsAuthError:
        existing = load_json(
            args.root / "web" / "data" / "stock-details" / "index.json",
            {"securities": []},
        )
        result = {
            "status": "preserved_without_api_key",
            "updated": 0,
            "preserved": len(existing.get("securities", [])),
        }
    print(json.dumps(result, ensure_ascii=False))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
