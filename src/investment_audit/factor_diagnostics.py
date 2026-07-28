from __future__ import annotations

from dataclasses import dataclass
from pathlib import Path

import numpy as np
import pandas as pd


@dataclass(frozen=True)
class FactorDiagnosticsResult:
    forward_returns: dict[int, pd.DataFrame]
    information_coefficient: pd.DataFrame
    quantile_returns: pd.DataFrame
    turnover: pd.DataFrame
    rank_autocorrelation: pd.Series
    summary: pd.DataFrame


def _clean_wide(frame: pd.DataFrame, name: str) -> pd.DataFrame:
    if frame.empty:
        raise ValueError(f"{name} must not be empty")
    cleaned = frame.copy()
    index = pd.DatetimeIndex(pd.to_datetime(cleaned.index, errors="coerce", utc=True))
    cleaned.index = index.tz_convert(None)
    cleaned = cleaned.iloc[np.flatnonzero(cleaned.index.notna())]
    cleaned = cleaned.iloc[np.flatnonzero(~cleaned.index.duplicated(keep="last"))]
    cleaned = cleaned.sort_index().apply(pd.to_numeric, errors="coerce")
    return cleaned.replace([np.inf, -np.inf], np.nan)


def compute_forward_returns(
    prices: pd.DataFrame,
    horizons: tuple[int, ...] = (1, 5, 21, 63),
) -> dict[int, pd.DataFrame]:
    clean = _clean_wide(prices, "prices").ffill()
    if any(horizon < 1 for horizon in horizons):
        raise ValueError("horizons must contain positive integers")
    return {
        horizon: (clean.shift(-horizon) / clean - 1.0).replace([np.inf, -np.inf], np.nan)
        for horizon in horizons
    }


def _neutralize_by_group(values: pd.DataFrame, groups: pd.Series | None) -> pd.DataFrame:
    if groups is None:
        return values
    aligned = groups.reindex(values.columns).fillna("__UNKNOWN__").astype(str)
    output = values.copy()
    for group_name in aligned.unique():
        columns = aligned.index[aligned == group_name]
        if len(columns) > 1:
            output.loc[:, columns] = output.loc[:, columns].sub(
                output.loc[:, columns].mean(axis="columns"), axis="index"
            )
    return output


def _daily_spearman(scores: pd.DataFrame, forward: pd.DataFrame) -> pd.Series:
    rows: list[float] = []
    dates: list[pd.Timestamp] = []
    for date in scores.index.intersection(forward.index):
        pair = pd.concat([scores.loc[date], forward.loc[date]], axis="columns").dropna()
        if len(pair) < 3 or pair.iloc[:, 0].nunique() < 2 or pair.iloc[:, 1].nunique() < 2:
            value = float("nan")
        else:
            value = float(pair.iloc[:, 0].corr(pair.iloc[:, 1], method="spearman"))
        dates.append(pd.Timestamp(date))
        rows.append(value)
    return pd.Series(rows, index=pd.DatetimeIndex(dates), dtype=float)


def _quantiles(scores: pd.DataFrame, quantiles: int) -> pd.DataFrame:
    if quantiles < 2:
        raise ValueError("quantiles must be at least 2")

    def assign(row: pd.Series) -> pd.Series:
        valid = row.dropna()
        output = pd.Series(np.nan, index=row.index, dtype=float)
        if len(valid) < quantiles or valid.nunique() < 2:
            return output
        ranks = valid.rank(method="first", pct=True)
        output.loc[valid.index] = np.ceil(ranks * quantiles).clip(1, quantiles)
        return output

    return scores.apply(assign, axis="columns")


def _turnover(quantile_frame: pd.DataFrame, quantile: int, period: int = 1) -> pd.Series:
    memberships: list[set[str]] = []
    for _, row in quantile_frame.iterrows():
        memberships.append(set(row.index[row == quantile].astype(str)))
    values: list[float] = []
    for position, current in enumerate(memberships):
        if position < period or not current:
            values.append(float("nan"))
            continue
        previous = memberships[position - period]
        values.append(len(current - previous) / len(current))
    return pd.Series(values, index=quantile_frame.index, dtype=float)


def _rank_autocorrelation(scores: pd.DataFrame, period: int = 1) -> pd.Series:
    ranks = scores.rank(axis="columns", method="average", pct=True)
    values: list[float] = []
    for position in range(len(ranks)):
        if position < period:
            values.append(float("nan"))
            continue
        pair = pd.concat([ranks.iloc[position], ranks.iloc[position - period]], axis="columns").dropna()
        if len(pair) < 3 or pair.iloc[:, 0].nunique() < 2 or pair.iloc[:, 1].nunique() < 2:
            values.append(float("nan"))
        else:
            values.append(float(pair.iloc[:, 0].corr(pair.iloc[:, 1], method="spearman")))
    return pd.Series(values, index=ranks.index, name="rank_autocorrelation", dtype=float)


def _monotonicity(quantile_means: pd.Series) -> float:
    clean = quantile_means.dropna()
    if len(clean) < 3 or clean.nunique() < 2:
        return float("nan")
    ordering = pd.Series(clean.index.astype(float), index=clean.index)
    correlation = clean.corr(ordering, method="spearman")
    return float(np.clip((correlation + 1.0) * 50.0, 0.0, 100.0))


