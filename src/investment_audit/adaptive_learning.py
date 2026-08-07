from __future__ import annotations

import argparse
import datetime as dt
import json
import math
from dataclasses import asdict
from pathlib import Path
from typing import Any
from zoneinfo import ZoneInfo

import numpy as np
import pandas as pd

from .daily_monitor import StrategyConfig, run_monitor

TOKYO = ZoneInfo("Asia/Tokyo")
FEATURE_NAMES = (
    "fundamental_score",
    "value_score",
    "quality_score",
    "growth_score",
    "trap_risk",
    "completeness",
    "earnings_yield",
    "book_to_market",
    "fcf_yield",
    "roe",
    "operating_margin",
    "technical_score",
    "rsi14",
    "momentum20",
    "momentum60",
    "volatility20",
    "drawdown20",
    "price_vs_sma20",
    "price_vs_sma60",
)
FUNDAMENTAL_FEATURES = set(FEATURE_NAMES[:11])
TECHNICAL_FEATURES = set(FEATURE_NAMES[11:])


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


def _number(value: Any) -> float | None:
    if value is None:
        return None
    try:
        parsed = float(value)
    except (TypeError, ValueError):
        return None
    return parsed if math.isfinite(parsed) else None


def _read_jsonl(path: Path) -> list[dict[str, Any]]:
    if not path.exists():
        return []
    rows: list[dict[str, Any]] = []
    for line in path.read_text(encoding="utf-8").splitlines():
        if not line.strip():
            continue
        try:
            payload = json.loads(line)
        except json.JSONDecodeError:
            continue
        if isinstance(payload, dict):
            rows.append(payload)
    return rows


def _write_jsonl(path: Path, rows: list[dict[str, Any]]) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    text = "\n".join(
        json.dumps(row, ensure_ascii=False, allow_nan=False) for row in rows
    )
    path.write_text(f"{text}\n" if text else "", encoding="utf-8")


def _feature_row(decision: dict[str, Any], trading_date: str) -> dict[str, Any]:
    fundamental = decision.get("fundamental", {})
    technical = decision.get("technical", {})
    quote = decision.get("quote", {})
    return {
        "date": trading_date,
        "code": str(decision.get("code") or ""),
        "company_name": decision.get("company_name"),
        "price": _number(technical.get("price")),
        "quote_valid": quote.get("valid") is True,
        "action": decision.get("decision", {}).get("action"),
        "holding_quantity": _number(decision.get("holding", {}).get("quantity")),
        "fundamental_score": _number(fundamental.get("score")),
        "value_score": _number(fundamental.get("value_score")),
        "quality_score": _number(fundamental.get("quality_score")),
        "growth_score": _number(fundamental.get("growth_stability_score")),
        "trap_risk": _number(fundamental.get("value_trap_risk")),
        "completeness": _number(fundamental.get("data_completeness")),
        "earnings_yield": _number(fundamental.get("earnings_yield")),
        "book_to_market": _number(fundamental.get("book_to_market")),
        "fcf_yield": _number(fundamental.get("fcf_yield")),
        "roe": _number(fundamental.get("roe")),
        "operating_margin": _number(fundamental.get("operating_margin")),
        "technical_score": _number(technical.get("score")),
        "rsi14": _number(technical.get("rsi14")),
        "momentum20": _number(technical.get("momentum20_pct")),
        "momentum60": _number(technical.get("momentum60_pct")),
        "volatility20": _number(technical.get("volatility20_pct")),
        "drawdown20": _number(technical.get("drawdown20_pct")),
        "price_vs_sma20": _number(technical.get("price_vs_sma20_pct")),
        "price_vs_sma60": _number(technical.get("price_vs_sma60_pct")),
        "forward_return_1d_pct": None,
        "matured_at": None,
    }


