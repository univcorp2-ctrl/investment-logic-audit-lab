from __future__ import annotations

import argparse
import datetime as dt
import json
import os
import time
import xml.etree.ElementTree as ET
from dataclasses import dataclass
from email.utils import parsedate_to_datetime
from pathlib import Path
from typing import Any, Callable
from urllib.parse import quote_plus

import pandas as pd
import requests

from .providers.jquants import JQuantsConfig, JQuantsProvider, JQuantsProviderError

YAHOO_CHART = (
    "https://query2.finance.yahoo.com/v8/finance/chart/{symbol}"
    "?interval=1d&range=1y&includePrePost=false&events=div%2Csplits"
)
GOOGLE_NEWS = (
    "https://news.google.com/rss/search?q={query}&hl=ja&gl=JP&ceid=JP:ja"
)
USER_AGENT = "ValueScopeSecurityDetail/1.0"


@dataclass(frozen=True)
class DetailBuildConfig:
    max_codes: int = 10
    news_limit: int = 8
    chart_days: int = 260
    request_timeout: float = 15.0
    jquants_interval_seconds: float = 12.2


def _number(value: Any) -> float | None:
    if value is None or value is pd.NA:
        return None
    try:
        parsed = float(value)
    except (TypeError, ValueError):
        return None
    return parsed if pd.notna(parsed) else None


def _safe(value: Any) -> Any:
    if isinstance(value, dict):
        return {str(key): _safe(item) for key, item in value.items()}
    if isinstance(value, (list, tuple)):
        return [_safe(item) for item in value]
    if isinstance(value, (pd.Timestamp, dt.datetime, dt.date)):
        return value.isoformat()
    if isinstance(value, float):
        return None if pd.isna(value) else round(value, 8)
    if value is pd.NA or (not isinstance(value, (str, bytes)) and pd.isna(value)):
        return None
    if hasattr(value, "item"):
        return _safe(value.item())
    return value


def _load(path: Path, default: Any) -> Any:
    if not path.exists():
        return default
    return json.loads(path.read_text(encoding="utf-8"))


def _write(path: Path, payload: Any) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(
        json.dumps(_safe(payload), ensure_ascii=False, indent=2, allow_nan=False) + "\n",
        encoding="utf-8",
    )


def normalize_code(value: Any) -> str:
    code = str(value or "").strip().upper().removesuffix(".T")
    if len(code) == 5 and code.endswith("0"):
        code = code[:-1]
    return code


class RateGate:
    def __init__(self, interval_seconds: float, sleep_fn: Callable[[float], None] = time.sleep) -> None:
        self.interval = max(0.0, interval_seconds)
        self.sleep = sleep_fn
        self.last_call = 0.0

    def wait(self) -> None:
        if self.last_call:
            remaining = self.interval - (time.monotonic() - self.last_call)
            if remaining > 0:
                self.sleep(remaining)
        self.last_call = time.monotonic()


def _frame_records(frame: pd.DataFrame, limit: int = 12) -> list[dict[str, Any]]:
    if frame.empty:
        return []
    clean = frame.copy().tail(limit)
    return [_safe(row) for row in clean.to_dict(orient="records")]


def _find_value(record: dict[str, Any], aliases: tuple[str, ...]) -> Any:
    lowered = {str(key).lower(): value for key, value in record.items()}
    for alias in aliases:
        if alias.lower() in lowered:
            return lowered[alias.lower()]
    return None


def statement_snapshot(record: dict[str, Any]) -> dict[str, Any]:
    aliases = {
        "net_sales": ("net_sales", "NetSales", "Sales"),
        "operating_profit": ("operating_profit", "OperatingProfit", "OP"),
        "ordinary_profit": ("ordinary_profit", "OrdinaryProfit", "OdP"),
        "profit": ("profit", "Profit"),
        "eps": ("eps", "EarningsPerShare", "EPS"),
        "total_assets": ("total_assets", "TotalAssets", "TA"),
        "equity": ("equity", "Equity", "NetAssets", "Eq"),
        "operating_cash_flow": (
            "operating_cash_flow",
            "CashFlowsFromOperatingActivities",
            "CFO",
        ),
        "investing_cash_flow": (
            "investing_cash_flow",
            "CashFlowsFromInvestingActivities",
            "CFI",
        ),
        "financing_cash_flow": (
            "financing_cash_flow",
            "CashFlowsFromFinancingActivities",
            "CFF",
        ),
        "disclosed_date": ("disclosed_date", "DisclosedDate", "DiscDate"),
        "period_end": ("period_end", "CurrentPeriodEndDate", "CurPerEn"),
    }
    return {key: _safe(_find_value(record, names)) for key, names in aliases.items()}


