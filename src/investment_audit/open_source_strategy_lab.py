from __future__ import annotations

import argparse
import datetime as dt
import importlib
import importlib.metadata
import json
import math
from dataclasses import asdict, dataclass
from pathlib import Path
from typing import Any, Callable

import numpy as np
import pandas as pd
import requests

CHART_URL = (
    "https://query2.finance.yahoo.com/v8/finance/chart/{symbol}"
    "?interval=1d&range=2y&includePrePost=false&events=div%2Csplits"
)
STRATEGIES = (
    "baseline_equal_weight",
    "trend_confirmed",
    "quality_value",
    "low_volatility",
    "inverse_volatility",
    "momentum_confirmed",
)


@dataclass(frozen=True)
class LabConfig:
    fee_bps: float = 5.0
    slippage_bps: float = 2.0
    train_days: int = 126
    test_days: int = 21
    purge_days: int = 1
    min_oos_days: int = 42
    annualization: int = 252

    @property
    def total_cost_rate(self) -> float:
        return (self.fee_bps + self.slippage_bps) / 10_000.0


def _number(value: Any) -> float | None:
    try:
        parsed = float(value)
    except (TypeError, ValueError):
        return None
    return parsed if math.isfinite(parsed) else None


def _safe_json(value: Any) -> Any:
    if isinstance(value, dict):
        return {str(key): _safe_json(item) for key, item in value.items()}
    if isinstance(value, (list, tuple)):
        return [_safe_json(item) for item in value]
    if isinstance(value, (pd.Timestamp, dt.datetime, dt.date)):
        return value.isoformat()
    if isinstance(value, (np.integer,)):
        return int(value)
    if isinstance(value, (np.floating, float)):
        return None if not math.isfinite(float(value)) else float(value)
    if value is pd.NA:
        return None
    return value


def fetch_daily_history(symbol: str, timeout: float = 30.0) -> pd.DataFrame:
    response = requests.get(
        CHART_URL.format(symbol=symbol),
        timeout=timeout,
        headers={"Accept": "application/json", "User-Agent": "ValueScopeStrategyLab/1.0"},
    )
    response.raise_for_status()
    result = (response.json().get("chart", {}).get("result") or [None])[0]
    if not isinstance(result, dict):
        return pd.DataFrame(columns=["close", "volume"])
    timestamps = result.get("timestamp") or []
    quote = ((result.get("indicators") or {}).get("quote") or [{}])[0]
    adjusted = ((result.get("indicators") or {}).get("adjclose") or [{}])[0]
    closes = adjusted.get("adjclose") or quote.get("close") or []
    volumes = quote.get("volume") or []
    rows: list[dict[str, Any]] = []
    for index, timestamp in enumerate(timestamps):
        close = _number(closes[index] if index < len(closes) else None)
        if close is None:
            continue
        rows.append(
            {
                "date": pd.Timestamp(timestamp, unit="s", tz="UTC").tz_convert("Asia/Tokyo").normalize(),
                "close": close,
                "volume": _number(volumes[index] if index < len(volumes) else None),
            }
        )
    if not rows:
        return pd.DataFrame(columns=["close", "volume"])
    return pd.DataFrame(rows).drop_duplicates("date", keep="last").set_index("date").sort_index()


def load_inputs(root: Path) -> tuple[list[str], dict[str, dict[str, Any]], pd.Timestamp]:
    web = root / "web"
    ranking = json.loads((web / "jquants-ranking.json").read_text(encoding="utf-8"))
    demo = json.loads((web / "demo-portfolio.json").read_text(encoding="utf-8"))
    rows: dict[str, dict[str, Any]] = {}
    for row in ranking.get("rows", []):
        raw_code = str(row.get("code", ""))
        code = raw_code[:-1] if len(raw_code) == 5 and raw_code.endswith("0") else raw_code
        rows[f"{code}.T"] = row
    symbols = [str(position.get("symbol")) for position in demo.get("positions", []) if position.get("symbol")]
    cutoff = pd.Timestamp(ranking.get("metadata", {}).get("effective_data_cutoff", "2026-05-11"), tz="Asia/Tokyo")
    return symbols, rows, cutoff


