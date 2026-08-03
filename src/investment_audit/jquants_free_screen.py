from __future__ import annotations

import argparse
import datetime as dt
import json
import time
from dataclasses import asdict
from pathlib import Path
from typing import Any, Callable

import numpy as np
import pandas as pd

from .jquants_pipeline import (
    DISCLAIMER,
    JQuantsScreenConfig,
    RequestPacer,
    _as_timestamp,
    _cache_snapshot,
    _decode_reasons,
    _write_outputs,
    build_fundamental_snapshot,
    build_price_histories,
    effective_cutoff,
    filter_common_stock_universe,
    point_in_time_financials,
)
from .providers.jquants import JQuantsConfig, JQuantsProvider, JQuantsProviderError
from .screening import ValueScreenConfig, screen_value_stocks


def _usable_price(frame: pd.DataFrame) -> pd.Series:
    adjusted = pd.to_numeric(
        frame.get("adjusted_close", pd.Series(np.nan, index=frame.index)), errors="coerce"
    )
    raw = pd.to_numeric(
        frame.get("close", pd.Series(np.nan, index=frame.index)), errors="coerce"
    )
    return adjusted.combine_first(raw)


def _usable_volume(frame: pd.DataFrame) -> pd.Series:
    adjusted = pd.to_numeric(
        frame.get("adjusted_volume", pd.Series(np.nan, index=frame.index)), errors="coerce"
    )
    raw = pd.to_numeric(
        frame.get("volume", pd.Series(np.nan, index=frame.index)), errors="coerce"
    )
    return adjusted.combine_first(raw)


def _latest_market_snapshot(
    provider: JQuantsProvider | Any,
    cutoff: pd.Timestamp,
    pacer: RequestPacer,
    lookback_days: int = 10,
) -> tuple[pd.DataFrame, pd.Timestamp]:
    errors: list[str] = []
    for offset in range(lookback_days + 1):
        candidate = cutoff - pd.Timedelta(days=offset)
        pacer.wait()
        try:
            frame = provider.get_daily_bars(as_of=candidate.date())
        except JQuantsProviderError as exc:
            errors.append(type(exc).__name__)
            continue
        if not frame.empty:
            return frame, candidate
    raise RuntimeError(
        "No market-wide daily bars were available near the effective cutoff; "
        f"attempts={lookback_days + 1}, errors={errors}"
    )


def _select_liquid_universe(
    master: pd.DataFrame,
    snapshot: pd.DataFrame,
    markets: tuple[str, ...],
    universe_size: int,
    minimum_trading_value: float,
) -> tuple[pd.DataFrame, pd.DataFrame]:
    universe = filter_common_stock_universe(master, markets=markets)
    latest = snapshot.copy()
    if "code" not in latest:
        raise ValueError("latest daily bars are missing code")
    latest["code"] = latest["code"].astype("string")
    latest["snapshot_price"] = _usable_price(latest)
    latest["snapshot_volume"] = _usable_volume(latest)
    latest["snapshot_trading_value"] = latest["snapshot_price"] * latest["snapshot_volume"]
    latest = (
        latest.sort_values(["code", "date"], kind="stable")
        .drop_duplicates("code", keep="last")
        .set_index("code")
    )
    joined = universe.set_index("code").join(
        latest[["snapshot_price", "snapshot_volume", "snapshot_trading_value"]],
        how="inner",
    )
    joined = joined.loc[
        joined["snapshot_trading_value"].ge(minimum_trading_value).fillna(False)
    ]
    joined = joined.sort_values(
        ["snapshot_trading_value", "code"], ascending=[False, True], kind="stable"
    ).head(universe_size)
    if joined.empty:
        raise RuntimeError("No ordinary stock passed the latest-day liquidity filter")
    return joined.reset_index(), latest.reset_index()