def mature_feature_rows(rows: list[dict[str, Any]]) -> list[dict[str, Any]]:
    output = [dict(row) for row in rows]
    by_code: dict[str, list[dict[str, Any]]] = {}
    for row in output:
        by_code.setdefault(str(row.get("code") or ""), []).append(row)
    for group in by_code.values():
        group.sort(key=lambda row: str(row.get("date") or ""))
        for previous, current in zip(group, group[1:], strict=False):
            if previous.get("forward_return_1d_pct") is not None:
                continue
            previous_price = _number(previous.get("price"))
            current_price = _number(current.get("price"))
            if previous_price and current_price and previous_price > 0:
                previous["forward_return_1d_pct"] = round(
                    (current_price / previous_price - 1.0) * 100,
                    8,
                )
                previous["matured_at"] = current.get("date")
    return sorted(output, key=lambda row: (str(row.get("date")), str(row.get("code"))))


def collect_feature_history(
    root: Path,
    report: dict[str, Any] | None = None,
) -> dict[str, Any]:
    data_dir = root / "web" / "data" / "adaptive-learning"
    feature_path = data_dir / "feature-history.jsonl"
    report = report or _load(
        root / "web" / "data" / "paper-trading" / "latest-report.json",
        {},
    )
    trading_date = str(report.get("trading_date") or "")
    if not trading_date:
        return {"added": 0, "matured": 0, "total": len(_read_jsonl(feature_path))}
    rows = _read_jsonl(feature_path)
    existing = {(str(row.get("date")), str(row.get("code"))) for row in rows}
    added = 0
    for decision in report.get("decisions", []):
        row = _feature_row(decision, trading_date)
        key = (trading_date, row["code"])
        if not row["code"] or key in existing:
            continue
        rows.append(row)
        existing.add(key)
        added += 1
    before = sum(row.get("forward_return_1d_pct") is not None for row in rows)
    rows = mature_feature_rows(rows)
    after = sum(row.get("forward_return_1d_pct") is not None for row in rows)
    _write_jsonl(feature_path, rows)
    return {"added": added, "matured": after - before, "total": len(rows)}


def purged_date_splits(
    dates: list[str],
    train_days: int,
    test_days: int,
    purge_days: int,
) -> list[tuple[list[str], list[str]]]:
    unique_dates = sorted(set(dates))
    splits: list[tuple[list[str], list[str]]] = []
    cursor = train_days
    while cursor + purge_days + test_days <= len(unique_dates):
        train = unique_dates[cursor - train_days : cursor]
        start = cursor + purge_days
        test = unique_dates[start : start + test_days]
        splits.append((train, test))
        cursor += test_days
    return splits


def _prepare_matrix(
    frame: pd.DataFrame,
    medians: pd.Series | None = None,
    means: pd.Series | None = None,
    scales: pd.Series | None = None,
) -> tuple[np.ndarray, pd.Series, pd.Series, pd.Series]:
    features = frame.loc[:, FEATURE_NAMES].apply(pd.to_numeric, errors="coerce")
    medians = medians if medians is not None else features.median(axis=0).fillna(0.0)
    filled = features.fillna(medians)
    means = means if means is not None else filled.mean(axis=0)
    scales = scales if scales is not None else filled.std(axis=0).replace(0, 1).fillna(1)
    matrix = ((filled - means) / scales).to_numpy(dtype=float)
    return matrix, medians, means, scales


def _ridge_fit(matrix: np.ndarray, target: np.ndarray, alpha: float = 2.0) -> np.ndarray:
    design = np.column_stack([np.ones(len(matrix)), matrix])
    penalty = np.eye(design.shape[1]) * alpha
    penalty[0, 0] = 0.0
    return np.linalg.pinv(design.T @ design + penalty) @ design.T @ target


def _ridge_predict(matrix: np.ndarray, coefficients: np.ndarray) -> np.ndarray:
    design = np.column_stack([np.ones(len(matrix)), matrix])
    return design @ coefficients


