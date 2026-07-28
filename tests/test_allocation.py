import numpy as np
import pandas as pd

from investment_audit.allocation import HRPConfig, hrp_weights
from investment_audit.portfolio import RankedPortfolioConfig, run_ranked_portfolio


def make_returns(periods: int = 260) -> pd.DataFrame:
    rng = np.random.default_rng(42)
    common = rng.normal(0.0003, 0.008, periods)
    return pd.DataFrame(
        {
            "A": common + rng.normal(0, 0.002, periods),
            "B": common + rng.normal(0, 0.003, periods),
            "C": rng.normal(0.0002, 0.012, periods),
            "D": rng.normal(0.0001, 0.02, periods),
        },
        index=pd.date_range("2024-01-01", periods=periods, freq="B"),
    )


def test_hrp_weights_sum_to_one_and_respect_cap() -> None:
    weights = hrp_weights(make_returns(), HRPConfig(minimum_history=60, max_position=0.4))
    assert np.isclose(weights.sum(), 1.0)
    assert (weights >= 0).all()
    assert weights.max() <= 0.4 + 1e-9


def test_hrp_drops_constant_asset() -> None:
    returns = make_returns()
    returns["CONST"] = 0.0
    weights = hrp_weights(returns)
    assert "CONST" not in weights.index


def test_future_prices_do_not_change_past_hrp_weights() -> None:
    returns = make_returns(400)
    prices = 100 * (1 + returns).cumprod()
    scores = pd.DataFrame(1.0, index=prices.index, columns=prices.columns)
    config = RankedPortfolioConfig(top_n=4, weighting="hrp", hrp_minimum_history=60)
    first = run_ranked_portfolio(prices, scores, config)
    cutoff = prices.index[250]
    changed = prices.copy()
    changed.loc[changed.index > cutoff, "D"] *= 10
    second = run_ranked_portfolio(changed, scores, config)
    pd.testing.assert_frame_equal(first.weights.loc[:cutoff], second.weights.loc[:cutoff])
