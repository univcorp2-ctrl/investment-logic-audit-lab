from __future__ import annotations

from dataclasses import dataclass

import numpy as np
import pandas as pd
from scipy.cluster.hierarchy import leaves_list, linkage
from scipy.spatial.distance import squareform


@dataclass(frozen=True)
class HRPConfig:
    method: str = "single"
    minimum_history: int = 60
    max_position: float = 1.0
    regularization: float = 1e-8


def _cluster_variance(covariance: pd.DataFrame, assets: list[str]) -> float:
    sub = covariance.loc[assets, assets]
    diagonal = np.diag(sub.to_numpy(dtype=float))
    inverse = np.divide(1.0, diagonal, out=np.zeros_like(diagonal), where=diagonal > 0)
    if inverse.sum() <= 0:
        weights = np.full(len(assets), 1.0 / len(assets))
    else:
        weights = inverse / inverse.sum()
    return float(weights @ sub.to_numpy(dtype=float) @ weights)


def _recursive_bisection(covariance: pd.DataFrame, ordered_assets: list[str]) -> pd.Series:
    weights = pd.Series(1.0, index=ordered_assets, dtype=float)
    clusters: list[list[str]] = [ordered_assets]
    while clusters:
        next_clusters: list[list[str]] = []
        for cluster in clusters:
            if len(cluster) <= 1:
                continue
            split = len(cluster) // 2
            left, right = cluster[:split], cluster[split:]
            left_var = _cluster_variance(covariance, left)
            right_var = _cluster_variance(covariance, right)
            denominator = left_var + right_var
            alpha = 0.5 if denominator <= 0 else 1.0 - left_var / denominator
            weights.loc[left] *= alpha
            weights.loc[right] *= 1.0 - alpha
            next_clusters.extend([left, right])
        clusters = next_clusters
    return weights


def _apply_cap(weights: pd.Series, cap: float) -> pd.Series:
    if not 0 < cap <= 1:
        raise ValueError("max_position must be in (0, 1]")
    if len(weights) * cap < 1.0 - 1e-9:
        raise ValueError("max_position is infeasible for the number of assets")
    result = weights.clip(lower=0.0)
    result = result / result.sum()
    for _ in range(100):
        excess = (result - cap).clip(lower=0.0).sum()
        result = result.clip(upper=cap)
        if excess <= 1e-12:
            break
        eligible = result < cap - 1e-12
        if not eligible.any():
            break
        base = result.loc[eligible]
        if base.sum() <= 0:
            result.loc[eligible] += excess / eligible.sum()
        else:
            result.loc[eligible] += excess * base / base.sum()
    return result / result.sum()


def hrp_weights(returns: pd.DataFrame, config: HRPConfig | None = None) -> pd.Series:
    config = config or HRPConfig()
    clean = returns.apply(pd.to_numeric, errors="coerce").replace([np.inf, -np.inf], np.nan)
    clean = clean.dropna(how="all")
    usable = clean.columns[clean.count() >= config.minimum_history]
    clean = clean.loc[:, usable]
    variance = clean.var(ddof=1)
    clean = clean.loc[:, variance.index[variance > config.regularization]]
    if clean.shape[1] == 0:
        return pd.Series(dtype=float)
    if clean.shape[1] == 1:
        return pd.Series(1.0, index=clean.columns, dtype=float)
    clean = clean.fillna(clean.mean())
    covariance = clean.cov()
    covariance = covariance + np.eye(len(covariance)) * config.regularization
    correlation = clean.corr().clip(-1.0, 1.0).fillna(0.0)
    distance = np.sqrt(np.clip((1.0 - correlation.to_numpy(dtype=float)) / 2.0, 0.0, 1.0))
    np.fill_diagonal(distance, 0.0)
    condensed = squareform(distance, checks=False)
    tree = linkage(condensed, method=config.method)
    order = leaves_list(tree)
    ordered_assets = [str(clean.columns[position]) for position in order]
    covariance.index = covariance.index.astype(str)
    covariance.columns = covariance.columns.astype(str)
    weights = _recursive_bisection(covariance, ordered_assets)
    return _apply_cap(weights, config.max_position).sort_index()
