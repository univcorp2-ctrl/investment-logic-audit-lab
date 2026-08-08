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
GOOGLE_NEWS = "https://news.google.com/rss/search?q={query}&hl=ja&gl=JP&ceid=JP:ja"
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
    def __init__(
        self,
        interval_seconds: float,
        sleep_fn: Callable[[float], None] = time.sleep,
    ) -> None:
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
        return {
            "label": "決算データなし",
            "sales_change_pct": None,
            "profit_change_pct": None,
        }
    latest = statement_snapshot(records[-1])
    previous = statement_snapshot(records[-2]) if len(records) >= 2 else {}

    def change(key: str) -> float | None:
        current = _number(latest.get(key))
        prior = _number(previous.get(key))
        if current is None or prior in {None, 0}:
            return None
        return round((current / prior - 1) * 100, 8)

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
                "volume": _number(record.get("adjusted_volume"))
                or _number(record.get("volume")),
            }
        )
    return add_moving_averages(rows)


def fetch_news(
    company_name: str,
    code: str,
    limit: int,
    timeout: float,
) -> list[dict[str, Any]]:
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
        published = item.findtext("pubDate")
        source_node = item.find("source")
        source = source_node.text.strip() if source_node is not None and source_node.text else None
        published_at: str | None = None
        if published:
            try:
                published_at = parsedate_to_datetime(published).isoformat()
            except (TypeError, ValueError):
                published_at = published
        items.append(
            {
                "title": title,
                "source": source,
                "published_at": published_at,
                "link": link,
                "official_disclosure": False,
            }
        )
        if len(items) >= limit:
            break
    return items


def _security_codes(root: Path, limit: int) -> list[dict[str, Any]]:
    demo = _load(root / "web" / "demo-portfolio.json", {"positions": []})
    ranking = _load(root / "web" / "jquants-ranking.json", {"rows": []})
    items: list[dict[str, Any]] = []
    seen: set[str] = set()
    for record in [*demo.get("positions", []), *ranking.get("rows", [])]:
        code = normalize_code(record.get("code") or record.get("symbol"))
        if not code or code in seen:
            continue
        seen.add(code)
        items.append(
            {
                "code": code,
                "symbol": record.get("symbol") or f"{code}.T",
                "company_name": record.get("company_name") or record.get("name") or code,
            }
        )
        if len(items) >= limit:
            break
    return items


def generate_security_details(
    root: Path,
    provider: JQuantsProvider | None = None,
    config: DetailBuildConfig = DetailBuildConfig(),
    fetch_news_fn: Callable[[str, str, int, float], list[dict[str, Any]]] = fetch_news,
    yahoo_bars_fn: Callable[[str, float], list[dict[str, Any]]] = yahoo_bars,
) -> dict[str, Any]:
    output = root / "web" / "data" / "security-details"
    output.mkdir(parents=True, exist_ok=True)
    provider = provider or JQuantsProvider(
        JQuantsConfig(
            api_key=os.getenv("JQUANTS_API_KEY"),
            cache_dir=root / ".cache" / "security-details",
            cache_ttl_seconds=86_400,
            allow_empty=True,
        )
    )
    gate = RateGate(config.jquants_interval_seconds)
    details: list[dict[str, Any]] = []
    for security in _security_codes(root, config.max_codes):
        code = security["code"]
        symbol = security["symbol"]
        financials = pd.DataFrame()
        try:
            gate.wait()
            financials = provider.get_financial_summary(code=f"{code}0")
        except JQuantsProviderError:
            pass
        statements = _frame_records(financials, 12)
        try:
            chart = yahoo_bars_fn(symbol, config.request_timeout)
        except requests.RequestException:
            chart = []
        try:
            news = fetch_news_fn(
                security["company_name"],
                code,
                config.news_limit,
                config.request_timeout,
            )
        except (requests.RequestException, ET.ParseError):
            news = []
        payload = {
            **security,
            "generated_at": dt.datetime.now(dt.UTC).isoformat(),
            "financial_summaries": statements,
            "financial_trend": trend_status(statements),
            "chart": chart[-config.chart_days :],
            "general_news": news,
            "official_disclosure_status": "tdnet_addon_not_configured",
            "official_disclosures": [],
            "paper_only": True,
        }
        _write(output / f"{code}.json", payload)
        details.append(
            {
                "code": code,
                "company_name": security["company_name"],
                "financial_periods": len(statements),
                "chart_rows": len(chart),
                "news_items": len(news),
            }
        )
    index = {
        "schema_version": 1,
        "generated_at": dt.datetime.now(dt.UTC).isoformat(),
        "securities": details,
        "paper_only": True,
    }
    _write(output / "index.json", index)
    return index


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description="Generate rich stock research data")
    parser.add_argument("--root", type=Path, default=Path.cwd())
    args = parser.parse_args(argv)
    result = generate_security_details(args.root)
    print(json.dumps(result, ensure_ascii=False))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
