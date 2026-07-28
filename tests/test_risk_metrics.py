import math

import numpy as np
import pandas as pd

from investment_audit.risk_metrics import (
    conditional_value_at_risk,
    extended_risk_metrics,
    gain_to_pain_ratio,
    omega_ratio,
    recovery_factor,
    rolling_stability,
    tail_ratio,
    ulcer_index,
)


def test_risk_metrics_are_finite_for_mixed_returns() -> None:
    returns = pd.Series([0.01, -0.02, 0.015, -0.005, 0.008] * 30)
    values = extended_risk_metrics(returns)
    assert set(values) == {
        "ulcer_index",
        "gain_to_pain",
        "recovery_factor",
        "tail_ratio",
        "omega_ratio",
        "cvar_95",
        "rolling_stability",
    }
    assert all(np.isfinite(value) for value in values.values())
    assert values["cvar_95"] < 0


def test_undefined_denominators_return_nan() -> None:
    positive = pd.Series([0.01] * 100)
    assert math.isnan(gain_to_pain_ratio(positive))
    assert math.isnan(recovery_factor(positive))
    assert math.isnan(tail_ratio(positive))
    assert math.isnan(omega_ratio(positive))


def test_empty_and_short_inputs_are_safe() -> None:
    empty = pd.Series(dtype=float)
    assert math.isnan(ulcer_index(empty))
    assert math.isnan(conditional_value_at_risk(empty))
    assert math.isnan(rolling_stability(pd.Series([0.01, -0.01]), window=5))
