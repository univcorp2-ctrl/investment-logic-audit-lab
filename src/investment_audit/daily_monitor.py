from __future__ import annotations

import argparse
import datetime as dt
import json
import math
from dataclasses import asdict, dataclass
from pathlib import Path
from typing import Any, Iterable
from zoneinfo import ZoneInfo

import numpy as np
import pandas as pd
import requests

TOKYO = ZoneInfo("Asia/Tokyo")
QUOTE_API = "https://valuescope-japan.pages.dev/api/quotes?compact=1"
CHART_URL = (
    "https://query2.finance.yahoo.com/v8/finance/chart/{symbol}"
    "?interval=1d&range=1y&includePrePost=false&events=div%2Csplits"
)
DISCLAIMER = (
    "この処理は外部注文を送信しないデモ・シミュレーションです。"
    "表示された判断や損益は将来の利益を保証しません。"
)


@dataclass(frozen=True)
class StrategyConfig:
    quantity: int = 100
    buy_fundamental: float = 58.0
    buy_quality: float = 55.0
    buy_technical: float = 60.0
    buy_completeness: float = 35.0
    buy_max_trap: float = 50.0
    sell_fundamental: float = 40.0
    sell_technical: float = 35.0
    sell_trap: float = 70.0
    stop_loss_pct: float = -8.0
    max_drawdown_pct: float = -12.0
    max_quote_difference_pct: float = 3.0
    max_quote_age_days: int = 4


@dataclass(frozen=True)
class TechnicalSnapshot:
    price: float | None
    price_date: str | None
    sma20: float | None
    sma60: float | None
    price_vs_sma20_pct: float | None
    price_vs_sma60_pct: float | None
    rsi14: float | None
    momentum20_pct: float | None
    momentum60_pct: float | None
    volatility20_pct: float | None
    drawdown20_pct: float | None
    average_volume20: float | None
    trading_value20: float | None
    score: float | None
    regime: str
    positive_reasons: tuple[str, ...]
    risk_reasons: tuple[str, ...]
    missing: tuple[str, ...]


@dataclass(frozen=True)
class Decision:
    action: str
    confidence: float
    reasons: tuple[str, ...]
    risks: tuple[str, ...]
    execution_allowed: bool
    execution_note: str


def _number(value: Any) -> float | None:
    if value is None or value is pd.NA:
        return None
    try:
        parsed = float(value)
    except (TypeError, ValueError):
        return None
    return parsed if math.isfinite(parsed) else None


def _round(value: float | None, digits: int = 4) -> float | None:
    return None if value is None else round(float(value), digits)


def normalize_code(value: Any) -> str:
    code = str(value or "").strip().upper().removesuffix(".T")
    if len(code) == 5 and code.endswith("0"):
        code = code[:-1]
    return code


def symbol_for_code(value: Any) -> str:
    return f"{normalize_code(value)}.T"


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


def fetch_json(url: str, timeout: float = 30.0) -> dict[str, Any]:
    response = requests.get(
        url,
        timeout=timeout,
        headers={"Accept": "application/json", "User-Agent": "ValueScopeMonitor/1.0"},
    )
    response.raise_for_status()
    payload = response.json()
    if not isinstance(payload, dict):
        raise ValueError(f"Expected JSON object from {url}")
    return payload


def fetch_chart(symbol: str) -> pd.DataFrame:
    payload = fetch_json(CHART_URL.format(symbol=symbol))
    result = (payload.get("chart", {}).get("result") or [None])[0]
    if not isinstance(result, dict):
        return pd.DataFrame(columns=["close", "volume"])
    timestamps = result.get("timestamp") or []
    quote = ((result.get("indicators") or {}).get("quote") or [{}])[0]
    adjusted = ((result.get("indicators") or {}).get("adjclose") or [{}])[0]
    close = adjusted.get("adjclose") or quote.get("close") or []
    volume = quote.get("volume") or []
    rows: list[dict[str, Any]] = []
    for index, timestamp in enumerate(timestamps):
        price = _number(close[index] if index < len(close) else None)
        if price is None:
            continue
        rows.append(
            {
                "date": pd.Timestamp(timestamp, unit="s", tz="UTC").tz_convert("Asia/Tokyo"),
                "close": price,
                "volume": _number(volume[index] if index < len(volume) else None),
            }
        )
    if not rows:
        return pd.DataFrame(columns=["close", "volume"])
    return pd.DataFrame(rows).set_index("date").sort_index()