def _fit_predict(
    train: pd.DataFrame,
    test: pd.DataFrame,
    seed: int,
) -> tuple[np.ndarray, np.ndarray, str]:
    train_x, medians, means, scales = _prepare_matrix(train)
    test_x, _, _, _ = _prepare_matrix(test, medians, means, scales)
    train_y = pd.to_numeric(train["forward_return_1d_pct"], errors="coerce").to_numpy()
    coefficients = _ridge_fit(train_x, train_y)
    ridge_prediction = _ridge_predict(test_x, coefficients)
    engine = "numpy-ridge"
    prediction = ridge_prediction
    try:
        from sklearn.ensemble import HistGradientBoostingRegressor
        from sklearn.linear_model import Ridge

        ridge = Ridge(alpha=2.0).fit(train_x, train_y)
        boost = HistGradientBoostingRegressor(
            max_depth=3,
            max_iter=120,
            learning_rate=0.05,
            random_state=seed,
        ).fit(train_x, train_y)
        prediction = (ridge.predict(test_x) + boost.predict(test_x)) / 2.0
        coefficients = np.concatenate([[ridge.intercept_], ridge.coef_])
        engine = "sklearn-ridge-histgradientboosting"
    except ImportError:
        pass
    return prediction, coefficients[1:], engine


def _daily_returns(frame: pd.DataFrame, score_column: str, top_fraction: float) -> pd.Series:
    rows: list[tuple[pd.Timestamp, float]] = []
    for date, group in frame.groupby("date", sort=True):
        count = max(1, int(math.ceil(len(group) * top_fraction)))
        selected = group.nlargest(count, score_column)
        value = pd.to_numeric(selected["forward_return_1d_pct"], errors="coerce").mean()
        if pd.notna(value):
            rows.append((pd.Timestamp(date), float(value) / 100.0))
    return pd.Series(dict(rows), dtype=float).sort_index()


def _max_drawdown(returns: pd.Series) -> float | None:
    if returns.empty:
        return None
    equity = (1.0 + returns).cumprod()
    return float((equity / equity.cummax() - 1.0).min() * 100)


def _metrics(returns: pd.Series) -> dict[str, Any]:
    if returns.empty:
        return {
            "observations": 0,
            "total_return_pct": None,
            "sharpe": None,
            "max_drawdown_pct": None,
        }
    total = float(((1.0 + returns).prod() - 1.0) * 100)
    std = float(returns.std(ddof=0))
    sharpe = float(returns.mean() / std * math.sqrt(252)) if std > 0 else None
    return {
        "observations": int(len(returns)),
        "total_return_pct": total,
        "sharpe": sharpe,
        "max_drawdown_pct": _max_drawdown(returns),
    }


def _training_gates(frame: pd.DataFrame, policy: dict[str, Any]) -> dict[str, Any]:
    days = int(frame["date"].nunique()) if not frame.empty else 0
    rows = int(len(frame))
    securities = int(frame["code"].nunique()) if not frame.empty else 0
    checks = {
        "training_days": days >= int(policy["minimum_training_days"]),
        "matured_rows": rows >= int(policy["minimum_matured_rows"]),
        "securities": securities >= int(policy["minimum_securities"]),
    }
    return {
        "passed": all(checks.values()),
        "checks": checks,
        "actual": {"training_days": days, "matured_rows": rows, "securities": securities},
        "required": {
            "training_days": policy["minimum_training_days"],
            "matured_rows": policy["minimum_matured_rows"],
            "securities": policy["minimum_securities"],
        },
    }


def bounded_change(old: float, proposed: float, maximum_relative_change: float) -> float:
    limit = abs(old) * maximum_relative_change
    if limit == 0:
        limit = maximum_relative_change
    return round(min(old + limit, max(old - limit, proposed)), 6)


def _proposal(
    active: dict[str, Any],
    importances: dict[str, float],
    policy: dict[str, Any],
) -> dict[str, Any]:
    old = dict(active.get("strategy_config", asdict(StrategyConfig())))
    maximum = float(policy["auto_apply"]["maximum_relative_change"])
    quality_signal = importances.get("quality_score", 0.0)
    technical_signal = importances.get("technical_score", 0.0)
    completeness_signal = importances.get("completeness", 0.0)
    trap_signal = importances.get("trap_risk", 0.0)
    changes = {
        "buy_quality": bounded_change(
            float(old["buy_quality"]),
            float(old["buy_quality"]) + 4 * quality_signal,
            maximum,
        ),
        "buy_technical": bounded_change(
            float(old["buy_technical"]),
            float(old["buy_technical"]) + 4 * technical_signal,
            maximum,
        ),
        "buy_completeness": bounded_change(
            float(old["buy_completeness"]),
            float(old["buy_completeness"]) + 3 * completeness_signal,
            maximum,
        ),
        "buy_max_trap": bounded_change(
            float(old["buy_max_trap"]),
            float(old["buy_max_trap"]) - 4 * trap_signal,
            maximum,
        ),
    }
    proposed = {**old, **changes}
    rows = [
        {
            "parameter": key,
            "old": old[key],
            "new": value,
            "relative_change": 0.0
            if float(old[key]) == 0
            else (float(value) / float(old[key]) - 1.0),
        }
        for key, value in changes.items()
        if float(value) != float(old[key])
    ]
    return {"strategy_config": proposed, "changes": rows}


