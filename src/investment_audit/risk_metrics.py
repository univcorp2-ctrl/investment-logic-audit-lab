from __future__ import annotations

import numpy as np
import pandas as pd


def _clean(returns: pd.Series) -> pd.Series:
    return pd.to_numeric(returns, errors="coerce").replace([np.inf, -np.inf], np.nan).dropna()


def ulcer_index(returns: pd.Series) -> float:
    clean = _clean(returns)
    if clean.empty:
        return float("nan")
    equity = (1.0 + clean).cumprod()
    drawdown = equity / equity.cummax() - 1.0
    return float(np.sqrt(drawdown.pow(2).mean()))


def gain_to_pain_ratio(returns: pd.Series) -> float:
    clean = _clean(returns)
    losses = clean.loc[clean < 0].sum()
    if clean.empty or losses >= 0:
        return float("nan")
    return float(clean.loc[clean > 0].sum() / abs(losses))


def recovery_factor(returns: pd.Series) -> float:
    clean = _clean(returns)
    if clean.empty:
        return float("nan")
    equity = (1.0 + clean).cumprod()
    total_return = float(equity.iloc[-1] - 1.0)
    drawdown = float((equity / equity.cummax() - 1.0).min())
    return total_return / abs(drawdown) if drawdown < 0 else float("nan")


def tail_ratio(returns: pd.Series, quantile: float = 0.95) -> float:
    clean = _clean(returns)
    if clean.empty or not 0.5 < quantile < 1.0:
        return float("nan")
    upper = float(clean.quantile(quantile))
    lower = float(clean.quantile(1.0 - quantile))
    return upper / abs(lower) if lower < 0 else float("nan")


def omega_ratio(returns: pd.Series, threshold: float = 0.0) -> float:
    clean = _clean(returns)
    if clean.empty:
        return float("nan")
    excess = clean - threshold
    downside = float(excess.loc[excess < 0].sum())
    if downside >= 0:
        return float("nan")
    return float(excess.loc[excess > 0].sum() / abs(downside))


def conditional_value_at_risk(returns: pd.Series, confidence: float = 0.95) -> float:
    clean = _clean(returns)
    if clean.empty or not 0.0 < confidence < 1.0:
        return float("nan")
    cutoff = float(clean.quantile(1.0 - confidence))
    tail = clean.loc[clean <= cutoff]
    return float(tail.mean()) if not tail.empty else float("nan")


def rolling_stability(returns: pd.Series, window: int = 63) -> float:
    clean = _clean(returns)
    if window < 2 or len(clean) < window:
        return float("nan")
    rolling = (1.0 + clean).rolling(window).apply(np.prod, raw=True) - 1.0
    rolling = rolling.dropna()
    if rolling.empty:
        return float("nan")
    positive_ratio = float((rolling > 0).mean())
    dispersion = float(rolling.std(ddof=1)) if len(rolling) > 1 else 0.0
    return float(np.clip(positive_ratio / (1.0 + dispersion), 0.0, 1.0))


def extended_risk_metrics(returns: pd.Series) -> dict[str, float]:
    return {
        "ulcer_index": ulcer_index(returns),
        "gain_to_pain": gain_to_pain_ratio(returns),
        "recovery_factor": recovery_factor(returns),
        "tail_ratio": tail_ratio(returns),
        "omega_ratio": omega_ratio(returns),
        "cvar_95": conditional_value_at_risk(returns),
        "rolling_stability": rolling_stability(returns),
    }