def build_price_matrix(
    symbols: list[str],
    loader: Callable[[str], pd.DataFrame] = fetch_daily_history,
) -> tuple[pd.DataFrame, dict[str, str]]:
    series: dict[str, pd.Series] = {}
    errors: dict[str, str] = {}
    for symbol in symbols:
        try:
            frame = loader(symbol)
        except (requests.RequestException, ValueError, KeyError) as exc:
            errors[symbol] = type(exc).__name__
            continue
        if frame.empty:
            errors[symbol] = "empty_history"
            continue
        series[symbol] = pd.to_numeric(frame["close"], errors="coerce")
    if not series:
        return pd.DataFrame(), errors
    prices = pd.concat(series, axis=1).sort_index().ffill(limit=3)
    return prices.dropna(how="all"), errors


def _normalize_weights(raw: pd.DataFrame) -> pd.DataFrame:
    raw = raw.replace([np.inf, -np.inf], np.nan).fillna(0.0).clip(lower=0.0)
    totals = raw.sum(axis=1).replace(0.0, np.nan)
    return raw.div(totals, axis=0).fillna(0.0)


def strategy_weights(
    prices: pd.DataFrame,
    strategy: str,
    fundamentals: dict[str, dict[str, Any]],
) -> pd.DataFrame:
    valid = prices.notna().astype(float)
    if strategy == "baseline_equal_weight":
        return _normalize_weights(valid)
    sma20 = prices.rolling(20, min_periods=20).mean()
    sma60 = prices.rolling(60, min_periods=60).mean()
    returns = prices.pct_change(fill_method=None)
    volatility = returns.rolling(20, min_periods=15).std()
    momentum20 = prices.pct_change(20, fill_method=None)
    momentum60 = prices.pct_change(60, fill_method=None)
    if strategy == "trend_confirmed":
        return _normalize_weights(((prices > sma20) & (sma20 > sma60)).astype(float))
    if strategy == "momentum_confirmed":
        return _normalize_weights(((momentum20 > 0) & (momentum60 > 0)).astype(float))
    if strategy == "inverse_volatility":
        return _normalize_weights(1.0 / volatility.replace(0.0, np.nan))
    if strategy == "low_volatility":
        ranks = volatility.rank(axis=1, pct=True, ascending=True)
        return _normalize_weights((ranks <= 0.5).astype(float))
    if strategy == "quality_value":
        scores: dict[str, float] = {}
        for symbol in prices.columns:
            row = fundamentals.get(symbol, {})
            value = _number(row.get("value_score"))
            quality = _number(row.get("quality_score"))
            if value is not None and quality is not None:
                scores[symbol] = (value + quality) / 2.0
        static = pd.Series(scores, index=prices.columns, dtype=float)
        selected = static.rank(pct=True, ascending=False) <= 0.5
        raw = pd.DataFrame(
            np.tile(selected.fillna(False).astype(float).to_numpy(), (len(prices), 1)),
            index=prices.index,
            columns=prices.columns,
        )
        return _normalize_weights(raw * valid)
    raise ValueError(f"unknown strategy: {strategy}")


def portfolio_returns(
    prices: pd.DataFrame,
    weights: pd.DataFrame,
    config: LabConfig,
) -> tuple[pd.Series, pd.Series]:
    asset_returns = prices.pct_change(fill_method=None).fillna(0.0)
    executed = weights.shift(1).fillna(0.0)
    gross = (executed * asset_returns).sum(axis=1)
    turnover = executed.diff().abs().sum(axis=1).fillna(executed.abs().sum(axis=1))
    net = gross - turnover * config.total_cost_rate
    return net, turnover