def run_free_liquid_screen(
    config: JQuantsScreenConfig,
    universe_size: int = 15,
    provider: JQuantsProvider | Any | None = None,
    sleep_fn: Callable[[float], None] = time.sleep,
) -> dict[str, Path]:
    """Run a Free-plan-safe staged screen without the parallel range helpers.

    The official range helpers parallelize requests and can exceed Free's request
    allowance. This workflow uses one market snapshot to select liquid issues,
    then fetches price and financial history one issue at a time under a pacer.
    """
    if config.plan != "free":
        raise ValueError("run_free_liquid_screen is intended for the free plan")
    if universe_size < 1:
        raise ValueError("universe_size must be positive")

    as_of = _as_timestamp(config.as_of)
    cutoff = effective_cutoff(as_of.date(), config.plan)
    history_start = cutoff - pd.DateOffset(years=config.resolved_history_years)
    config.cache_dir.mkdir(parents=True, exist_ok=True)
    cache_before = _cache_snapshot(config.cache_dir)
    live_provider = provider or JQuantsProvider(
        JQuantsConfig(
            cache_dir=config.cache_dir,
            cache_ttl_seconds=86_400,
            max_retries=1,
            backoff_seconds=2.0,
        )
    )
    pacer = RequestPacer(config.resolved_requests_per_minute, sleep_fn=sleep_fn)
    endpoint_coverage: dict[str, Any] = {}
    skipped: list[dict[str, str]] = []
    warnings: list[str] = [
        "Free-plan staged mode screens a liquidity-selected subset, not every listed issue.",
        "The effective data cutoff is delayed by 12 weeks; verify current prices and disclosures.",
    ]

    pacer.wait()
    master = live_provider.get_master(as_of=cutoff.date())
    endpoint_coverage["equities_master"] = f"ok:{len(master)}"
    snapshot, snapshot_date = _latest_market_snapshot(live_provider, cutoff, pacer)
    endpoint_coverage["latest_market_snapshot"] = f"ok:{len(snapshot)}@{snapshot_date.date()}"
    selected, _ = _select_liquid_universe(
        master,
        snapshot,
        config.markets,
        universe_size,
        config.min_average_daily_value,
    )

    bars_parts: list[pd.DataFrame] = []
    financial_parts: list[pd.DataFrame] = []
    per_symbol: dict[str, dict[str, str]] = {}
    for code in selected["code"].astype(str):
        symbol_status: dict[str, str] = {}
        pacer.wait()
        try:
            bars = live_provider.get_daily_bars(
                code=code, start=history_start.date(), end=cutoff.date()
            )
            if not bars.empty:
                bars_parts.append(bars)
            symbol_status["bars"] = f"ok:{len(bars)}"
        except JQuantsProviderError as exc:
            symbol_status["bars"] = f"error:{type(exc).__name__}"
            skipped.append({"code": code, "reason": symbol_status["bars"]})

        pacer.wait()
        try:
            financials = live_provider.get_financial_summary(
                code=code, start=history_start.date(), end=cutoff.date()
            )
            if not financials.empty:
                financial_parts.append(financials)
            symbol_status["financials"] = f"ok:{len(financials)}"
        except JQuantsProviderError as exc:
            symbol_status["financials"] = f"error:{type(exc).__name__}"
            skipped.append({"code": code, "reason": symbol_status["financials"]})
        per_symbol[code] = symbol_status

    bars = pd.concat(bars_parts, ignore_index=True) if bars_parts else pd.DataFrame()
    financials = (
        pd.concat(financial_parts, ignore_index=True) if financial_parts else pd.DataFrame()
    )
    endpoint_coverage["per_symbol"] = per_symbol
    if bars.empty or financials.empty:
        raise RuntimeError(
            "Staged Free-plan screen could not obtain both price and financial history; "
            f"bars_rows={len(bars)}, financial_rows={len(financials)}"
        )

    codes = set(selected["code"].astype(str))
    point_in_time = point_in_time_financials(financials, cutoff)
    histories = build_price_histories(bars, codes, cutoff)
    fundamentals, metadata = build_fundamental_snapshot(selected, point_in_time, histories)
    liquid = fundamentals["average_daily_value"].ge(config.min_average_daily_value)
    fundamentals = fundamentals.loc[liquid.fillna(False)]
    metadata = metadata.reindex(fundamentals.index)
    histories = {code: history for code, history in histories.items() if code in fundamentals.index}
    if fundamentals.empty:
        raise RuntimeError("No selected issue retained sufficient price/liquidity data")

    scored = screen_value_stocks(
        fundamentals,
        price_history=histories,
        config=ValueScreenConfig(
            minimum_quality=config.minimum_quality,
            maximum_value_trap_risk=config.maximum_value_trap_risk,
            minimum_data_completeness=config.minimum_data_completeness,
        ),
    )
    scored = scored.join(metadata, how="left")
    scored = scored.join(
        fundamentals[
            ["earnings_yield", "book_to_market", "fcf_yield", "roe", "operating_margin"]
        ],
        how="left",
    ).reset_index(names="code")
    scored["positive_reasons"] = scored.get(
        "reasons", pd.Series(index=scored.index, dtype=object)
    ).map(lambda value: " / ".join(_decode_reasons(value)))
    scored["negative_reasons"] = scored.get(
        "filter_reasons", pd.Series(index=scored.index, dtype=object)
    ).map(lambda value: " / ".join(_decode_reasons(value)))
    eligible = scored.loc[scored["eligible"].fillna(False)].copy()
    if eligible.empty:
        warnings.append(
            "No issue passed every eligibility threshold; highest scores are shown for research."
        )
        candidates = scored.head(config.top_n).copy()
    else:
        candidates = eligible.head(config.top_n).copy()
    candidates["rank"] = np.arange(1, len(candidates) + 1)
    candidates["disclaimer"] = DISCLAIMER
    output_columns = [
        column
        for column in (
            "rank",
            "code",
            "company_name",
            "market",
            "sector",
            "last_price",
            "overall_score",
            "value_score",
            "quality_score",
            "growth_stability_score",
            "technical_score",
            "liquidity_score",
            "value_trap_risk",
            "data_completeness",
            "confidence",
            "earnings_yield",
            "book_to_market",
            "fcf_yield",
            "roe",
            "operating_margin",
            "positive_reasons",
            "negative_reasons",
            "latest_price_date",
            "latest_disclosure_date",
            "eligible",
            "disclaimer",
        )
        if column in candidates.columns
    ]
    candidates = candidates[output_columns]
    manifest = {
        "source": "J-Quants API V2 (Free staged liquid universe)",
        "generated_at": pd.Timestamp.now(tz="UTC").isoformat(),
        "as_of": as_of.date().isoformat(),
        "effective_data_cutoff": cutoff.date().isoformat(),
        "latest_market_snapshot_date": snapshot_date.date().isoformat(),
        "history_start": history_start.date().isoformat(),
        "plan": asdict(config.plan_spec),
        "configured_requests_per_minute": config.resolved_requests_per_minute,
        "universe_method": "latest-day trading-value leaders among ordinary stocks",
        "requested_universe_size": universe_size,
        "selected_codes": selected["code"].astype(str).tolist(),
        "selected_count": len(selected),
        "price_history_count": len(histories),
        "point_in_time_financial_rows": len(point_in_time),
        "scored_count": len(scored),
        "eligible_count": int(scored["eligible"].fillna(False).sum()),
        "output_count": len(candidates),
        "endpoint_coverage": endpoint_coverage,
        "skipped": skipped,
        "cache_before": cache_before,
        "cache_after": _cache_snapshot(config.cache_dir),
        "warnings": warnings,
        "secret_handling": "The API key is not written to any generated file.",
        "disclaimer": DISCLAIMER,
    }
    return _write_outputs(candidates, config, manifest)