def compute_rsi(prices: pd.Series, window: int = 14) -> float | None:
    if len(prices) <= window:
        return None
    delta = prices.diff()
    gains = delta.clip(lower=0).rolling(window).mean().iloc[-1]
    losses = -delta.clip(upper=0).rolling(window).mean().iloc[-1]
    if pd.isna(gains) or pd.isna(losses):
        return None
    if losses == 0:
        return 100.0
    return float(100 - 100 / (1 + gains / losses))


def technical_snapshot(history: pd.DataFrame, live_price: float | None = None) -> TechnicalSnapshot:
    if history.empty or "close" not in history:
        return TechnicalSnapshot(
            None,
            None,
            None,
            None,
            None,
            None,
            None,
            None,
            None,
            None,
            None,
            None,
            None,
            None,
            "NO_DATA",
            (),
            (),
            ("price_history",),
        )
    closes = pd.to_numeric(history["close"], errors="coerce").dropna()
    if closes.empty:
        return technical_snapshot(pd.DataFrame())
    price = live_price if live_price is not None else float(closes.iloc[-1])
    sma20 = float(closes.tail(20).mean()) if len(closes) >= 20 else None
    sma60 = float(closes.tail(60).mean()) if len(closes) >= 60 else None
    momentum20 = (price / float(closes.iloc[-21]) - 1) * 100 if len(closes) >= 21 else None
    momentum60 = (price / float(closes.iloc[-61]) - 1) * 100 if len(closes) >= 61 else None
    returns = closes.pct_change().dropna().tail(20)
    volatility20 = float(returns.std(ddof=0) * np.sqrt(252) * 100) if len(returns) >= 10 else None
    peak20 = float(closes.tail(20).max()) if len(closes) >= 2 else None
    drawdown20 = (price / peak20 - 1) * 100 if peak20 and peak20 > 0 else None
    rsi14 = compute_rsi(closes)
    volume20 = None
    trading_value20 = None
    if "volume" in history:
        volumes = pd.to_numeric(history["volume"], errors="coerce")
        if volumes.tail(20).notna().any():
            volume20 = float(volumes.tail(20).mean())
            trading_value20 = float((closes.reindex(volumes.index) * volumes).tail(20).mean())

    score = 50.0
    positive: list[str] = []
    risks: list[str] = []
    missing: list[str] = []
    if sma20 is None:
        missing.append("sma20")
    elif price >= sma20:
        score += 13
        positive.append("株価が20日移動平均を上回る")
    else:
        score -= 13
        risks.append("株価が20日移動平均を下回る")
    if sma20 is None or sma60 is None:
        missing.append("sma60")
    elif sma20 >= sma60:
        score += 15
        positive.append("20日線が60日線を上回る上昇基調")
    else:
        score -= 15
        risks.append("20日線が60日線を下回る下降基調")
    for label, value, weight in (
        ("20日モメンタム", momentum20, 10),
        ("60日モメンタム", momentum60, 10),
    ):
        if value is None:
            missing.append(label)
        elif value > 0:
            score += weight
            positive.append(f"{label}がプラス")
        else:
            score -= weight
            risks.append(f"{label}がマイナス")
    if rsi14 is None:
        missing.append("rsi14")
    elif 45 <= rsi14 <= 70:
        score += 8
        positive.append("RSIが過熱しすぎない強気圏")
    elif rsi14 >= 80:
        score -= 8
        risks.append("RSIが過熱圏")
    elif rsi14 <= 35:
        score -= 8
        risks.append("RSIが弱気圏")
    if drawdown20 is not None and drawdown20 <= -12:
        score -= 10
        risks.append("20日高値からの下落が大きい")
    if volatility20 is not None and volatility20 >= 70:
        score -= 7
        risks.append("短期ボラティリティが高い")
    score = max(0.0, min(100.0, score))
    regime = "UPTREND" if score >= 65 else "DOWNTREND" if score <= 35 else "NEUTRAL"
    return TechnicalSnapshot(
        _round(price),
        history.index[-1].date().isoformat(),
        _round(sma20),
        _round(sma60),
        _round((price / sma20 - 1) * 100 if sma20 else None),
        _round((price / sma60 - 1) * 100 if sma60 else None),
        _round(rsi14),
        _round(momentum20),
        _round(momentum60),
        _round(volatility20),
        _round(drawdown20),
        _round(volume20),
        _round(trading_value20),
        _round(score),
        regime,
        tuple(positive),
        tuple(risks),
        tuple(dict.fromkeys(missing)),
    )


