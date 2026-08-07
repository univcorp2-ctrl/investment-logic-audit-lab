from __future__ import annotations

import argparse
import json
from pathlib import Path
from typing import Any

import pandas as pd
import requests

from .performance_analytics_compat import PerformanceConfig, analyze_performance

BENCHMARK_SYMBOL = "1306.T"
BENCHMARK_URL = (
    "https://query2.finance.yahoo.com/v8/finance/chart/{symbol}"
    "?interval=1d&range=2y&includePrePost=false&events=div%2Csplits"
)


def _load(path: Path, default: Any) -> Any:
    if not path.exists():
        return default
    return json.loads(path.read_text(encoding="utf-8"))


def _write(path: Path, payload: Any) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(
        json.dumps(payload, ensure_ascii=False, indent=2, allow_nan=False) + "\n",
        encoding="utf-8",
    )


def fetch_benchmark(symbol: str = BENCHMARK_SYMBOL, timeout: float = 30.0) -> pd.DataFrame:
    response = requests.get(
        BENCHMARK_URL.format(symbol=symbol),
        timeout=timeout,
        headers={"Accept": "application/json", "User-Agent": "ValueScopeAnalytics/1.0"},
    )
    response.raise_for_status()
    result = (response.json().get("chart", {}).get("result") or [None])[0]
    if not isinstance(result, dict):
        return pd.DataFrame(columns=["close"])
    timestamps = result.get("timestamp") or []
    quote = ((result.get("indicators") or {}).get("quote") or [{}])[0]
    adjusted = ((result.get("indicators") or {}).get("adjclose") or [{}])[0]
    closes = adjusted.get("adjclose") or quote.get("close") or []
    rows: list[dict[str, Any]] = []
    for index, timestamp in enumerate(timestamps):
        value = closes[index] if index < len(closes) else None
        try:
            close = float(value)
        except (TypeError, ValueError):
            continue
        rows.append(
            {
                "date": pd.Timestamp(timestamp, unit="s", tz="UTC")
                .tz_convert("Asia/Tokyo")
                .tz_localize(None)
                .normalize(),
                "close": close,
            }
        )
    if not rows:
        return pd.DataFrame(columns=["close"])
    return (
        pd.DataFrame(rows)
        .sort_values("date", kind="stable")
        .drop_duplicates("date", keep="last")
        .set_index("date")
    )


def build_performance_report(
    root: Path,
    *,
    benchmark_loader: Any = fetch_benchmark,
    config: PerformanceConfig = PerformanceConfig(),
) -> dict[str, Any]:
    data_dir = root / "web" / "data" / "paper-trading"
    latest_path = data_dir / "latest-report.json"
    latest = _load(latest_path, {})
    if not latest:
        raise FileNotFoundError(f"daily paper report not found: {latest_path}")
    portfolio = _load(data_dir / "portfolio.json", {})
    history = _load(data_dir / "equity-history.json", {"history": []}).get("history", [])
    trades = _load(data_dir / "trades.json", {"trades": []}).get("trades", [])
    demo = _load(root / "web" / "demo-portfolio.json", {"positions": []})
    decision_map = {
        str(item.get("symbol")): item
        for item in latest.get("decisions", [])
        if item.get("symbol")
    }
    positions: list[dict[str, Any]] = []
    for position in portfolio.get("positions", []):
        item = decision_map.get(str(position.get("symbol")), {})
        current_price = item.get("technical", {}).get("price")
        positions.append({**position, "current_price": current_price})
    summary = {
        **latest.get("summary", {}),
        "cash": portfolio.get("cash", latest.get("summary", {}).get("cash", 0.0)),
        "seed_cost_basis": portfolio.get("seed_cost_basis"),
    }
    benchmark = pd.DataFrame(columns=["close"])
    benchmark_error: str | None = None
    try:
        benchmark = benchmark_loader(config.benchmark_symbol)
    except (requests.RequestException, ValueError, KeyError, TypeError) as exc:
        benchmark_error = f"{type(exc).__name__}: benchmark data unavailable"
    analytics = analyze_performance(
        history,
        trades,
        positions,
        summary,
        seed_positions=demo.get("positions", []),
        benchmark_history=benchmark,
        benchmark_error=benchmark_error,
        config=config,
        generated_at=latest.get("generated_at"),
    )
    latest["performance_analytics"] = analytics
    _write(latest_path, latest)
    trading_date = latest.get("trading_date")
    if trading_date:
        daily_path = data_dir / "daily-reports" / f"{trading_date}.json"
        if daily_path.exists():
            daily = _load(daily_path, {})
            daily["performance_analytics"] = analytics
            _write(daily_path, daily)
    _write(data_dir / "performance-analytics.json", analytics)
    return analytics


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description="Publish paper portfolio performance analytics")
    parser.add_argument("--root", type=Path, default=Path.cwd())
    args = parser.parse_args(argv)
    analytics = build_performance_report(args.root)
    print(
        json.dumps(
            {
                "reliability": analytics["reliability"]["status"],
                "equity_observations": analytics["reliability"]["equity_observations"],
                "return_observations": analytics["reliability"]["return_observations"],
                "benchmark_status": analytics["benchmark"]["status"],
            },
            ensure_ascii=False,
        )
    )
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
