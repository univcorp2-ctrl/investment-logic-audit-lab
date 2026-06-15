from __future__ import annotations

import argparse
from pathlib import Path

import pandas as pd

from .backtest import fee_sensitivity, metrics_from_returns, run_backtest
from .data import load_price_csv, make_synthetic_fundamentals, make_synthetic_market
from .reporting import write_report
from .signals import (
    cross_sectional_momentum,
    fundamental_quality_value_momentum,
    moving_average_trend,
    time_series_momentum,
)
from .walk_forward import run_walk_forward


def _summary_row(name: str, metrics: dict[str, float]) -> dict[str, float | str]:
    return {"strategy": name, **metrics}


def run_sample(out_dir: str | Path) -> dict[str, Path]:
    prices = make_synthetic_market()
    fundamentals = make_synthetic_fundamentals()
    price_mom = prices.iloc[-1] / prices.iloc[-126] - 1
    fundamental_scores = fundamental_quality_value_momentum(fundamentals, price_mom)
    strategies = {
        "ts_mom_126d": time_series_momentum(prices, lookback=126, skip=1, long_only=False),
        "ma_trend_50_200": moving_average_trend(prices, fast=50, slow=200, long_only=True),
        "cs_mom_126d": cross_sectional_momentum(prices, lookback=126, long_short=True),
    }
    rows = []
    equity = pd.DataFrame(index=prices.index)
    for name, signal in strategies.items():
        result = run_backtest(prices, signal, cost_bps=5, slippage_bps=2)
        rows.append(_summary_row(name, result.metrics))
        equity[name] = result.equity
    wf = run_walk_forward(
        prices,
        strategy="ts_mom",
        parameter_grid=[
            {"lookback": 63, "skip": 1, "long_only": False},
            {"lookback": 126, "skip": 1, "long_only": False},
            {"lookback": 252, "skip": 1, "long_only": False},
            {"lookback": 126, "skip": 5, "long_only": True},
        ],
        train_days=504,
        test_days=126,
        purge_days=5,
    )
    rows.append(_summary_row("walk_forward_ts_mom_oos", metrics_from_returns(wf.returns)))
    equity["walk_forward_ts_mom_oos"] = wf.equity.reindex(equity.index).ffill()
    fee = fee_sensitivity(prices, strategies["ts_mom_126d"])
    summary = pd.DataFrame(rows).sort_values("sharpe", ascending=False)
    notes = {
        "fundamental_top": ", ".join(fundamental_scores.head(3).index.tolist()),
        "interpretation": "Prefer candidates that remain positive in walk-forward and fee sensitivity tests.",
        "data": "Synthetic sample data; replace with real adjusted close and fundamentals before decisions.",
    }
    return write_report(out_dir, summary, equity, wf.windows, fee, notes)


def run_prices_file(args: argparse.Namespace) -> dict[str, Path]:
    prices = load_price_csv(args.prices)
    if args.strategy == "ts_mom":
        signal = time_series_momentum(prices, lookback=args.lookback, skip=args.skip, long_only=args.long_only)
    elif args.strategy == "ma_trend":
        signal = moving_average_trend(prices, fast=args.fast, slow=args.slow, long_only=args.long_only)
    elif args.strategy == "cs_mom":
        signal = cross_sectional_momentum(prices, lookback=args.lookback, long_short=not args.long_only)
    else:
        raise ValueError(f"Unsupported strategy: {args.strategy}")
    result = run_backtest(prices, signal, cost_bps=args.cost_bps, slippage_bps=args.slippage_bps)
    summary = pd.DataFrame([_summary_row(args.strategy, result.metrics)])
    equity = pd.DataFrame({args.strategy: result.equity})
    fee = fee_sensitivity(prices, signal)
    return write_report(args.out, summary, equity, fee_sensitivity=fee)


def build_parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(description="Investment logic audit toolkit")
    sub = parser.add_subparsers(dest="command", required=True)
    sample = sub.add_parser("sample", help="Run deterministic synthetic-data audit")
    sample.add_argument("--out", default="outputs")
    run = sub.add_parser("run", help="Run one strategy on a wide price CSV")
    run.add_argument("--prices", required=True)
    run.add_argument("--strategy", choices=["ts_mom", "ma_trend", "cs_mom"], default="ts_mom")
    run.add_argument("--lookback", type=int, default=126)
    run.add_argument("--skip", type=int, default=1)
    run.add_argument("--fast", type=int, default=50)
    run.add_argument("--slow", type=int, default=200)
    run.add_argument("--long-only", action="store_true")
    run.add_argument("--cost-bps", type=float, default=5.0)
    run.add_argument("--slippage-bps", type=float, default=2.0)
    run.add_argument("--out", default="outputs")
    return parser


def main(argv: list[str] | None = None) -> int:
    parser = build_parser()
    args = parser.parse_args(argv)
    if args.command == "sample":
        paths = run_sample(args.out)
    elif args.command == "run":
        paths = run_prices_file(args)
    else:
        parser.error(f"unknown command: {args.command}")
    for name, path in paths.items():
        print(f"{name}: {path}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