def build_parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(description="Free-plan-safe staged J-Quants screen")
    parser.add_argument("--as-of", default=None)
    parser.add_argument("--out-dir", default="outputs/jquants")
    parser.add_argument("--cache-dir", default=".cache/jquants")
    parser.add_argument("--top-n", type=int, default=15)
    parser.add_argument("--universe-size", type=int, default=15)
    parser.add_argument("--market", default="Prime,Standard,Growth")
    parser.add_argument("--requests-per-minute", type=int, default=5)
    parser.add_argument("--history-years", type=int, default=2)
    parser.add_argument("--min-average-daily-value", type=float, default=100_000_000.0)
    parser.add_argument("--minimum-quality", type=float, default=35.0)
    parser.add_argument("--maximum-value-trap-risk", type=float, default=70.0)
    parser.add_argument("--minimum-data-completeness", type=float, default=25.0)
    return parser


def main(argv: list[str] | None = None) -> int:
    args = build_parser().parse_args(argv)
    config = JQuantsScreenConfig(
        as_of=args.as_of,
        plan="free",
        out_dir=Path(args.out_dir),
        cache_dir=Path(args.cache_dir),
        top_n=args.top_n,
        markets=tuple(item.strip() for item in args.market.split(",") if item.strip()),
        requests_per_minute=args.requests_per_minute,
        history_years=args.history_years,
        min_average_daily_value=args.min_average_daily_value,
        minimum_quality=args.minimum_quality,
        maximum_value_trap_risk=args.maximum_value_trap_risk,
        minimum_data_completeness=args.minimum_data_completeness,
    )
    paths = run_free_liquid_screen(config, universe_size=args.universe_size)
    for name, path in paths.items():
        print(f"{name}: {path}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