def train_adaptive_model(root: Path) -> dict[str, Any]:
    config_dir = root / "config"
    data_dir = root / "web" / "data" / "adaptive-learning"
    policy = _load(config_dir / "ai-learning-policy.json", {})
    active = _load(
        config_dir / "adaptive-paper-strategy.json",
        {"strategy_config": asdict(StrategyConfig()), "version": 1},
    )
    rows = _read_jsonl(data_dir / "feature-history.jsonl")
    frame = pd.DataFrame(
        [row for row in rows if _number(row.get("forward_return_1d_pct")) is not None]
    )
    gates = _training_gates(frame, policy)
    generated_at = dt.datetime.now(dt.UTC).isoformat()
    result: dict[str, Any] = {
        "schema_version": 1,
        "generated_at": generated_at,
        "mode": policy.get("mode", "proposal_only"),
        "status": "collecting_data",
        "paper_only": True,
        "gates": gates,
        "engine": None,
        "oos": None,
        "feature_importance": {"Fundamental": [], "Technical": []},
        "proposal": None,
        "applied": False,
        "active_config_version": active.get("version", 1),
        "rollback": {"checked": False, "triggered": False},
        "warnings": [],
    }
    if not gates["passed"]:
        result["warnings"].append(
            "学習に必要な履歴が不足しています。現在は特徴量と翌営業日リターンの収集中です。"
        )
        _write(data_dir / "latest.json", result)
        _write(data_dir / "proposals.json", {"proposals": []})
        return result

    frame["date"] = frame["date"].astype(str)
    splits = purged_date_splits(
        frame["date"].tolist(),
        int(policy["train_days"]),
        int(policy["test_days"]),
        int(policy["purge_days"]),
    )
    predictions: list[pd.DataFrame] = []
    coefficients: list[np.ndarray] = []
    engines: list[str] = []
    for train_dates, test_dates in splits:
        train = frame.loc[frame["date"].isin(train_dates)].copy()
        test = frame.loc[frame["date"].isin(test_dates)].copy()
        if train.empty or test.empty:
            continue
        predicted, coefficient, engine = _fit_predict(
            train,
            test,
            int(policy.get("random_seed", 42)),
        )
        test["prediction"] = predicted
        predictions.append(test)
        coefficients.append(coefficient)
        engines.append(engine)
    if not predictions:
        result["status"] = "insufficient_oos_history"
        result["warnings"].append("Purged OOS foldを作成できませんでした。")
        _write(data_dir / "latest.json", result)
        _write(data_dir / "proposals.json", {"proposals": []})
        return result

    oos = pd.concat(predictions, ignore_index=True)
    model_returns = _daily_returns(
        oos,
        "prediction",
        float(policy.get("top_fraction", 0.3)),
    )
    oos["equal_score"] = 1.0
    baseline_returns = _daily_returns(oos, "equal_score", 1.0)
    oos["current_score"] = (
        pd.to_numeric(oos["fundamental_score"], errors="coerce").fillna(0) * 0.5
        + pd.to_numeric(oos["technical_score"], errors="coerce").fillna(0) * 0.5
    )
    current_returns = _daily_returns(
        oos,
        "current_score",
        float(policy.get("top_fraction", 0.3)),
    )
    model_metrics = _metrics(model_returns)
    baseline_metrics = _metrics(baseline_returns)
    current_metrics = _metrics(current_returns)
    average_coefficients = np.mean(np.abs(np.stack(coefficients)), axis=0)
    total_importance = float(average_coefficients.sum()) or 1.0
    normalized = average_coefficients / total_importance
    importance = {
        name: float(value) for name, value in zip(FEATURE_NAMES, normalized, strict=True)
    }
    fundamental_rows = sorted(
        [
            {"feature": key, "importance": value}
            for key, value in importance.items()
            if key in FUNDAMENTAL_FEATURES
        ],
        key=lambda row: row["importance"],
        reverse=True,
    )
    technical_rows = sorted(
        [
            {"feature": key, "importance": value}
            for key, value in importance.items()
            if key in TECHNICAL_FEATURES
        ],
        key=lambda row: row["importance"],
        reverse=True,
    )
    top_features_by_fold = []
    for coefficient in coefficients:
        top = np.argsort(np.abs(coefficient))[-5:]
        top_features_by_fold.append(set(int(index) for index in top))
    common = set.intersection(*top_features_by_fold) if top_features_by_fold else set()
    stability = len(common) / 5.0 if top_features_by_fold else 0.0
    sharpe_improvement = (
        None
        if model_metrics["sharpe"] is None or current_metrics["sharpe"] is None
        else model_metrics["sharpe"] - current_metrics["sharpe"]
    )
    return_advantage = (
        (model_metrics["total_return_pct"] or 0)
        - (current_metrics["total_return_pct"] or 0)
    )
    drawdown_not_worse = (
        model_metrics["max_drawdown_pct"] is not None
        and current_metrics["max_drawdown_pct"] is not None
        and model_metrics["max_drawdown_pct"] >= current_metrics["max_drawdown_pct"]
    )
    confidence = min(
        1.0,
        len(predictions) / max(1, int(policy["minimum_oos_folds"])) * 0.35
        + len(model_returns) / max(1, int(policy["minimum_oos_days"])) * 0.35
        + stability * 0.30,
    )
    auto = policy["auto_apply"]
    apply_gates = {
        "oos_folds": len(predictions) >= int(policy["minimum_oos_folds"]),
        "oos_days": len(model_returns) >= int(policy["minimum_oos_days"]),
        "confidence": confidence >= float(auto["minimum_confidence"]),
        "sharpe_improvement": sharpe_improvement is not None
        and sharpe_improvement >= float(auto["minimum_sharpe_improvement"]),
        "return_floor": return_advantage
        >= -float(auto["maximum_total_return_disadvantage_pct"]),
        "drawdown_not_worse": drawdown_not_worse,
        "parameter_stability": stability >= float(auto["minimum_parameter_stability"]),
    }
    proposal = _proposal(active, importance, policy)
    result.update(
        {
            "status": "proposal_ready",
            "engine": sorted(set(engines)),
            "oos": {
                "folds": len(predictions),
                "days": len(model_returns),
                "model": model_metrics,
                "current_strategy": current_metrics,
                "equal_weight": baseline_metrics,
                "sharpe_improvement": sharpe_improvement,
                "return_advantage_pct": return_advantage,
                "parameter_stability": stability,
                "confidence": confidence,
                "apply_gates": apply_gates,
            },
            "feature_importance": {
                "Fundamental": fundamental_rows,
                "Technical": technical_rows,
            },
            "proposal": proposal,
        }
    )
    should_apply = (
        policy.get("mode") == "guarded_auto"
        and all(apply_gates.values())
        and bool(proposal["changes"])
    )
    if should_apply:
        versions = list(active.get("versions", []))[-9:]
        versions.append(
            {
                "version": active.get("version", 1),
                "strategy_config": active.get("strategy_config", {}),
                "ended_at": generated_at,
            }
        )
        updated = {
            **active,
            "version": int(active.get("version", 1)) + 1,
            "status": "active",
            "approved": True,
            "updated_at": generated_at,
            "strategy_config": proposal["strategy_config"],
            "feature_weights": {
                "fundamental": sum(importance[name] for name in FUNDAMENTAL_FEATURES),
                "technical": sum(importance[name] for name in TECHNICAL_FEATURES),
            },
            "versions": versions,
            "pending_evaluation": {
                "applied_at": generated_at,
                "old_config": active.get("strategy_config", {}),
                "new_config": proposal["strategy_config"],
                "evaluation_days": policy["rollback"]["evaluation_days"],
            },
        }
        _write(config_dir / "adaptive-paper-strategy.json", updated)
        result["status"] = "applied_to_paper_strategy"
        result["applied"] = True
        result["active_config_version"] = updated["version"]
    elif policy.get("mode") == "guarded_auto":
        result["warnings"].append(
            "Guardrailをすべて満たしていないためデモ戦略は変更していません。"
        )
    history_payload = _load(data_dir / "history.json", {"history": []})
    history = list(history_payload.get("history", []))
    history.append(
        {
            "generated_at": generated_at,
            "status": result["status"],
            "applied": result["applied"],
            "active_config_version": result["active_config_version"],
            "oos": result.get("oos"),
        }
    )
    _write(data_dir / "history.json", {"history": history[-100:]})
    _write(data_dir / "latest.json", result)
    _write(
        data_dir / "proposals.json",
        {"proposals": [proposal] if proposal["changes"] else []},
    )
    return result