def trend_status(records: list[dict[str, Any]]) -> dict[str, Any]:
    if not records:
        return {"label": "決算データなし", "sales_change_pct": None, "profit_change_pct": None}
    latest = statement_snapshot(records[-1])
    previous = statement_snapshot(records[-2]) if len(records) >= 2 else {}

    def change(key: str) -> float | None:
        current = _number(latest.get(key))
        prior = _number(previous.get(key))
        return None if current is None or prior in {None, 0} else (current / prior - 1) * 100

    sales_change = change("net_sales")
    profit_change = change("operating_profit")
    if sales_change is None or profit_change is None:
        label = "比較データ不足"
    elif sales_change >= 0 and profit_change >= 0:
        label = "増収増益"
    elif sales_change < 0 and profit_change < 0:
        label = "減収減益"
    elif profit_change >= 0:
        label = "減収増益"
    else:
        label = "増収減益"
    return {
        "label": label,
        "sales_change_pct": sales_change,
        "operating_profit_change_pct": profit_change,
    }


def add_moving_averages(rows: list[dict[str, Any]]) -> list[dict[str, Any]]:
    if not rows:
        return []
    frame = pd.DataFrame(rows)
    frame["close"] = pd.to_numeric(frame["close"], errors="coerce")
    frame["sma20"] = frame["close"].rolling(20, min_periods=1).mean()
    frame["sma60"] = frame["close"].rolling(60, min_periods=1).mean()
    return [_safe(row) for row in frame.to_dict(orient="records")]


def yahoo_bars(symbol: str, timeout: float = 15.0) -> list[dict[str, Any]]:
    response = requests.get(
        YAHOO_CHART.format(symbol=symbol),
        timeout=timeout,
        headers={"Accept": "application/json", "User-Agent": USER_AGENT},
    )
    response.raise_for_status()
    result = (response.json().get("chart", {}).get("result") or [None])[0]
    if not isinstance(result, dict):
        return []
    timestamps = result.get("timestamp") or []
    quote = ((result.get("indicators") or {}).get("quote") or [{}])[0]
    adjusted = ((result.get("indicators") or {}).get("adjclose") or [{}])[0]
    adjusted_close = adjusted.get("adjclose") or []
    rows: list[dict[str, Any]] = []
    for index, timestamp in enumerate(timestamps):
        close = _number(
            adjusted_close[index]
            if index < len(adjusted_close)
            else (quote.get("close") or [None])[index]
        )
        if close is None:
            continue
        rows.append(
            {
                "date": pd.Timestamp(timestamp, unit="s", tz="UTC")
                .tz_convert("Asia/Tokyo")
                .date()
                .isoformat(),
                "open": _number((quote.get("open") or [None] * len(timestamps))[index]),
                "high": _number((quote.get("high") or [None] * len(timestamps))[index]),
                "low": _number((quote.get("low") or [None] * len(timestamps))[index]),
                "close": close,
                "volume": _number((quote.get("volume") or [None] * len(timestamps))[index]),
            }
        )
    return add_moving_averages(rows)


def frame_bars(frame: pd.DataFrame, limit: int) -> list[dict[str, Any]]:
    if frame.empty:
        return []
    rows: list[dict[str, Any]] = []
    for record in frame.tail(limit).to_dict(orient="records"):
        close = _number(record.get("adjusted_close")) or _number(record.get("close"))
        if close is None:
            continue
        rows.append(
            {
                "date": _safe(record.get("date")),
                "open": _number(record.get("adjusted_open")) or _number(record.get("open")),
                "high": _number(record.get("adjusted_high")) or _number(record.get("high")),
                "low": _number(record.get("adjusted_low")) or _number(record.get("low")),
                "close": close,
                "volume": _number(record.get("adjusted_volume")) or _number(record.get("volume")),
            }
        )
    return add_moving_averages(rows)


def fetch_news(company_name: str, code: str, limit: int, timeout: float) -> list[dict[str, Any]]:
    query = quote_plus(f'"{company_name}" OR "{code}" 株 決算')
    response = requests.get(
        GOOGLE_NEWS.format(query=query),
        timeout=timeout,
        headers={"User-Agent": USER_AGENT, "Accept": "application/rss+xml"},
    )
    response.raise_for_status()
    root = ET.fromstring(response.content)
    items: list[dict[str, Any]] = []
    seen: set[str] = set()
    for item in root.findall(".//item"):
        title = (item.findtext("title") or "").strip()
        link = (item.findtext("link") or "").strip()
        if not title or not link or title in seen:
            continue
        seen.add(title)
        source = item.find("source")
        published = item.findtext("pubDate")
        try:
            published_iso = parsedate_to_datetime(published).isoformat() if published else None
        except (TypeError, ValueError):
            published_iso = published
        items.append(
            {
                "title": title,
                "url": link,
                "source": source.text.strip() if source is not None and source.text else "Google News",
                "published_at": published_iso,
                "kind": "third-party-headline",
            }
        )
        if len(items) >= limit:
            break
    return items