def metrics(returns: pd.Series, turnover: pd.Series, config: LabConfig) -> dict[str, Any]:
    clean = pd.to_numeric(returns, errors="coerce").dropna()
    if clean.empty:
        return {"observations": 0, "status": "no_data"}
    equity = (1.0 + clean).cumprod()
    total_return = float(equity.iloc[-1] - 1.0)
    volatility = float(clean.std(ddof=0) * math.sqrt(config.annualization)) if len(clean) > 1 else None
    mean = float(clean.mean() * config.annualization)
    sharpe = mean / volatility if volatility and volatility > 0 else None
    downside = clean[clean < 0].std(ddof=0) * math.sqrt(config.annualization)
    sortino = mean / float(downside) if downside and downside > 0 else None
    running_max = equity.cummax()
    max_drawdown = float((equity / running_max - 1.0).min())
    wins = clean[clean > 0]
    losses = clean[clean < 0]
    profit_factor = float(wins.sum() / abs(losses.sum())) if not losses.empty and losses.sum() != 0 else None
    sufficient = len(clean) >= config.min_oos_days
    years = len(clean) / config.annualization
    cagr = float(equity.iloc[-1] ** (1 / years) - 1) if sufficient and years > 0 else None
    return {
        "status": "ok" if sufficient else "insufficient_history",
        "observations": int(len(clean)),
        "total_return_pct": total_return * 100,
        "cagr_pct": None if cagr is None else cagr * 100,
        "volatility_pct": None if volatility is None else volatility * 100,
        "sharpe": sharpe if sufficient else None,
        "sortino": sortino if sufficient else None,
        "max_drawdown_pct": max_drawdown * 100,
        "turnover": float(turnover.reindex(clean.index).fillna(0.0).sum()),
        "hit_rate_pct": float((clean > 0).mean() * 100),
        "profit_factor": profit_factor,
    }


def walk_forward_windows(index: pd.Index, config: LabConfig) -> list[tuple[pd.Index, pd.Index]]:
    windows: list[tuple[pd.Index, pd.Index]] = []
    cursor = config.train_days
    while cursor + config.purge_days + config.test_days <= len(index):
        train = index[cursor - config.train_days : cursor]
        test_start = cursor + config.purge_days
        test = index[test_start : test_start + config.test_days]
        windows.append((train, test))
        cursor += config.test_days
    return windows


def run_walk_forward(
    returns_by_strategy: dict[str, pd.Series],
    turnover_by_strategy: dict[str, pd.Series],
    config: LabConfig,
) -> dict[str, Any]:
    if not returns_by_strategy:
        return {"status": "no_data", "windows": []}
    common = next(iter(returns_by_strategy.values())).index
    windows = walk_forward_windows(common, config)
    if not windows:
        return {
            "status": "insufficient_history",
            "required_days": config.train_days + config.purge_days + config.test_days,
            "available_days": len(common),
            "windows": [],
            "selected_strategy": None,
        }
    oos_parts: list[pd.Series] = []
    selected: list[str] = []
    window_rows: list[dict[str, Any]] = []
    for train_index, test_index in windows:
        train_scores: dict[str, float] = {}
        for name, returns in returns_by_strategy.items():
            train = returns.reindex(train_index).dropna()
            std = float(train.std(ddof=0))
            train_scores[name] = float(train.mean() / std) if std > 0 else -math.inf
        winner = max(train_scores, key=train_scores.get)
        selected.append(winner)
        test_returns = returns_by_strategy[winner].reindex(test_index).dropna()
        oos_parts.append(test_returns)
        window_rows.append(
            {
                "train_start": train_index[0],
                "train_end": train_index[-1],
                "test_start": test_index[0],
                "test_end": test_index[-1],
                "selected_strategy": winner,
                "train_score": train_scores[winner],
                "test_return_pct": float(((1 + test_returns).prod() - 1) * 100),
            }
        )
    oos = pd.concat(oos_parts).sort_index()
    turnover = pd.concat(
        [turnover_by_strategy[row["selected_strategy"]].reindex(test).fillna(0.0) for row, (_, test) in zip(window_rows, windows, strict=True)]
    ).sort_index()
    counts = pd.Series(selected).value_counts(normalize=True)
    return {
        "status": "ok" if len(oos) >= config.min_oos_days else "insufficient_history",
        "windows": _safe_json(window_rows),
        "metrics": metrics(oos, turnover, config),
        "selected_strategy": counts.index[0],
        "parameter_stability": float(counts.iloc[0]),
    }


def vectorbt_status(returns: pd.Series) -> dict[str, Any]:
    try:
        module = importlib.import_module("vectorbt")
        version = importlib.metadata.version("vectorbt")
        price = (1.0 + returns.fillna(0.0)).cumprod()
        portfolio = module.Portfolio.from_holding(price, init_cash=1.0)
        return {
            "available": True,
            "version": version,
            "validation_total_return_pct": float(portfolio.total_return() * 100),
            "status": "validated",
        }
    except Exception as exc:  # optional research dependency must never break the report
        return {
            "available": False,
            "version": None,
            "validation_total_return_pct": None,
            "status": f"pandas_fallback:{type(exc).__name__}",
        }


