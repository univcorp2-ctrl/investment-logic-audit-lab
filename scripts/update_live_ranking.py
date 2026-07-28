from __future__ import annotations

import argparse
import json
import logging
import time
from concurrent.futures import ThreadPoolExecutor, as_completed
from datetime import UTC, datetime
from pathlib import Path
from typing import Any

import numpy as np
import pandas as pd
import yfinance as yf

from investment_audit.screening import ValueScreenConfig, screen_value_stocks
from investment_audit.technical import analyze_technical

LOGGER = logging.getLogger("live-ranking")
ROOT = Path(__file__).resolve().parents[1]
DEFAULT_UNIVERSE = ROOT / "data" / "japan-core-universe.csv"
DEFAULT_JSON = ROOT / "web" / "live-ranking.json"
DEFAULT_CSV = ROOT / "web" / "live-ranking.csv"


def _number(mapping: dict[str, Any], *keys: str) -> float | None:
    for key in keys:
        value = mapping.get(key)
        try:
            number = float(value)
        except (TypeError, ValueError):
            continue
        if np.isfinite(number):
            return number
    return None


def _safe_divide(numerator: float | None, denominator: float | None) -> float | None:
    if numerator is None or denominator is None or abs(denominator) < 1e-12:
        return None
    value = numerator / denominator
    return float(value) if np.isfinite(value) else None


def build_fundamental_row(info: dict[str, Any], metadata: dict[str, str]) -> dict[str, Any]:
    market_cap = _number(info, "marketCap")
    enterprise_value = _number(info, "enterpriseValue")
    net_income = _number(info, "netIncomeToCommon", "netIncome")
    free_cash_flow = _number(info, "freeCashflow")
    ebitda = _number(info, "ebitda")
    revenue = _number(info, "totalRevenue")
    gross_profit = _number(info, "grossProfits")
    operating_cash_flow = _number(info, "operatingCashflow")
    total_assets = _number(info, "totalAssets")
    total_debt = _number(info, "totalDebt")
    total_cash = _number(info, "totalCash")
    shares = _number(info, "sharesOutstanding", "impliedSharesOutstanding")
    book_value_per_share = _number(info, "bookValue")
    book_value = (
        book_value_per_share * shares
        if book_value_per_share is not None and shares is not None
        else None
    )
    operating_margin = _number(info, "operatingMargins")
    roe = _number(info, "returnOnEquity")
    price_to_book = _number(info, "priceToBook")
    trailing_pe = _number(info, "trailingPE")
    enterprise_to_ebitda = _number(info, "enterpriseToEbitda")
    dividend_yield = _number(info, "dividendYield")
    revenue_growth = _number(info, "revenueGrowth")
    earnings_growth = _number(info, "earningsGrowth", "earningsQuarterlyGrowth")
    operating_income = (
        operating_margin * revenue
        if operating_margin is not None and revenue is not None
        else None
    )
    net_cash = (
        total_cash - total_debt
        if total_cash is not None and total_debt is not None
        else None
    )
    return {
        **metadata,
        "market_cap": market_cap,
        "enterprise_value": enterprise_value,
        "net_income": net_income,
        "book_value": book_value,
        "free_cash_flow": free_cash_flow,
        "ebitda": ebitda,
        "revenue": revenue,
        "gross_profit": gross_profit,
        "operating_income": operating_income,
        "operating_cash_flow": operating_cash_flow,
        "total_assets": total_assets,
        "total_debt": total_debt,
        "net_cash": net_cash,
        "earnings_yield": _safe_divide(1.0, trailing_pe),
        "book_to_market": _safe_divide(1.0, price_to_book),
        "fcf_yield": _safe_divide(free_cash_flow, market_cap),
        "ev_ebitda": enterprise_to_ebitda,
        "dividend_yield": dividend_yield,
        "net_cash_to_market_cap": _safe_divide(net_cash, market_cap),
        "roe": roe,
        "gross_profitability": _safe_divide(gross_profit, total_assets),
        "operating_margin": operating_margin,
        "fcf_conversion": _safe_divide(
            free_cash_flow,
            abs(net_income) if net_income is not None else None,
        ),
        "debt_to_ebitda": _safe_divide(total_debt, ebitda),
        "accrual_quality": _safe_divide(
            (
                operating_cash_flow - net_income
                if operating_cash_flow is not None and net_income is not None
                else None
            ),
            total_assets,
        ),
        "revenue_growth": revenue_growth,
        "eps_growth": earnings_growth,
        "negative_earnings_years": 1 if net_income is not None and net_income < 0 else 0,
        "negative_fcf_years": 1 if free_cash_flow is not None and free_cash_flow < 0 else 0,
    }


def _history_metrics(history: pd.DataFrame) -> dict[str, Any]:
    if history.empty or "Close" not in history.columns:
        return {}
    clean = history.dropna(subset=["Close"]).copy()
    if len(clean) < 60:
        return {}
    technical = analyze_technical(clean)
    usable = technical.dropna(subset=["decision_score"])
    latest = usable.iloc[-1] if not usable.empty else technical.iloc[-1]
    close = float(clean["Close"].iloc[-1])
    change_20d = (
        float(close / clean["Close"].iloc[-21] - 1.0)
        if len(clean) >= 21 and clean["Close"].iloc[-21] > 0
        else None
    )
    volume = pd.to_numeric(clean.get("Volume"), errors="coerce")
    average_daily_value = (
        float((clean["Close"] * volume).tail(20).mean())
        if volume is not None and volume.notna().any()
        else None
    )
    market_date = pd.Timestamp(clean.index[-1]).date().isoformat()
    return {
        "last_price": close,
        "change_20d": change_20d,
        "average_daily_value": average_daily_value,
        "technical_score": float(latest.get("decision_score", 50.0)),
        "risk_score": float(latest.get("risk_score", 50.0)),
        "position_52w": (
            float(latest["position_52w"])
            if pd.notna(latest.get("position_52w"))
            else None
        ),
        "market_date": market_date,
    }