def fundamental_snapshot(row: dict[str, Any] | None) -> dict[str, Any]:
    fields = {
        "value_score": _number((row or {}).get("value_score")),
        "quality_score": _number((row or {}).get("quality_score")),
        "growth_stability_score": _number((row or {}).get("growth_stability_score")),
        "value_trap_risk": _number((row or {}).get("value_trap_risk")),
        "data_completeness": _number((row or {}).get("data_completeness")),
        "earnings_yield": _number((row or {}).get("earnings_yield")),
        "book_to_market": _number((row or {}).get("book_to_market")),
        "fcf_yield": _number((row or {}).get("fcf_yield")),
        "roe": _number((row or {}).get("roe")),
        "operating_margin": _number((row or {}).get("operating_margin")),
        "latest_disclosure_date": (row or {}).get("latest_disclosure_date"),
    }
    components = [
        (fields["value_score"], 0.35),
        (fields["quality_score"], 0.30),
        (fields["growth_stability_score"], 0.20),
        (
            None if fields["value_trap_risk"] is None else 100 - fields["value_trap_risk"],
            0.15,
        ),
    ]
    available = [(value, weight) for value, weight in components if value is not None]
    score = (
        sum(value * weight for value, weight in available) / sum(weight for _, weight in available)
        if available
        else None
    )
    missing = [name for name, value in fields.items() if value is None and name != "latest_disclosure_date"]
    positive: list[str] = []
    risks: list[str] = []
    if fields["value_score"] is not None and fields["value_score"] >= 65:
        positive.append("割安性スコアが高い")
    if fields["quality_score"] is not None and fields["quality_score"] >= 65:
        positive.append("企業品質スコアが高い")
    if fields["growth_stability_score"] is not None and fields["growth_stability_score"] >= 65:
        positive.append("成長・安定性が良好")
    if fields["value_trap_risk"] is not None and fields["value_trap_risk"] >= 60:
        risks.append("バリュートラップリスクが高い")
    if fields["data_completeness"] is None or fields["data_completeness"] < 45:
        risks.append("データ充足率が低い")
    return {
        **{name: _round(value) if isinstance(value, float) else value for name, value in fields.items()},
        "score": _round(score),
        "positive_reasons": positive,
        "risk_reasons": risks,
        "missing": missing,
        "source_positive_reasons": (row or {}).get("positive_reasons", ""),
        "source_negative_reasons": (row or {}).get("negative_reasons", ""),
    }