def optional_client_frame(provider: JQuantsProvider, names: tuple[str, ...], code: str) -> pd.DataFrame:
    client = getattr(provider, "_client", None)
    for name in names:
        method = getattr(client, name, None)
        if not callable(method):
            continue
        try:
            payload = method(code=code)
        except TypeError:
            payload = method(code)
        return provider._as_frame(payload)  # noqa: SLF001 - internal adapter compatibility
    return pd.DataFrame()


def recommendation_block(
    code: str,
    ranking_row: dict[str, Any],
    decision: dict[str, Any],
) -> dict[str, Any]:
    fundamental = decision.get("fundamental", {})
    technical = decision.get("technical", {})
    action = decision.get("decision", {})
    source_positive = str(ranking_row.get("positive_reasons") or "")
    source_negative = str(ranking_row.get("negative_reasons") or "")
    fundamental_positive = list(fundamental.get("positive_reasons", []))
    fundamental_positive.extend(part.strip() for part in source_positive.split("/") if part.strip())
    fundamental_risks = list(fundamental.get("risk_reasons", []))
    fundamental_risks.extend(part.strip() for part in source_negative.split("/") if part.strip())
    technical_positive = list(technical.get("positive_reasons", []))
    technical_risks = list(technical.get("risk_reasons", []))
    return {
        "code": code,
        "action": action.get("action", "WATCH"),
        "confidence": action.get("confidence"),
        "execution_note": action.get("execution_note"),
        "fundamental": {
            "score": fundamental.get("score") or ranking_row.get("overall_score"),
            "positive_reasons": list(dict.fromkeys(fundamental_positive)),
            "risk_reasons": list(dict.fromkeys(fundamental_risks)),
            "missing": fundamental.get("missing", []),
        },
        "technical": {
            "score": technical.get("score") or ranking_row.get("technical_score"),
            "regime": technical.get("regime"),
            "positive_reasons": list(dict.fromkeys(technical_positive)),
            "risk_reasons": list(dict.fromkeys(technical_risks)),
        },
        "disclaimer": "機械的なデモ判断です。将来の利益を保証しません。",
    }


