from __future__ import annotations

import json
from dataclasses import dataclass
from pathlib import Path
from typing import Mapping

import numpy as np
import pandas as pd

from .fundamentals import FundamentalConfig, score_fundamentals
from .technical import analyze_technical


@dataclass(frozen=True)
class ValueScreenConfig:
    fundamental_weight: float = 0.65
    technical_weight: float = 0.25
    liquidity_risk_weight: float = 0.10
    minimum_quality: float = 40.0
    maximum_value_trap_risk: float = 60.0
    minimum_data_completeness: float = 45.0
    minimum_liquidity_score: float = 20.0

    def __post_init__(self) -> None:
        total = self.fundamental_weight + self.technical_weight + self.liquidity_risk_weight
        if not np.isclose(total, 1.0):
            raise ValueError("screen weights must sum to 1.0")


def load_table(path: str | Path) -> pd.DataFrame:
    source = Path(path)
    suffix = source.suffix.lower()
    if suffix == ".csv":
        return pd.read_csv(source, index_col=0)
    if suffix in {".parquet", ".pq"}:
        try:
            return pd.read_parquet(source)
        except ImportError as exc:
            raise RuntimeError("Parquet support requires the optional 'parquet' extra") from exc
    raise ValueError(f"unsupported input format: {source.suffix}")


def _percentile(values: pd.Series) -> pd.Series:
    numeric = pd.to_numeric(values, errors="coerce").replace([np.inf, -np.inf], np.nan)
    valid = numeric.dropna()
    result = pd.Series(np.nan, index=numeric.index, dtype=float)
    if valid.empty:
        return result
    if valid.nunique() <= 1:
        result.loc[valid.index] = 50.0
    else:
        result.loc[valid.index] = valid.rank(method="average", pct=True) * 100.0
    return result


def _technical_snapshot(
    index: pd.Index,
    price_history: Mapping[str, pd.DataFrame] | None,
    technical_scores: pd.Series | pd.DataFrame | None,
) -> pd.DataFrame:
    snapshot = pd.DataFrame(index=index)
    snapshot["technical_score"] = 50.0
    snapshot["technical_risk_score"] = 50.0
    if technical_scores is not None:
        if isinstance(technical_scores, pd.Series):
            snapshot["technical_score"] = technical_scores.reindex(index)
        else:
            for column in ("technical_score", "risk_score", "average_dollar_volume_20d"):
                if column in technical_scores.columns:
                    target = "technical_risk_score" if column == "risk_score" else column
                    snapshot[target] = technical_scores[column].reindex(index)
    if price_history:
        for symbol in index.astype(str):
            history = price_history.get(symbol)
            if history is None or history.empty:
                continue
            technical = analyze_technical(history)
            usable = technical.dropna(subset=["decision_score"])
            if usable.empty:
                continue
            latest = usable.iloc[-1]
            snapshot.loc[symbol, "technical_score"] = latest["decision_score"]
            snapshot.loc[symbol, "technical_risk_score"] = latest["risk_score"]
            snapshot.loc[symbol, "average_dollar_volume_20d"] = latest[
                "average_dollar_volume_20d"
            ]
    return snapshot


def screen_value_stocks(
    fundamentals: pd.DataFrame,
    price_history: Mapping[str, pd.DataFrame] | None = None,
    technical_scores: pd.Series | pd.DataFrame | None = None,
    config: ValueScreenConfig | None = None,
    fundamental_config: FundamentalConfig | None = None,
) -> pd.DataFrame:
    """Rank value candidates while filtering low-quality and high-risk names."""

    if fundamentals.empty:
        return pd.DataFrame(index=fundamentals.index)
    config = config or ValueScreenConfig()
    source = fundamentals.copy()
    source.index = source.index.astype(str)
    scored = score_fundamentals(source, fundamental_config)
    technical = _technical_snapshot(scored.index, price_history, technical_scores)

    liquidity_source = pd.Series(np.nan, index=scored.index, dtype=float)
    for column in (
        "average_daily_value",
        "avg_daily_value",
        "average_dollar_volume_20d",
        "market_cap",
    ):
        if column in source.columns:
            liquidity_source = liquidity_source.combine_first(
                pd.to_numeric(source[column], errors="coerce")
            )
    liquidity_source = liquidity_source.combine_first(technical.get("average_dollar_volume_20d"))
    liquidity_score = _percentile(liquidity_source).fillna(50.0)
    risk_control = technical["technical_risk_score"].fillna(50.0)
    liquidity_risk = (liquidity_score * 0.70 + risk_control * 0.30).clip(0.0, 100.0)

    result = pd.concat([scored, technical], axis=1)
    result["liquidity_score"] = liquidity_score
    result["liquidity_risk_score"] = liquidity_risk
    result["overall_score"] = (
        result["undervaluation_score"].fillna(0.0) * config.fundamental_weight
        + result["technical_score"].fillna(50.0) * config.technical_weight
        + result["liquidity_risk_score"].fillna(50.0) * config.liquidity_risk_weight
    ).clip(0.0, 100.0)
    result["eligible"] = (
        (result["quality_score"] >= config.minimum_quality)
        & (result["value_trap_risk"] <= config.maximum_value_trap_risk)
        & (result["data_completeness"] >= config.minimum_data_completeness)
        & (result["liquidity_score"] >= config.minimum_liquidity_score)
    )
    result["filter_reasons"] = [
        json.dumps(
            [
                reason
                for condition, reason in (
                    (row["quality_score"] < config.minimum_quality, "品質スコア不足"),
                    (row["value_trap_risk"] > config.maximum_value_trap_risk, "バリュートラップ懸念"),
                    (
                        row["data_completeness"] < config.minimum_data_completeness,
                        "データ充足率不足",
                    ),
                    (row["liquidity_score"] < config.minimum_liquidity_score, "流動性不足"),
                )
                if bool(condition)
            ],
            ensure_ascii=False,
        )
        for _, row in result.iterrows()
    ]
    result = result.sort_values(["eligible", "overall_score"], ascending=[False, False])
    result["rank"] = np.arange(1, len(result) + 1)
    return result


def write_screen_results(
    result: pd.DataFrame,
    output: str | Path,
    json_output: str | Path | None = None,
) -> dict[str, Path]:
    destination = Path(output)
    destination.parent.mkdir(parents=True, exist_ok=True)
    if destination.suffix.lower() == ".csv":
        result.to_csv(destination, index=True)
    elif destination.suffix.lower() in {".parquet", ".pq"}:
        try:
            result.to_parquet(destination, index=True)
        except ImportError as exc:
            raise RuntimeError("Parquet support requires the optional 'parquet' extra") from exc
    else:
        raise ValueError("output must be .csv or .parquet")
    outputs = {"ranking": destination}
    if json_output is not None:
        json_path = Path(json_output)
        json_path.parent.mkdir(parents=True, exist_ok=True)
        json_path.write_text(result.reset_index(names="symbol").to_json(orient="records", force_ascii=False), encoding="utf-8")
        outputs["json"] = json_path
    return outputs