def validate_quote(
    quote: dict[str, Any] | None,
    trading_date: dt.date,
    config: StrategyConfig,
) -> tuple[float | None, bool, list[str]]:
    if not quote:
        return None, False, ["現在値を取得できない"]
    price = _number(quote.get("current_price"))
    risks: list[str] = []
    if price is None or price <= 0:
        risks.append("現在値が不正")
    if quote.get("usable") is False:
        risks.append("価格ソースの安全判定がfalse")
    difference = _number(quote.get("max_difference_pct"))
    if difference is not None and difference > config.max_quote_difference_pct:
        risks.append("価格ソース間の差が許容値を超える")
    quote_time = quote.get("quote_time")
    if quote_time:
        try:
            quote_date = pd.Timestamp(quote_time).tz_convert("Asia/Tokyo").date()
            if (trading_date - quote_date).days > config.max_quote_age_days:
                risks.append("現在値が古い")
        except (TypeError, ValueError):
            risks.append("現在値時刻を解釈できない")
    else:
        risks.append("現在値時刻がない")
    return price, not risks, risks


def make_decision(
    fundamental: dict[str, Any],
    technical: TechnicalSnapshot,
    holding: dict[str, Any] | None,
    quote_valid: bool,
    quote_risks: Iterable[str],
    config: StrategyConfig,
) -> Decision:
    reasons = list(fundamental.get("positive_reasons", [])) + list(technical.positive_reasons)
    risks = list(fundamental.get("risk_reasons", [])) + list(technical.risk_reasons)
    risks.extend(quote_risks)
    fscore = _number(fundamental.get("score"))
    quality = _number(fundamental.get("quality_score"))
    completeness = _number(fundamental.get("data_completeness"))
    trap = _number(fundamental.get("value_trap_risk"))
    tscore = technical.score
    held = bool(holding and _number(holding.get("quantity")) and holding.get("quantity", 0) > 0)
    if fscore is None or tscore is None:
        return Decision("NO_DATA", 0.0, tuple(reasons), tuple(risks), False, "必要指標が不足")
    entry = _number((holding or {}).get("avg_cost") or (holding or {}).get("entry_price"))
    current = technical.price
    return_pct = ((current / entry - 1) * 100) if held and entry and current else None
    confidence = min(
        100.0,
        max(0.0, ((completeness or 0) * 0.55 + fscore * 0.25 + tscore * 0.20)),
    )
    sell = held and (
        fscore < config.sell_fundamental
        or (trap is not None and trap >= config.sell_trap)
        or tscore <= config.sell_technical
        or (return_pct is not None and return_pct <= config.stop_loss_pct)
        or (
            technical.drawdown20_pct is not None
            and technical.drawdown20_pct <= config.max_drawdown_pct
        )
    )
    buy = (not held) and all(
        (
            fscore >= config.buy_fundamental,
            quality is not None and quality >= config.buy_quality,
            completeness is not None and completeness >= config.buy_completeness,
            trap is not None and trap <= config.buy_max_trap,
            tscore >= config.buy_technical,
        )
    )
    action = "SIM_SELL" if sell else "SIM_BUY" if buy else "SIM_HOLD" if held else "WATCH"
    allowed = quote_valid and action in {"SIM_BUY", "SIM_SELL"}
    note = "デモ台帳内でのみ実行可能" if allowed else "監視のみ" if action not in {"SIM_BUY", "SIM_SELL"} else "価格検証により停止"
    return Decision(action, round(confidence, 2), tuple(reasons), tuple(risks), allowed, note)


def seed_portfolio(demo: dict[str, Any]) -> dict[str, Any]:
    positions = []
    for row in demo.get("positions", []):
        positions.append(
            {
                "symbol": row.get("symbol") or symbol_for_code(row.get("code")),
                "code": normalize_code(row.get("code")),
                "company_name": row.get("company_name"),
                "quantity": int(row.get("quantity", 0)),
                "avg_cost": _number(row.get("entry_price")) or 0.0,
                "opened_at": row.get("entry_time") or demo.get("opened_at"),
            }
        )
    return {
        "schema_version": 1,
        "portfolio_id": demo.get("portfolio_id", "valuescope-paper"),
        "cash": 0.0,
        "realized_pnl": 0.0,
        "positions": positions,
        "seed_cost_basis": sum(
            (_number(position.get("avg_cost")) or 0) * int(position.get("quantity", 0))
            for position in positions
        ),
        "paper_only": True,
    }


