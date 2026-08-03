from __future__ import annotations

import argparse
from pathlib import Path

import pandas as pd

from .backtest import fee_sensitivity, metrics_from_returns, run_backtest
from .data import load_price_csv, make_synthetic_fundamentals, make_synthetic_market
from .factor_diagnostics import analyze_factor, write_factor_diagnostics
from .jquants_pipeline import JQuantsScreenConfig, run_plan_check, run_screen
from .reporting import write_report
from .screening import ValueScreenConfig, load_table, screen_value_stocks, write_screen_results
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
    price_momentum = prices.iloc[-1] / prices.iloc[-126] - 1.0
    fundamental_scores = fundamental_quality_value_momentum(fundamentals, price_momentum)
    strategies = {
        "ts_mom_126d": time_series_momentum(prices, lookback=126, skip=1, long_only=False),
        "ma_trend_50_200": moving_average_trend(prices, fast=50, slow=200, long_only=True),
        "cs_mom_126d": cross_sectional_momentum(prices, lookback=126, long_short=True),
    }
    rows: list[dict[str, float | str]] = []
    equity = pd.DataFrame(index=prices.index)
    for name, signal in strategies.items():
        result = run_backtest(prices, signal, cost_bps=5, slippage_bps=2)
        rows.append(_summary_row(name, result.metrics))
        equity[name] = result.equity
    walk_forward = run_walk_forward(
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
    rows.append(_summary_row("walk_forward_ts_mom_oos", metrics_from_returns(walk_forward.returns)))
    equity["walk_forward_ts_mom_oos"] = walk_forward.equity.reindex(equity.index).ffill()
    fee = fee_sensitivity(prices, strategies["ts_mom_126d"])
    summary = pd.DataFrame(rows).sort_values("sharpe", ascending=False)
    notes = {
        "fundamental_top": ", ".join(fundamental_scores.head(3).index.tolist()),
        "interpretation": "Prefer candidates that remain positive in walk-forward and fee sensitivity tests.",
        "data": "Synthetic sample data; replace it with point-in-time real data before decisions.",
    }
    return write_report(out_dir, summary, equity, walk_forward.windows, fee, notes)


def run_prices_file(args: argparse.Namespace) -> dict[str, Path]:
    prices = load_price_csv(args.prices)
    if args.strategy == "ts_mom":
        signal = time_series_momentum(
            prices,
            lookback=args.lookback,
            skip=args.skip,
            long_only=args.long_only,
        )
    elif args.strategy == "ma_trend":
        signal = moving_average_trend(
            prices,
            fast=args.fast,
            slow=args.slow,
            long_only=args.long_only,
        )
    elif args.strategy == "cs_mom":
        signal = cross_sectional_momentum(
            prices,
            lookback=args.lookback,
            long_short=not args.long_only,
        )
    else:
        raise ValueError(f"Unsupported strategy: {args.strategy}")
    result = run_backtest(
        prices,
        signal,
        cost_bps=args.cost_bps,
        slippage_bps=args.slippage_bps,
    )
    summary = pd.DataFrame([_summary_row(args.strategy, result.metrics)])
    equity = pd.DataFrame({args.strategy: result.equity})
    fee = fee_sensitivity(prices, signal)
    return write_report(args.out, summary, equity, fee_sensitivity=fee)


def _screen_config(args: argparse.Namespace) -> ValueScreenConfig:
    return ValueScreenConfig(
        fundamental_weight=args.fundamental_weight,
        technical_weight=args.technical_weight,
        liquidity_risk_weight=args.liquidity_weight,
        minimum_quality=args.minimum_quality,
        maximum_value_trap_risk=args.maximum_value_trap_risk,
        minimum_data_completeness=args.minimum_data_completeness,
        minimum_liquidity_score=args.minimum_liquidity,
    )


def run_value_screen(args: argparse.Namespace) -> dict[str, Path]:
    fundamentals = load_table(args.fundamentals)
    technical = load_table(args.technical) if args.technical else None
    result = screen_value_stocks(
        fundamentals,
        technical_scores=technical,
        config=_screen_config(args),
    )
    return write_screen_results(result, args.out, args.json_output)


def run_value_screen_demo(args: argparse.Namespace) -> dict[str, Path]:
    fundamentals = make_synthetic_fundamentals()
    prices = make_synthetic_market(days=320)
    histories: dict[str, pd.DataFrame] = {}
    for symbol in prices.columns:
        close = prices[symbol]
        histories[str(symbol)] = pd.DataFrame(
            {
                "open": close,
                "high": close * 1.005,
                "low": close * 0.995,
                "close": close,
                "volume": 1_000_000.0,
            },
            index=prices.index,
        )
    result = screen_value_stocks(
        fundamentals,
        price_history=histories,
        config=_screen_config(args),
    )
    return write_screen_results(result, args.out, args.json_output)


def _parse_horizons(value: str) -> tuple[int, ...]:
    try:
        horizons = tuple(int(item.strip()) for item in value.split(",") if item.strip())
    except ValueError as exc:
        raise ValueError("horizons must be a comma-separated list of integers") from exc
    if not horizons or any(horizon < 1 for horizon in horizons):
        raise ValueError("horizons must contain positive integers")
    return horizons


def run_factor_audit(args: argparse.Namespace) -> dict[str, Path]:
    scores = load_table(args.scores)
    prices = load_table(args.prices)
    groups: pd.Series | None = None
    if args.groups:
        group_table = load_table(args.groups)
        if group_table.shape[1] < 1:
            raise ValueError("groups file must contain at least one data column")
        groups = group_table.iloc[:, 0].astype(str)
    result = analyze_factor(
        scores=scores,
        prices=prices,
        horizons=_parse_horizons(args.horizons),
        quantiles=args.quantiles,
        groups=groups,
        group_neutral=args.group_neutral,
    )
    return write_factor_diagnostics(result, args.out)


def run_jquants_screen(args: argparse.Namespace) -> dict[str, Path]:
    markets = tuple(item.strip() for item in args.market.split(",") if item.strip())
    config = JQuantsScreenConfig(
        as_of=args.as_of,
        plan=args.plan,
        out_dir=Path(args.out_dir),
        cache_dir=Path(args.cache_dir),
        top_n=args.top_n,
        markets=markets,
        max_symbols=args.max_symbols,
        requests_per_minute=args.requests_per_minute,
        history_years=args.history_years,
        min_average_daily_value=args.min_average_daily_value,
        minimum_data_completeness=args.minimum_data_completeness,
        minimum_quality=args.minimum_quality,
        maximum_value_trap_risk=args.maximum_value_trap_risk,
    )
    return run_screen(config)


def run_jquants_plan_check(args: argparse.Namespace) -> dict[str, Path]:
    return run_plan_check(args.plan, Path(args.out_dir), as_of=args.as_of)


def _add_screen_options(parser: argparse.ArgumentParser) -> None:
    parser.add_argument("--out", default="outputs/value-ranking.csv")
    parser.add_argument("--json", dest="json_output", default="outputs/value-ranking.json")
    parser.add_argument("--fundamental-weight", type=float, default=0.65)
    parser.add_argument("--technical-weight", type=float, default=0.25)
    parser.add_argument("--liquidity-weight", type=float, default=0.10)
    parser.add_argument("--minimum-quality", type=float, default=40.0)
    parser.add_argument("--maximum-value-trap-risk", type=float, default=60.0)
    parser.add_argument("--minimum-data-completeness", type=float, default=45.0)
    parser.add_argument("--minimum-liquidity", type=float, default=20.0)


def _add_jquants_options(parser: argparse.ArgumentParser, include_screen: bool) -> None:
    parser.add_argument("--plan", choices=["free", "light", "standard", "premium"], default="free")
    parser.add_argument("--as-of", help="Evaluation date (YYYY-MM-DD); defaults to today in Asia/Tokyo")
    parser.add_argument("--out-dir", default="outputs/jquants")
    if not include_screen:
        return
    parser.add_argument("--top-n", type=int, default=20)
    parser.add_argument("--market", default="", help="Comma-separated market-name filters")
    parser.add_argument("--max-symbols", type=int)
    parser.add_argument("--cache-dir", default=".cache/jquants")
    parser.add_argument("--requests-per-minute", type=int)
    parser.add_argument("--history-years", type=int)
    parser.add_argument("--min-average-daily-value", type=float, default=100_000_000.0)
    parser.add_argument("--minimum-quality", type=float, default=35.0)
    parser.add_argument("--maximum-value-trap-risk", type=float, default=70.0)
    parser.add_argument("--minimum-data-completeness", type=float, default=35.0)


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
    value = sub.add_parser("value-screen", help="Rank value candidates from CSV or Parquet")
    value.add_argument("--fundamentals", required=True)
    value.add_argument("--technical")
    _add_screen_options(value)

    demo = sub.add_parser("value-screen-demo", help="Run a fully offline value-screen demo")
    _add_screen_options(demo)
    factor = sub.add_parser("factor-audit", help="Audit factor IC, quantiles, and turnover")
    factor.add_argument("--scores", required=True, help="Wide date-by-symbol factor scores")
    factor.add_argument("--prices", required=True, help="Wide date-by-symbol adjusted prices")
    factor.add_argument("--groups", help="Optional symbol-indexed sector/group table")
    factor.add_argument("--group-neutral", action="store_true")
    factor.add_argument("--horizons", default="1,5,21,63")
    factor.add_argument("--quantiles", type=int, default=5)
    factor.add_argument("--out", default="outputs/factor-audit")

    jquants = sub.add_parser(
        "jquants-screen",
        help="Run a point-in-time Japanese-equity screen with J-Quants API V2",
    )
    _add_jquants_options(jquants, include_screen=True)
    plan_check = sub.add_parser(
        "jquants-plan-check",
        help="Validate redacted J-Quants connectivity and plan cutoffs",
    )
    _add_jquants_options(plan_check, include_screen=False)
    return parser


def main(argv: list[str] | None = None) -> int:
    parser = build_parser()
    args = parser.parse_args(argv)
    if args.command == "sample":
        paths = run_sample(args.out)
    elif args.command == "run":
        paths = run_prices_file(args)
    elif args.command == "value-screen":
        paths = run_value_screen(args)
    elif args.command == "value-screen-demo":
        paths = run_value_screen_demo(args)
    elif args.command == "factor-audit":
        paths = run_factor_audit(args)
    elif args.command == "jquants-screen":
        paths = run_jquants_screen(args)
    elif args.command == "jquants-plan-check":
        paths = run_jquants_plan_check(args)
    else:
        parser.error(f"unknown command: {args.command}")
    for name, path in paths.items():
        print(f"{name}: {path}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