def build_security_details(
    root: Path,
    provider: JQuantsProvider | None = None,
    config: DetailBuildConfig = DetailBuildConfig(),
    sleep_fn: Callable[[float], None] = time.sleep,
) -> dict[str, Any]:
    web = root / "web"
    ranking = _load(web / "jquants-ranking.json", {"metadata": {}, "rows": []})
    report = _load(web / "data" / "paper-trading" / "latest-report.json", {"decisions": []})
    existing_index = _load(web / "data" / "security-details" / "index.json", {"securities": []})
    decisions = {normalize_code(item.get("code")): item for item in report.get("decisions", [])}
    rows = ranking.get("rows", [])[: config.max_codes]
    if provider is None and os.getenv("JQUANTS_API_KEY"):
        try:
            provider = JQuantsProvider(
                JQuantsConfig(
                    allow_empty=True,
                    cache_dir=root / ".cache" / "security-details",
                    cache_ttl_seconds=21_600,
                )
            )
        except JQuantsProviderError:
            provider = None
    gate = RateGate(config.jquants_interval_seconds, sleep_fn)
    output_dir = web / "data" / "security-details"
    output_dir.mkdir(parents=True, exist_ok=True)
    built: list[dict[str, Any]] = []
    tdnet_enabled = provider is not None
    for ranking_row in rows:
        code = normalize_code(ranking_row.get("code"))
        symbol = f"{code}.T"
        company_name = ranking_row.get("company_name") or code
        errors: list[str] = []
        bars: list[dict[str, Any]] = []
        summaries: list[dict[str, Any]] = []
        statement_details: list[dict[str, Any]] = []
        earnings_dates: list[dict[str, Any]] = []
        disclosures: list[dict[str, Any]] = []
        if provider is not None:
            try:
                gate.wait()
                bars = frame_bars(provider.get_daily_bars(code=code), config.chart_days)
            except JQuantsProviderError as exc:
                errors.append(f"jquants_bars:{type(exc).__name__}")
            try:
                gate.wait()
                summaries = _frame_records(provider.get_financial_summary(code=code), 10)
            except JQuantsProviderError as exc:
                errors.append(f"jquants_summary:{type(exc).__name__}")
            try:
                gate.wait()
                statement_details = _frame_records(
                    optional_client_frame(
                        provider,
                        ("get_fin_details", "get_financial_details"),
                        code,
                    ),
                    4,
                )
            except Exception as exc:  # provider versions differ
                errors.append(f"jquants_details:{type(exc).__name__}")
            try:
                gate.wait()
                earnings_dates = _frame_records(
                    optional_client_frame(
                        provider,
                        ("get_fin_earnings_date", "get_earnings_date"),
                        code,
                    ),
                    6,
                )
            except Exception as exc:
                errors.append(f"jquants_earnings:{type(exc).__name__}")
            if tdnet_enabled:
                try:
                    gate.wait()
                    disclosures = _frame_records(
                        optional_client_frame(
                            provider,
                            ("get_td_list", "get_company_disclosure_list"),
                            code,
                        ),
                        12,
                    )
                except Exception as exc:
                    tdnet_enabled = False
                    errors.append(f"tdnet_unavailable:{type(exc).__name__}")
        if not bars:
            try:
                bars = yahoo_bars(symbol, config.request_timeout)[-config.chart_days :]
            except (requests.RequestException, ValueError, KeyError, ET.ParseError) as exc:
                errors.append(f"public_chart:{type(exc).__name__}")
        try:
            news = fetch_news(
                str(company_name),
                code,
                config.news_limit,
                config.request_timeout,
            )
        except (requests.RequestException, ET.ParseError, ValueError) as exc:
            old = _load(output_dir / f"{code}.json", {})
            news = old.get("news", [])
            errors.append(f"news:{type(exc).__name__}")
        if not summaries:
            summaries = [
                {
                    "disclosed_date": ranking_row.get("latest_disclosure_date"),
                    "operating_margin": ranking_row.get("operating_margin"),
                    "roe": ranking_row.get("roe"),
                    "earnings_yield": ranking_row.get("earnings_yield"),
                    "fcf_yield": ranking_row.get("fcf_yield"),
                    "source": "sanitized-ranking-fallback",
                }
            ]
        detail = {
            "schema_version": 1,
            "generated_at": dt.datetime.now(dt.timezone.utc).isoformat(),
            "code": code,
            "symbol": symbol,
            "company_name": company_name,
            "market": ranking_row.get("market"),
            "sector": ranking_row.get("sector"),
            "rank": ranking_row.get("rank"),
            "scores": {
                key: ranking_row.get(key)
                for key in (
                    "overall_score",
                    "value_score",
                    "quality_score",
                    "growth_stability_score",
                    "technical_score",
                    "liquidity_score",
                    "value_trap_risk",
                    "data_completeness",
                )
            },
            "recommendation": recommendation_block(
                code,
                ranking_row,
                decisions.get(code, {}),
            ),
            "financials": {
                "source": "J-Quants / sanitized fallback",
                "effective_data_cutoff": ranking.get("metadata", {}).get(
                    "effective_data_cutoff"
                ),
                "summary_history": summaries,
                "latest_snapshot": statement_snapshot(summaries[-1]),
                "trend": trend_status(summaries),
                "statement_details": statement_details,
                "earnings_dates": earnings_dates,
            },
            "disclosures": disclosures,
            "news": news,
            "chart": {
                "source": "J-Quants daily OHLC or Yahoo public fallback",
                "interval": "1d",
                "bars": bars,
                "indicators": ["SMA20", "SMA60"],
            },
            "availability": {
                "jquants": provider is not None,
                "tdnet_addon": bool(disclosures),
                "news_headlines": bool(news),
                "chart": bool(bars),
            },
            "errors": errors,
            "paper_only": True,
        }
        _write(output_dir / f"{code}.json", detail)
        built.append(
            {
                "code": code,
                "company_name": company_name,
                "path": f"./data/security-details/{code}.json",
                "generated_at": detail["generated_at"],
                "chart_points": len(bars),
                "news_count": len(news),
                "disclosure_count": len(disclosures),
            }
        )
    index_payload = {
        "schema_version": 1,
        "generated_at": dt.datetime.now(dt.timezone.utc).isoformat(),
        "securities": built,
        "previous_count": len(existing_index.get("securities", [])),
        "paper_only": True,
    }
    _write(output_dir / "index.json", index_payload)
    return index_payload


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description="Build per-security analysis JSON")
    parser.add_argument("--root", type=Path, default=Path.cwd())
    parser.add_argument("--max-codes", type=int, default=10)
    args = parser.parse_args(argv)
    result = build_security_details(
        args.root,
        config=DetailBuildConfig(max_codes=args.max_codes),
    )
    print(json.dumps(result, ensure_ascii=False))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
