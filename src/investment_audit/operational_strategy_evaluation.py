from __future__ import annotations

import argparse
import datetime as dt
import json
from pathlib import Path
from typing import Any, Callable

import pandas as pd

from .open_source_strategy_lab import (
    LabConfig,
    STRATEGIES,
    build_price_matrix,
    fetch_daily_history,
    metrics,
    portfolio_returns,
    run_walk_forward,
    strategy_weights,
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


def _timestamp(value: Any) -> pd.Timestamp | None:
    if not value:
        return None
    try:
        parsed = pd.Timestamp(value)
    except (TypeError, ValueError):
        return None
    if pd.isna(parsed):
        return None
    if parsed.tzinfo is None:
        parsed = parsed.tz_localize("UTC")
    return parsed.tz_convert("Asia/Tokyo")


def _next_business_day(value: pd.Timestamp) -> pd.Timestamp:
    return (value.normalize() + pd.offsets.BDay(1)).normalize()


def _normalize_code(value: Any) -> str:
    code = str(value or "").strip().upper().removesuffix(".T")
    if len(code) == 5 and code.endswith("0"):
        code = code[:-1]
    return code


def _inputs(root: Path) -> tuple[list[str], dict[str, dict[str, Any]], pd.Timestamp | None]:
    web = root / "web"
    ranking = _load(web / "jquants-ranking.json", {"metadata": {}, "rows": []})
    demo = _load(web / "demo-portfolio.json", {"positions": []})
    fundamentals: dict[str, dict[str, Any]] = {}
    for row in ranking.get("rows", []):
        code = _normalize_code(row.get("code"))
        if code:
            fundamentals[f"{code}.T"] = row
    symbols = [
        str(position.get("symbol") or f"{_normalize_code(position.get('code'))}.T")
        for position in demo.get("positions", [])
        if position.get("symbol") or position.get("code")
    ]
    generated_at = _timestamp(ranking.get("metadata", {}).get("generated_at"))
    return symbols, fundamentals, generated_at


def evaluate_operational_slice(
    prices: pd.DataFrame,
    fundamentals: dict[str, dict[str, Any]],
    operational_start: pd.Timestamp,
    config: LabConfig = LabConfig(),
) -> dict[str, Any]:
    evaluation = prices.loc[prices.index >= operational_start].dropna(how="all")
    if evaluation.empty:
        return {
            "status": "insufficient_history",
            "lookahead_safe": True,
            "evaluation_start": operational_start.isoformat(),
            "evaluation_end": None,
            "observations": 0,
            "strategies": [],
            "walk_forward": {"status": "insufficient_history", "windows": []},
            "warnings": ["運用可能な価格履歴がまだありません。"],
        }

    strategy_rows: list[dict[str, Any]] = []
    returns_by_strategy: dict[str, pd.Series] = {}
    turnover_by_strategy: dict[str, pd.Series] = {}
    for name in STRATEGIES:
        full_weights = strategy_weights(prices, name, fundamentals)
        weights = full_weights.reindex(evaluation.index).fillna(0.0)
        returns, turnover = portfolio_returns(evaluation, weights, config)
        returns_by_strategy[name] = returns
        turnover_by_strategy[name] = turnover
        strategy_rows.append({"name": name, "metrics": metrics(returns, turnover, config)})

    baseline = returns_by_strategy.get("baseline_equal_weight", pd.Series(dtype=float))
    baseline_total = float(((1 + baseline).prod() - 1) * 100) if not baseline.empty else None
    for row in strategy_rows:
        total = row["metrics"].get("total_return_pct")
        row["baseline_excess_pct"] = (
            None
            if total is None or baseline_total is None
            else float(total) - baseline_total
        )

    walk_forward = run_walk_forward(
        returns_by_strategy,
        turnover_by_strategy,
        config,
    )
    warnings: list[str] = []
    if len(evaluation) < config.train_days + config.purge_days + config.test_days:
        warnings.append(
            "学習126日・purge1日・テスト21日を満たしていません。"
        )
    if walk_forward.get("status") != "ok":
        warnings.append("運用可能期間のwalk-forward検証は履歴不足です。")
    return {
        "status": "ok" if walk_forward.get("status") == "ok" else "insufficient_history",
        "lookahead_safe": True,
        "evaluation_start": evaluation.index.min().isoformat(),
        "evaluation_end": evaluation.index.max().isoformat(),
        "observations": int(len(evaluation)),
        "strategies": strategy_rows,
        "walk_forward": walk_forward,
        "warnings": warnings,
    }


def build_operational_evaluation(
    root: Path,
    loader: Callable[[str], pd.DataFrame] = fetch_daily_history,
    config: LabConfig = LabConfig(),
) -> dict[str, Any]:
    symbols, fundamentals, generated_at = _inputs(root)
    if generated_at is None:
        payload = {
            "schema_version": 1,
            "generated_at": dt.datetime.now(dt.timezone.utc).isoformat(),
            "status": "unavailable",
            "lookahead_safe": False,
            "evaluation_start": None,
            "evaluation_end": None,
            "observations": 0,
            "strategies": [],
            "walk_forward": {"status": "unavailable", "windows": []},
            "warnings": ["Fundamentalスナップショット生成時刻がありません。"],
            "paper_only": True,
        }
    else:
        prices, errors = build_price_matrix(symbols, loader)
        operational_start = _next_business_day(generated_at)
        payload = {
            "schema_version": 1,
            "generated_at": dt.datetime.now(dt.timezone.utc).isoformat(),
            "snapshot_generated_at": generated_at.isoformat(),
            "operational_start": operational_start.isoformat(),
            "data_errors": errors,
            "paper_only": True,
            **evaluate_operational_slice(prices, fundamentals, operational_start, config),
        }
    _write(root / "web" / "data" / "strategy-lab" / "operational.json", payload)
    return payload


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description="Operational-only strategy evaluation")
    parser.add_argument("--root", type=Path, default=Path.cwd())
    args = parser.parse_args(argv)
    result = build_operational_evaluation(args.root)
    print(
        json.dumps(
            {
                "status": result["status"],
                "observations": result["observations"],
                "lookahead_safe": result["lookahead_safe"],
                "paper_only": True,
            },
            ensure_ascii=False,
        )
    )
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