def _position_map(portfolio: dict[str, Any]) -> dict[str, dict[str, Any]]:
    return {str(position["symbol"]): position for position in portfolio.get("positions", [])}


def portfolio_summary(
    portfolio: dict[str, Any],
    decisions: list[dict[str, Any]],
    history: list[dict[str, Any]],
) -> dict[str, Any]:
    decision_map = {row["symbol"]: row for row in decisions}
    market_value = 0.0
    unrealized = 0.0
    valued = 0
    for position in portfolio.get("positions", []):
        row = decision_map.get(position["symbol"], {})
        price = _number(row.get("technical", {}).get("price"))
        if price is None or not row.get("quote", {}).get("valid"):
            price = _number(position.get("avg_cost")) or 0.0
        quantity = int(position.get("quantity", 0))
        cost = (_number(position.get("avg_cost")) or 0.0) * quantity
        value = price * quantity
        market_value += value
        unrealized += value - cost
        valued += 1
    cash = _number(portfolio.get("cash")) or 0.0
    equity = cash + market_value
    realized = _number(portfolio.get("realized_pnl")) or 0.0
    seed = _number(portfolio.get("seed_cost_basis")) or equity or 1.0
    prior_equity = _number(history[-1].get("equity")) if history else None
    daily_return = (equity / prior_equity - 1) * 100 if prior_equity else 0.0
    peaks = [float(item["equity"]) for item in history if _number(item.get("equity")) is not None]
    peaks.append(equity)
    running_peak = -math.inf
    max_drawdown = 0.0
    for value in peaks:
        running_peak = max(running_peak, value)
        if running_peak > 0:
            max_drawdown = min(max_drawdown, (value / running_peak - 1) * 100)
    return {
        "cash": round(cash, 2),
        "market_value": round(market_value, 2),
        "equity": round(equity, 2),
        "realized_pnl": round(realized, 2),
        "unrealized_pnl": round(unrealized, 2),
        "total_pnl": round(realized + unrealized, 2),
        "cumulative_return_pct": round((equity / seed - 1) * 100, 4),
        "daily_return_pct": round(daily_return, 4),
        "max_drawdown_pct": round(max_drawdown, 4),
        "position_count": valued,
    }


