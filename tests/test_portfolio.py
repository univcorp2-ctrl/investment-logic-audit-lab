import numpy as np
import pandas as pd

from investment_audit.portfolio import RankedPortfolioConfig, robustness_summary, run_ranked_portfolio


def make_panel() -> tuple[pd.DataFrame, pd.DataFrame]:
    index = pd.date_range("2022-01-03", periods=520, freq="B")
    returns = pd.DataFrame(
        {
            "A": np.full(len(index), 0.0008),
            "B": np.full(len(index), 0.0003),
            "C": np.full(len(index), -0.0002),
        },
        index=index,
    )
    prices = 100.0 * (1.0 + returns).cumprod()
    scores = pd.DataFrame({"A": 90.0, "B": 60.0, "C": 10.0}, index=index)
    return prices, scores


def test_ranked_portfolio_selects_top_and_computes_metrics() -> None:
    prices, scores = make_panel()
    result = run_ranked_portfolio(
        prices,
        scores,
        RankedPortfolioConfig(top_n=1, cost_bps=0, slippage_bps=0),
    )
    invested = result.weights.sum(axis=1) > 0
    assert (result.weights.loc[invested, "A"] == 1.0).all()
    assert result.metrics["cagr"] > 0
    assert {"sortino", "calmar", "benchmark_excess_cagr"}.issubset(result.metrics)


def test_future_scores_do_not_change_past_weights() -> None:
    prices, scores = make_panel()
    first = run_ranked_portfolio(prices, scores, RankedPortfolioConfig(top_n=1))
    changed = scores.copy()
    cutoff = changed.index[300]
    changed.loc[cutoff:, "C"] = 1000.0
    second = run_ranked_portfolio(prices, changed, RankedPortfolioConfig(top_n=1))
    pd.testing.assert_frame_equal(first.weights.loc[:cutoff], second.weights.loc[:cutoff])


def test_publication_lag_and_next_day_execution() -> None:
    prices, scores = make_panel()
    result = run_ranked_portfolio(
        prices,
        scores,
        RankedPortfolioConfig(top_n=1, fundamental_lag_days=5, cost_bps=0, slippage_bps=0),
    )
    first_invested = result.weights.sum(axis=1).ne(0).idxmax()
    assert first_invested > prices.index[5]


def test_robustness_summary_is_reproducible() -> None:
    prices, scores = make_panel()
    kwargs = {"top_n_grid": (1, 2), "cost_grid_bps": (0.0, 5.0), "lag_grid_days": (1, 5)}
    first = robustness_summary(prices, scores, **kwargs)
    second = robustness_summary(prices, scores, **kwargs)
    pd.testing.assert_frame_equal(first, second)
    assert 0.0 <= first.attrs["positive_sharpe_ratio"] <= 1.0