def run_lab(root: Path, loader: Callable[[str], pd.DataFrame] = fetch_daily_history, config: LabConfig = LabConfig()) -> dict[str, Any]:
    symbols, fundamentals, cutoff = load_inputs(root)
    prices, errors = build_price_matrix(symbols, loader)
    warnings: list[str] = []
    if prices.empty:
        raise RuntimeError("No public daily history was available")
    evaluation = prices.loc[prices.index > cutoff].dropna(how="all")
    if evaluation.empty:
        raise RuntimeError("No observations exist after the delayed fundamental cutoff")
    returns_by_strategy: dict[str, pd.Series] = {}
    turnover_by_strategy: dict[str, pd.Series] = {}
    strategy_rows: list[dict[str, Any]] = []
    for name in STRATEGIES:
        weights = strategy_weights(prices, name, fundamentals).reindex(evaluation.index).fillna(0.0)
        returns, turnover = portfolio_returns(evaluation, weights, config)
        returns_by_strategy[name] = returns
        turnover_by_strategy[name] = turnover
        strategy_rows.append({"name": name, "metrics": metrics(returns, turnover, config)})
    baseline = returns_by_strategy["baseline_equal_weight"]
    baseline_total = float(((1 + baseline).prod() - 1) * 100)
    for row in strategy_rows:
        total = _number(row["metrics"].get("total_return_pct"))
        row["baseline_excess_pct"] = None if total is None else total - baseline_total
    walk_forward = run_walk_forward(returns_by_strategy, turnover_by_strategy, config)
    if walk_forward.get("status") != "ok":
        warnings.append("Walk-forward validation has insufficient post-cutoff history; no strategy may be promoted.")
    if len(evaluation) < config.min_oos_days:
        warnings.append("The delayed-data selection has fewer than 42 post-cutoff observations; CAGR and Sharpe are suppressed.")
    vectorbt = vectorbt_status(baseline)
    if not vectorbt["available"]:
        warnings.append("vectorbt optional validation was unavailable; the deterministic pandas engine produced the report.")
    candidates = sorted(
        strategy_rows,
        key=lambda row: _number(row["metrics"].get("total_return_pct")) or -math.inf,
        reverse=True,
    )
    can_adopt = walk_forward.get("status") == "ok" and walk_forward.get("metrics", {}).get("status") == "ok"
    generated_at = dt.datetime.now(dt.timezone.utc)
    payload = {
        "schema_version": 1,
        "generated_at": generated_at,
        "purpose": "research_only",
        "auto_adopt": False,
        "fundamental_cutoff": cutoff,
        "evaluation_start": evaluation.index.min(),
        "evaluation_end": evaluation.index.max(),
        "observations": len(evaluation),
        "symbols": symbols,
        "data_errors": errors,
        "config": asdict(config),
        "engine": {
            "primary": "pandas",
            "vectorbt": vectorbt,
            "qlib_pattern": "experiment manifest only; Qlib is not installed",
            "bt_pattern": "not installed; existing portfolio backtester overlaps",
        },
        "strategies": strategy_rows,
        "walk_forward": walk_forward,
        "research_candidate": candidates[0]["name"] if can_adopt else None,
        "adoption_status": "research_candidate" if can_adopt else "not_eligible_insufficient_validation",
        "warnings": warnings,
        "disclaimer": "Historical research only. No paper or broker rule is changed automatically and no future return is guaranteed.",
    }
    output = root / "web" / "data" / "strategy-lab"
    experiments = output / "experiments"
    output.mkdir(parents=True, exist_ok=True)
    experiments.mkdir(parents=True, exist_ok=True)
    safe = _safe_json(payload)
    (output / "latest.json").write_text(json.dumps(safe, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    name = generated_at.strftime("%Y%m%dT%H%M%SZ") + ".json"
    (experiments / name).write_text(json.dumps(safe, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    return safe


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description="Open-source strategy comparison lab")
    parser.add_argument("--root", type=Path, default=Path.cwd())
    args = parser.parse_args(argv)
    result = run_lab(args.root)
    print(json.dumps({"status": result["adoption_status"], "observations": result["observations"], "warnings": result["warnings"]}, ensure_ascii=False))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