def run_monitor(
    root: Path,
    execute_simulation: bool = False,
    trading_date: dt.date | None = None,
    quote_payload: dict[str, Any] | None = None,
    chart_loader: Any = fetch_chart,
    config: StrategyConfig = StrategyConfig(),
) -> dict[str, Any]:
    trading_date = trading_date or dt.datetime.now(TOKYO).date()
    web = root / "web"
    data_dir = web / "data" / "paper-trading"
    ranking = load_json(web / "jquants-ranking.json", {"metadata": {}, "rows": []})
    rows = {symbol_for_code(row.get("code")): row for row in ranking.get("rows", [])}
    demo = load_json(web / "demo-portfolio.json", {"positions": []})
    portfolio_path = data_dir / "portfolio.json"
    portfolio = load_json(portfolio_path, seed_portfolio(demo))
    trades_payload = load_json(data_dir / "trades.json", {"trades": []})
    trades = list(trades_payload.get("trades", []))
    history_payload = load_json(data_dir / "equity-history.json", {"history": []})
    history = list(history_payload.get("history", []))
    quote_errors: list[str] = []
    if quote_payload is None:
        try:
            quote_payload = fetch_json(QUOTE_API, timeout=45)
        except (requests.RequestException, ValueError) as exc:
            quote_payload = {"positions": []}
            quote_errors.append(type(exc).__name__)
    quotes = {
        str(row.get("symbol")): row
        for row in (quote_payload.get("positions") or quote_payload.get("quotes") or [])
    }
    holdings = _position_map(portfolio)
    universe = sorted(set(rows) | set(holdings))
    decisions: list[dict[str, Any]] = []
    for symbol in universe:
        row = rows.get(symbol)
        holding = holdings.get(symbol)
        quote = quotes.get(symbol)
        live_price, quote_valid, quote_risks = validate_quote(quote, trading_date, config)
        try:
            chart = chart_loader(symbol)
        except (requests.RequestException, ValueError, KeyError):
            chart = pd.DataFrame(columns=["close", "volume"])
        technical = technical_snapshot(chart, live_price if quote_valid else None)
        fundamental = fundamental_snapshot(row)
        decision = make_decision(
            fundamental,
            technical,
            holding,
            quote_valid,
            quote_risks,
            config,
        )
        decisions.append(
            {
                "symbol": symbol,
                "code": normalize_code(symbol),
                "company_name": (row or {}).get("company_name")
                or (holding or {}).get("company_name")
                or symbol,
                "rank": (row or {}).get("rank"),
                "holding": holding or {"quantity": 0, "avg_cost": None},
                "fundamental": fundamental,
                "technical": asdict(technical),
                "quote": {
                    "valid": quote_valid,
                    "current_price": _round(live_price),
                    "quote_time": (quote or {}).get("quote_time"),
                    "verification": (quote or {}).get("verification"),
                    "max_difference_pct": _round(_number((quote or {}).get("max_difference_pct"))),
                    "risks": quote_risks,
                },
                "decision": asdict(decision),
                "proposal": {
                    "side": decision.action.removeprefix("SIM_")
                    if decision.action in {"SIM_BUY", "SIM_SELL"}
                    else None,
                    "quantity": config.quantity if decision.action == "SIM_BUY" else int((holding or {}).get("quantity", 0)),
                    "paper_only": True,
                    "manual_review_required": True,
                },
            }
        )

    same_day = any(str(trade.get("date")) == trading_date.isoformat() for trade in trades)
    executed: list[dict[str, Any]] = []
    turnover = 0.0
    if execute_simulation and not same_day:
        position_map = _position_map(portfolio)
        for row in [item for item in decisions if item["decision"]["action"] == "SIM_SELL"]:
            if not row["decision"]["execution_allowed"]:
                continue
            position = position_map.get(row["symbol"])
            price = _number(row["quote"]["current_price"])
            if not position or price is None:
                continue
            quantity = int(position["quantity"])
            proceeds = price * quantity
            cost = (_number(position.get("avg_cost")) or 0.0) * quantity
            portfolio["cash"] = (_number(portfolio.get("cash")) or 0.0) + proceeds
            portfolio["realized_pnl"] = (_number(portfolio.get("realized_pnl")) or 0.0) + proceeds - cost
            portfolio["positions"] = [p for p in portfolio["positions"] if p["symbol"] != row["symbol"]]
            event = {"date": trading_date.isoformat(), "side": "SIM_SELL", "symbol": row["symbol"], "quantity": quantity, "price": price, "value": proceeds, "paper_only": True, "reasons": row["decision"]["risks"]}
            trades.append(event)
            executed.append(event)
            turnover += proceeds
        position_map = _position_map(portfolio)
        for row in [item for item in decisions if item["decision"]["action"] == "SIM_BUY"]:
            if not row["decision"]["execution_allowed"] or row["symbol"] in position_map:
                continue
            price = _number(row["quote"]["current_price"])
            if price is None:
                continue
            cost = price * config.quantity
            cash = _number(portfolio.get("cash")) or 0.0
            if cash < cost:
                row["decision"]["execution_note"] = "デモ現金不足のため提案のみ"
                continue
            portfolio["cash"] = cash - cost
            portfolio["positions"].append({"symbol": row["symbol"], "code": row["code"], "company_name": row["company_name"], "quantity": config.quantity, "avg_cost": price, "opened_at": dt.datetime.now(TOKYO).isoformat()})
            event = {"date": trading_date.isoformat(), "side": "SIM_BUY", "symbol": row["symbol"], "quantity": config.quantity, "price": price, "value": cost, "paper_only": True, "reasons": row["decision"]["reasons"]}
            trades.append(event)
            executed.append(event)
            turnover += cost

    summary = portfolio_summary(portfolio, decisions, history)
    summary["turnover_today"] = round(turnover, 2)
    summary["trade_count_total"] = len(trades)
    summary["executed_today"] = len(executed)
    history_entry = {
        "date": trading_date.isoformat(),
        "equity": summary["equity"],
        "realized_pnl": summary["realized_pnl"],
        "unrealized_pnl": summary["unrealized_pnl"],
        "total_pnl": summary["total_pnl"],
        "daily_return_pct": summary["daily_return_pct"],
        "cumulative_return_pct": summary["cumulative_return_pct"],
    }
    history = [item for item in history if item.get("date") != trading_date.isoformat()]
    history.append(history_entry)
    history.sort(key=lambda item: str(item.get("date")))
    disclosures_path = web / "data" / "disclosures.json"
    disclosures = load_json(disclosures_path, None)
    if not disclosures:
        disclosures = {
            "availability": "unavailable",
            "provider": "J-Quants TDnet/Company Disclosure add-on",
            "items": [],
            "message": "現在のサニタイズ済みデータに適時開示はありません。TDnet/Company Disclosure add-onの契約・権限を確認してください。",
        }
    report = {
        "schema_version": 1,
        "generated_at": dt.datetime.now(TOKYO).isoformat(),
        "trading_date": trading_date.isoformat(),
        "mode": "simulation-execute" if execute_simulation else "monitor-only",
        "paper_only": True,
        "disclaimer": DISCLAIMER,
        "fundamental_source": {
            "name": ranking.get("metadata", {}).get("source"),
            "plan": ranking.get("metadata", {}).get("plan"),
            "effective_data_cutoff": ranking.get("metadata", {}).get("effective_data_cutoff"),
            "warnings": ranking.get("metadata", {}).get("warnings", []),
        },
        "quote_source": {
            "endpoint": QUOTE_API,
            "generated_at": quote_payload.get("generated_at"),
            "errors": quote_errors,
        },
        "config": asdict(config),
        "summary": summary,
        "decisions": decisions,
        "executed_simulation_events": executed,
        "skipped": [
            {"symbol": row["symbol"], "reasons": row["quote"]["risks"]}
            for row in decisions
            if row["decision"]["action"] in {"SIM_BUY", "SIM_SELL"}
            and not row["decision"]["execution_allowed"]
        ],
        "disclosures": disclosures,
    }
    proposals = {
        "generated_at": report["generated_at"],
        "paper_only": True,
        "manual_review_required": True,
        "proposals": [row for row in decisions if row["proposal"]["side"]],
    }
    write_json(portfolio_path, portfolio)
    write_json(data_dir / "latest-report.json", report)
    write_json(data_dir / "trade-proposals.json", proposals)
    write_json(data_dir / "trades.json", {"trades": trades})
    write_json(data_dir / "equity-history.json", {"history": history})
    write_json(data_dir / "daily-reports" / f"{trading_date.isoformat()}.json", report)
    return report


def build_parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(description="Daily paper-only portfolio monitor")
    parser.add_argument("--root", type=Path, default=Path.cwd())
    parser.add_argument("--execute-simulation", action="store_true")
    parser.add_argument("--date", type=dt.date.fromisoformat)
    return parser


def main(argv: list[str] | None = None) -> int:
    args = build_parser().parse_args(argv)
    report = run_monitor(args.root, args.execute_simulation, args.date)
    summary = report["summary"]
    print(
        json.dumps(
            {
                "trading_date": report["trading_date"],
                "mode": report["mode"],
                "equity": summary["equity"],
                "total_pnl": summary["total_pnl"],
                "executed_today": summary["executed_today"],
                "paper_only": True,
            },
            ensure_ascii=False,
        )
    )
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