def fetch_symbol(row: dict[str, str], retries: int = 3) -> dict[str, Any] | None:
    ticker_symbol = row["ticker"]
    for attempt in range(retries):
        try:
            ticker = yf.Ticker(ticker_symbol)
            info = ticker.get_info() or {}
            history = ticker.history(period="2y", interval="1d", auto_adjust=False)
            metadata = {
                "ticker": ticker_symbol,
                "symbol": str(row["symbol"]),
                "company_name": row["company_name"],
                "sector": row["sector"],
            }
            output = build_fundamental_row(info, metadata)
            output.update(_history_metrics(history))
            if output.get("market_cap") is None or output.get("last_price") is None:
                raise ValueError("market cap or price unavailable")
            return output
        except Exception as exc:  # network/provider variability
            if attempt + 1 >= retries:
                LOGGER.warning("%s failed: %s", ticker_symbol, exc)
                return None
            time.sleep(2**attempt)
    return None


def _json_value(value: Any) -> Any:
    if isinstance(value, (np.integer,)):
        return int(value)
    if isinstance(value, (np.floating,)):
        return None if not np.isfinite(value) else float(value)
    if isinstance(value, pd.Timestamp):
        return value.isoformat()
    if pd.isna(value):
        return None
    return value


def generate_live_ranking(
    universe_path: Path = DEFAULT_UNIVERSE,
    output_json: Path = DEFAULT_JSON,
    output_csv: Path = DEFAULT_CSV,
    max_workers: int = 4,
) -> dict[str, Any]:
    universe = pd.read_csv(universe_path, dtype=str).fillna("")
    required = {"ticker", "symbol", "company_name", "sector"}
    if not required.issubset(universe.columns):
        raise ValueError(f"universe requires columns: {sorted(required)}")

    rows: list[dict[str, Any]] = []
    with ThreadPoolExecutor(max_workers=max_workers) as executor:
        futures = [executor.submit(fetch_symbol, row) for row in universe.to_dict("records")]
        for future in as_completed(futures):
            result = future.result()
            if result is not None:
                rows.append(result)
    if len(rows) < 8:
        raise RuntimeError(f"only {len(rows)} symbols were fetched; refusing to publish")

    fundamentals = pd.DataFrame(rows).set_index("symbol")
    technical = fundamentals[["technical_score", "risk_score", "average_daily_value"]].copy()
    ranking = screen_value_stocks(
        fundamentals,
        technical_scores=technical,
        config=ValueScreenConfig(
            minimum_quality=35.0,
            maximum_value_trap_risk=70.0,
            minimum_data_completeness=35.0,
            minimum_liquidity_score=10.0,
        ),
    )
    ranking = fundamentals.join(ranking, rsuffix="_score_output")
    ranking = ranking.loc[:, ~ranking.columns.duplicated()]
    ranking = ranking.sort_values(["eligible", "overall_score"], ascending=[False, False])
    ranking["rank"] = np.arange(1, len(ranking) + 1)
    ranking["reasons"] = ranking["reasons"].map(
        lambda value: json.loads(value) if isinstance(value, str) else []
    )
    ranking["filter_reasons"] = ranking["filter_reasons"].map(
        lambda value: json.loads(value) if isinstance(value, str) else []
    )

    market_dates = [value for value in ranking["market_date"].dropna().astype(str) if value]
    payload = {
        "generated_at": datetime.now(UTC).isoformat(),
        "market_date": max(market_dates) if market_dates else None,
        "source": "Yahoo Finance via yfinance（調査・参考用）",
        "universe_size": int(len(universe)),
        "scored_count": int(len(ranking)),
        "eligible_count": int(ranking["eligible"].fillna(False).sum()),
        "rows": [
            {key: _json_value(value) for key, value in record.items()}
            for record in ranking.reset_index().to_dict("records")
        ],
    }
    output_json.parent.mkdir(parents=True, exist_ok=True)
    output_json.write_text(
        json.dumps(payload, ensure_ascii=False, indent=2, allow_nan=False),
        encoding="utf-8",
    )
    csv_frame = ranking.copy()
    csv_frame["reasons"] = csv_frame["reasons"].map(
        lambda values: " / ".join(values) if isinstance(values, list) else ""
    )
    csv_frame["filter_reasons"] = csv_frame["filter_reasons"].map(
        lambda values: " / ".join(values) if isinstance(values, list) else ""
    )
    csv_frame.to_csv(output_csv, encoding="utf-8-sig")
    return payload


def main() -> int:
    parser = argparse.ArgumentParser(description="Generate the live Japanese value-stock ranking")
    parser.add_argument("--universe", type=Path, default=DEFAULT_UNIVERSE)
    parser.add_argument("--json", type=Path, default=DEFAULT_JSON)
    parser.add_argument("--csv", type=Path, default=DEFAULT_CSV)
    parser.add_argument("--workers", type=int, default=4)
    args = parser.parse_args()
    logging.basicConfig(level=logging.INFO, format="%(levelname)s %(message)s")
    payload = generate_live_ranking(args.universe, args.json, args.csv, args.workers)
    LOGGER.info(
        "published %s rows (%s eligible) for market date %s",
        payload["scored_count"],
        payload["eligible_count"],
        payload["market_date"],
    )
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