def load_strategy_config(root: Path) -> tuple[StrategyConfig, int, str]:
    payload = _load(root / "config" / "adaptive-paper-strategy.json", {})
    if payload.get("status") != "active" or payload.get("approved") is not True:
        return StrategyConfig(), int(payload.get("version", 1)), "default_guarded"
    allowed = set(StrategyConfig.__dataclass_fields__)
    values = {
        key: value
        for key, value in payload.get("strategy_config", {}).items()
        if key in allowed
    }
    return StrategyConfig(**values), int(payload.get("version", 1)), "adaptive_approved"


def run_guarded_daily_monitor(
    root: Path,
    execute_simulation: bool = False,
    trading_date: dt.date | None = None,
) -> dict[str, Any]:
    config, version, source = load_strategy_config(root)
    report = run_monitor(
        root,
        execute_simulation=execute_simulation,
        trading_date=trading_date,
        config=config,
    )
    report["adaptive_strategy"] = {
        "config_version": version,
        "source": source,
        "paper_only": True,
    }
    report_path = root / "web" / "data" / "paper-trading" / "latest-report.json"
    _write(report_path, report)
    daily_path = (
        root
        / "web"
        / "data"
        / "paper-trading"
        / "daily-reports"
        / f"{report['trading_date']}.json"
    )
    if daily_path.exists():
        _write(daily_path, report)
    collect_feature_history(root, report)
    return report