def analyze_factor(
    scores: pd.DataFrame,
    prices: pd.DataFrame,
    horizons: tuple[int, ...] = (1, 5, 21, 63),
    quantiles: int = 5,
    groups: pd.Series | None = None,
    group_neutral: bool = False,
) -> FactorDiagnosticsResult:
    clean_scores = _clean_wide(scores, "scores")
    clean_prices = _clean_wide(prices, "prices")
    columns = clean_scores.columns.intersection(clean_prices.columns)
    index = clean_scores.index.intersection(clean_prices.index)
    if len(columns) < 3 or len(index) < 3:
        raise ValueError("factor diagnostics require at least 3 symbols and 3 dates")
    clean_scores = clean_scores.reindex(index=index, columns=columns)
    clean_prices = clean_prices.reindex(index=index, columns=columns).ffill()
    forward_returns = compute_forward_returns(clean_prices, horizons)
    quantile_frame = _quantiles(clean_scores, quantiles)

    ic_columns: dict[str, pd.Series] = {}
    quantile_tables: list[pd.DataFrame] = []
    summary_rows: list[dict[str, float | int]] = []
    for horizon in horizons:
        forward = forward_returns[horizon]
        evaluated = _neutralize_by_group(forward, groups) if group_neutral else forward
        ic = _daily_spearman(clean_scores, evaluated)
        ic_columns[f"{horizon}d"] = ic
        long = pd.DataFrame(
            {
                "score": clean_scores.stack(dropna=False),
                "quantile": quantile_frame.stack(dropna=False),
                "forward_return": evaluated.stack(dropna=False),
            }
        ).dropna()
        long.index.names = ["date", "symbol"]
        if long.empty:
            q_returns = pd.DataFrame(columns=["date", "quantile", "mean_return", "horizon"])
            mean_by_quantile = pd.Series(dtype=float)
        else:
            q_returns = (
                long.reset_index()
                .groupby(["date", "quantile"], as_index=False)["forward_return"]
                .mean()
                .rename(columns={"forward_return": "mean_return"})
            )
            q_returns["horizon"] = horizon
            mean_by_quantile = q_returns.groupby("quantile")["mean_return"].mean()
        quantile_tables.append(q_returns)
        valid_ic = ic.dropna()
        mean_ic = float(valid_ic.mean()) if not valid_ic.empty else float("nan")
        ic_std = float(valid_ic.std(ddof=1)) if len(valid_ic) > 1 else float("nan")
        icir = mean_ic / ic_std if np.isfinite(ic_std) and ic_std > 0 else float("nan")
        spread = (
            float(mean_by_quantile.get(float(quantiles), np.nan) - mean_by_quantile.get(1.0, np.nan))
            if not mean_by_quantile.empty
            else float("nan")
        )
        summary_rows.append(
            {
                "horizon": horizon,
                "mean_ic": mean_ic,
                "icir": icir,
                "positive_ic_ratio": float((valid_ic > 0).mean()) if not valid_ic.empty else float("nan"),
                "top_bottom_spread": spread,
                "monotonicity_score": _monotonicity(mean_by_quantile),
                "observations": int(valid_ic.count()),
            }
        )

    information_coefficient = pd.DataFrame(ic_columns)
    quantile_returns = pd.concat(quantile_tables, ignore_index=True)
    turnover = pd.DataFrame(
        {
            "top_quantile_turnover": _turnover(quantile_frame, quantiles),
            "bottom_quantile_turnover": _turnover(quantile_frame, 1),
        }
    )
    rank_autocorrelation = _rank_autocorrelation(clean_scores)
    summary = pd.DataFrame(summary_rows).set_index("horizon")
    summary["mean_top_turnover"] = turnover["top_quantile_turnover"].mean()
    summary["mean_bottom_turnover"] = turnover["bottom_quantile_turnover"].mean()
    summary["mean_rank_autocorrelation"] = rank_autocorrelation.mean()
    return FactorDiagnosticsResult(
        forward_returns=forward_returns,
        information_coefficient=information_coefficient,
        quantile_returns=quantile_returns,
        turnover=turnover,
        rank_autocorrelation=rank_autocorrelation,
        summary=summary,
    )


def write_factor_diagnostics(result: FactorDiagnosticsResult, out_dir: str | Path) -> dict[str, Path]:
    output = Path(out_dir)
    output.mkdir(parents=True, exist_ok=True)
    files = {
        "summary_csv": output / "factor-summary.csv",
        "summary_json": output / "factor-summary.json",
        "ic_csv": output / "information-coefficient.csv",
        "quantile_returns_csv": output / "quantile-returns.csv",
        "turnover_csv": output / "quantile-turnover.csv",
        "rank_autocorrelation_csv": output / "rank-autocorrelation.csv",
    }
    result.summary.to_csv(files["summary_csv"])
    result.summary.reset_index().to_json(files["summary_json"], orient="records", force_ascii=False)
    result.information_coefficient.to_csv(files["ic_csv"])
    result.quantile_returns.to_csv(files["quantile_returns_csv"], index=False)
    result.turnover.to_csv(files["turnover_csv"])
    result.rank_autocorrelation.to_csv(files["rank_autocorrelation_csv"])
    return files
