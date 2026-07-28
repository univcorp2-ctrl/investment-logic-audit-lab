import numpy as np
import pandas as pd

from investment_audit.factor_diagnostics import analyze_factor, compute_forward_returns


def make_factor_panel() -> tuple[pd.DataFrame, pd.DataFrame]:
    index = pd.date_range("2024-01-01", periods=100, freq="B", tz="Asia/Tokyo")
    symbols = [f"S{i}" for i in range(10)]
    base = np.arange(1, 11, dtype=float)
    scores = pd.DataFrame([base + day * 0.01 for day in range(len(index))], index=index, columns=symbols)
    daily = pd.DataFrame([base * 0.0002 + 0.0001 for _ in index], index=index, columns=symbols)
    prices = 100 * (1 + daily).cumprod()
    return scores, prices


def test_positive_factor_has_positive_ic_and_spread() -> None:
    scores, prices = make_factor_panel()
    result = analyze_factor(scores, prices, horizons=(1, 5), quantiles=5)
    assert result.summary.loc[1, "mean_ic"] > 0.9
    assert result.summary.loc[5, "top_bottom_spread"] > 0
    assert result.summary.loc[1, "monotonicity_score"] > 90


def test_constant_factor_returns_nan_ic_without_warning() -> None:
    scores, prices = make_factor_panel()
    scores.loc[:, :] = 1.0
    result = analyze_factor(scores, prices, horizons=(1,), quantiles=5)
    assert np.isnan(result.summary.loc[1, "mean_ic"])


def test_turnover_and_rank_autocorrelation_are_bounded() -> None:
    scores, prices = make_factor_panel()
    scores.iloc[50:, :] = scores.iloc[50:, ::-1].to_numpy()
    result = analyze_factor(scores, prices, horizons=(1,), quantiles=5)
    assert result.turnover.dropna().ge(0).all().all()
    assert result.turnover.dropna().le(1).all().all()
    assert result.rank_autocorrelation.dropna().between(-1, 1).all()


def test_group_neutralization_changes_sector_driven_ic() -> None:
    scores, prices = make_factor_panel()
    groups = pd.Series({f"S{i}": "A" if i < 5 else "B" for i in range(10)})
    neutral = analyze_factor(scores, prices, horizons=(1,), groups=groups, group_neutral=True)
    plain = analyze_factor(scores, prices, horizons=(1,), groups=groups, group_neutral=False)
    assert neutral.summary.loc[1, "mean_ic"] <= plain.summary.loc[1, "mean_ic"]


def test_forward_returns_use_future_price_only_for_evaluation() -> None:
    _, prices = make_factor_panel()
    forward = compute_forward_returns(prices, horizons=(5,))[5]
    expected = prices.iloc[5] / prices.iloc[0] - 1
    pd.testing.assert_series_equal(forward.iloc[0], expected, check_names=False)