def build_parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(description="Guarded adaptive paper strategy learner")
    subparsers = parser.add_subparsers(dest="command", required=True)
    daily = subparsers.add_parser("daily-monitor")
    daily.add_argument("--root", type=Path, default=Path.cwd())
    daily.add_argument("--execute-simulation", action="store_true")
    daily.add_argument("--date", type=dt.date.fromisoformat)
    collect = subparsers.add_parser("collect")
    collect.add_argument("--root", type=Path, default=Path.cwd())
    train = subparsers.add_parser("train")
    train.add_argument("--root", type=Path, default=Path.cwd())
    return parser


def main(argv: list[str] | None = None) -> int:
    args = build_parser().parse_args(argv)
    if args.command == "daily-monitor":
        report = run_guarded_daily_monitor(
            args.root,
            execute_simulation=args.execute_simulation,
            trading_date=args.date,
        )
        print(
            json.dumps(
                {
                    "trading_date": report["trading_date"],
                    "equity": report["summary"]["equity"],
                    "total_pnl": report["summary"]["total_pnl"],
                    "adaptive_strategy": report["adaptive_strategy"],
                },
                ensure_ascii=False,
            )
        )
        return 0
    if args.command == "collect":
        print(json.dumps(collect_feature_history(args.root), ensure_ascii=False))
        return 0
    result = train_adaptive_model(args.root)
    print(
        json.dumps(
            {
                "status": result["status"],
                "gates": result["gates"],
                "applied": result["applied"],
                "config_version": result["active_config_version"],
            },
            ensure_ascii=False,
        )
    )
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
