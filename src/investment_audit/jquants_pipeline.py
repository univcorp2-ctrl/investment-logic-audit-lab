from __future__ import annotations

import datetime as dt
import json
import math
import re
import time
from dataclasses import asdict, dataclass
from pathlib import Path
from typing import Any, Callable, Final

import numpy as np
import pandas as pd

from .providers.jquants import JQuantsConfig, JQuantsProvider, JQuantsProviderError
from .screening import ValueScreenConfig, screen_value_stocks

DISCLAIMER: Final[str] = (
    "調査・分析用の機械的スクリーニング結果であり、特定銘柄の売買を推奨するものではありません。"
    "将来の利益を保証せず、最終判断は一次情報、価格、流動性、リスク許容度を確認して行ってください。"
)


@dataclass(frozen=True)
class PlanSpec:
    name: str
    history_years: int
    delay_days: int
    requests_per_minute: int


PLAN_SPECS: Final[dict[str, PlanSpec]] = {
    "free": PlanSpec("free", history_years=2, delay_days=84, requests_per_minute=5),
    "light": PlanSpec("light", history_years=5, delay_days=0, requests_per_minute=60),
    "standard": PlanSpec("standard", history_years=10, delay_days=0, requests_per_minute=120),
    "premium": PlanSpec("premium", history_years=20, delay_days=0, requests_per_minute=500),
}


@dataclass(frozen=True)
class JQuantsScreenConfig:
    as_of: str | dt.date | None = None
    plan: str = "free"
    out_dir: Path = Path("outputs/jquants")
    cache_dir: Path = Path(".cache/jquants")
    top_n: int = 20
    markets: tuple[str, ...] = ()
    max_symbols: int | None = None
    requests_per_minute: int | None = None
    history_years: int | None = None
    min_average_daily_value: float = 100_000_000.0
    minimum_data_completeness: float = 35.0
    minimum_quality: float = 35.0
    maximum_value_trap_risk: float = 70.0

    def __post_init__(self) -> None:
        if self.plan not in PLAN_SPECS:
            raise ValueError(f"unknown J-Quants plan: {self.plan}")
        if self.top_n < 1:
            raise ValueError("top_n must be positive")
        if self.max_symbols is not None and self.max_symbols < 1:
            raise ValueError("max_symbols must be positive")
        if self.resolved_requests_per_minute < 1:
            raise ValueError("requests_per_minute must be positive")
        if self.resolved_history_years < 1:
            raise ValueError("history_years must be positive")
        if self.min_average_daily_value < 0:
            raise ValueError("min_average_daily_value must be non-negative")

    @property
    def plan_spec(self) -> PlanSpec:
        return PLAN_SPECS[self.plan]

    @property
    def resolved_requests_per_minute(self) -> int:
        return self.requests_per_minute or self.plan_spec.requests_per_minute

    @property
    def resolved_history_years(self) -> int:
        return self.history_years or self.plan_spec.history_years


class RequestPacer:
    """Pace high-level provider calls without ever observing credentials."""

    def __init__(
        self,
        requests_per_minute: int,
        sleep_fn: Callable[[float], None] = time.sleep,
        clock_fn: Callable[[], float] = time.monotonic,
    ) -> None:
        self.interval = 60.0 / requests_per_minute
        self.sleep_fn = sleep_fn
        self.clock_fn = clock_fn
        self.last_call: float | None = None

    def wait(self) -> None:
        now = self.clock_fn()
        if self.last_call is not None:
            remaining = self.interval - (now - self.last_call)
            if remaining > 0:
                self.sleep_fn(remaining)
        self.last_call = self.clock_fn()


def _as_timestamp(value: str | dt.date | None) -> pd.Timestamp:
    if value is None:
        return pd.Timestamp.now(tz="Asia/Tokyo").tz_localize(None).normalize()
    parsed = pd.Timestamp(value)
    if pd.isna(parsed):
        raise ValueError(f"invalid as_of date: {value}")
    if parsed.tzinfo is not None:
        parsed = parsed.tz_convert("Asia/Tokyo").tz_localize(None)
    return parsed.normalize()


def effective_cutoff(as_of: str | dt.date | None, plan: str) -> pd.Timestamp:
    if plan not in PLAN_SPECS:
        raise ValueError(f"unknown J-Quants plan: {plan}")
    return _as_timestamp(as_of) - pd.Timedelta(days=PLAN_SPECS[plan].delay_days)


def _text_series(frame: pd.DataFrame, names: tuple[str, ...], default: str = "") -> pd.Series:
    result = pd.Series(default, index=frame.index, dtype="string")
    for name in names:
        if name in frame.columns:
            values = frame[name].astype("string")
            result = result.mask(result.eq(default), values)
    return result.fillna(default)


def _numeric_series(frame: pd.DataFrame, names: tuple[str, ...]) -> pd.Series:
    result = pd.Series(np.nan, index=frame.index, dtype=float)
    for name in names:
        if name in frame.columns:
            result = result.combine_first(pd.to_numeric(frame[name], errors="coerce"))
    return result.replace([np.inf, -np.inf], np.nan)


def filter_common_stock_universe(
    master: pd.DataFrame,
    markets: tuple[str, ...] = (),
    max_symbols: int | None = None,
) -> pd.DataFrame:
    """Keep ordinary listed equities and remove identifiable funds/REITs/preferred issues."""
    if master.empty:
        return master.copy()
    required = {"code", "company_name"}
    missing = required.difference(master.columns)
    if missing:
        raise ValueError(f"master data is missing columns: {sorted(missing)}")
    result = master.copy()
    result["code"] = result["code"].astype("string").str.strip().str.upper()
    result["company_name"] = result["company_name"].astype("string").fillna("")
    market_name = _text_series(result, ("market_name", "MktNm", "MarketCodeName"))
    name = result["company_name"]
    excluded_pattern = re.compile(
        r"ETF|ETN|REIT|投資法人|投資信託|上場投信|インフラファンド|優先株|種類株|受益証券",
        re.IGNORECASE,
    )
    issue_type = _text_series(
        result,
        ("issue_type", "IssueType", "Scd", "SecurityType", "ProductCategory"),
    )
    ordinary_type = issue_type.eq("") | issue_type.str.contains(
        r"普通株|Common|Equity|Stock|^0?1$", case=False, regex=True, na=False
    )
    code_shape = result["code"].str.fullmatch(r"[0-9A-Z]{5}", na=False)
    common_code = result["code"].str.endswith("0", na=False)
    result = result.loc[
        code_shape
        & common_code
        & ordinary_type
        & ~name.str.contains(excluded_pattern, na=False)
        & ~market_name.str.contains(r"ETF|ETN|REIT|PRO Market", case=False, regex=True, na=False)
    ].copy()
    if markets:
        wanted = tuple(item.casefold() for item in markets)
        result = result.loc[
            market_name.loc[result.index].map(
                lambda value: any(token in str(value).casefold() for token in wanted)
            )
        ]
    result = result.sort_values("code", kind="stable").drop_duplicates("code", keep="last")
    if max_symbols is not None:
        result = result.head(max_symbols)
    return result.reset_index(drop=True)


def point_in_time_financials(financials: pd.DataFrame, cutoff: pd.Timestamp) -> pd.DataFrame:
    if financials.empty:
        return financials.copy()
    if "code" not in financials.columns or "disclosed_date" not in financials.columns:
        raise ValueError("financial summary requires code and disclosed_date")
    result = financials.copy()
    result["code"] = result["code"].astype("string")
    result["disclosed_date"] = pd.to_datetime(result["disclosed_date"], errors="coerce")
    result = result.loc[result["disclosed_date"].notna() & (result["disclosed_date"] <= cutoff)]
    if "period_end" in result.columns:
        result["period_end"] = pd.to_datetime(result["period_end"], errors="coerce")
    return result.sort_values(["code", "disclosed_date"], kind="stable").reset_index(drop=True)


def _latest_and_prior(financials: pd.DataFrame) -> tuple[pd.DataFrame, pd.DataFrame]:
    latest_rows: list[pd.Series] = []
    prior_rows: list[pd.Series] = []
    for _, group in financials.groupby("code", sort=True):
        ordered = group.sort_values("disclosed_date", kind="stable")
        latest = ordered.iloc[-1]
        latest_rows.append(latest)
        period = pd.Timestamp(latest.get("period_end"))
        if pd.notna(period):
            candidates = ordered.loc[
                pd.to_datetime(ordered.get("period_end"), errors="coerce")
                <= period - pd.Timedelta(days=270)
            ]
        else:
            candidates = ordered.iloc[:-1]
        if not candidates.empty:
            prior_rows.append(candidates.iloc[-1])
    latest_frame = pd.DataFrame(latest_rows).set_index("code") if latest_rows else pd.DataFrame()
    prior_frame = pd.DataFrame(prior_rows).set_index("code") if prior_rows else pd.DataFrame()
    return latest_frame, prior_frame


def _history_for_group(group: pd.DataFrame, cutoff: pd.Timestamp) -> pd.DataFrame:
    ordered = group.copy()
    ordered["date"] = pd.to_datetime(ordered["date"], errors="coerce")
    ordered = ordered.loc[ordered["date"].notna() & (ordered["date"] <= cutoff)]
    ordered = ordered.sort_values("date", kind="stable").drop_duplicates("date", keep="last")
    history = pd.DataFrame(index=pd.DatetimeIndex(ordered["date"]))
    for target in ("open", "high", "low", "close", "volume"):
        adjusted = f"adjusted_{target}"
        raw = pd.to_numeric(ordered[target], errors="coerce") if target in ordered else pd.Series(np.nan, index=ordered.index)
        if adjusted in ordered:
            preferred = pd.to_numeric(ordered[adjusted], errors="coerce").combine_first(raw)
        else:
            preferred = raw
        history[target] = preferred.to_numpy()
    return history.replace([np.inf, -np.inf], np.nan)


def build_price_histories(
    bars: pd.DataFrame,
    codes: set[str],
    cutoff: pd.Timestamp,
) -> dict[str, pd.DataFrame]:
    if bars.empty or "code" not in bars.columns or "date" not in bars.columns:
        return {}
    source = bars.copy()
    source["code"] = source["code"].astype("string")
    source = source.loc[source["code"].isin(codes)]
    histories: dict[str, pd.DataFrame] = {}
    for code, group in source.groupby("code", sort=True):
        history = _history_for_group(group, cutoff)
        if not history.empty:
            histories[str(code)] = history
    return histories


def _safe_growth(current: pd.Series, previous: pd.Series) -> pd.Series:
    denominator = previous.abs().where(previous.abs() > 1e-12)
    return ((current - previous) / denominator).replace([np.inf, -np.inf], np.nan)


def _series_from_index(frame: pd.DataFrame, names: tuple[str, ...], index: pd.Index) -> pd.Series:
    if frame.empty:
        return pd.Series(np.nan, index=index, dtype=float)
    values = _numeric_series(frame, names)
    values.index = frame.index.astype("string")
    return values.reindex(index)


def build_fundamental_snapshot(
    universe: pd.DataFrame,
    financials: pd.DataFrame,
    histories: dict[str, pd.DataFrame],
) -> tuple[pd.DataFrame, pd.DataFrame]:
    codes = pd.Index(universe["code"].astype("string"), dtype="string")
    latest, prior = _latest_and_prior(financials)
    if not latest.empty:
        latest.index = latest.index.astype("string")
    if not prior.empty:
        prior.index = prior.index.astype("string")
    frame = pd.DataFrame(index=codes)
    meta = universe.set_index(universe["code"].astype("string"))
    frame["sector"] = _text_series(meta, ("sector_33", "sector_17", "S33", "S17")).reindex(codes)
    frame["company_name"] = meta["company_name"].astype("string").reindex(codes)
    frame["market"] = _text_series(meta, ("market_name", "MktNm", "MarketCodeName")).reindex(codes)

    last_price = pd.Series(np.nan, index=codes, dtype=float)
    average_daily_value = pd.Series(np.nan, index=codes, dtype=float)
    latest_price_date = pd.Series(pd.NaT, index=codes, dtype="datetime64[ns]")
    for code, history in histories.items():
        usable = history.dropna(subset=["close"])
        if usable.empty or code not in codes:
            continue
        last_price.loc[code] = float(usable["close"].iloc[-1])
        latest_price_date.loc[code] = usable.index[-1]
        average_daily_value.loc[code] = float(
            (usable["close"] * usable["volume"]).tail(20).mean()
        )
    frame["last_price"] = last_price
    frame["average_daily_value"] = average_daily_value
    frame["latest_price_date"] = latest_price_date

    profit = _series_from_index(latest, ("profit", "Profit"), codes)
    sales = _series_from_index(latest, ("net_sales", "Sales", "NetSales"), codes)
    operating_profit = _series_from_index(latest, ("operating_profit", "OP", "OperatingProfit"), codes)
    equity = _series_from_index(latest, ("equity", "Eq", "Equity"), codes)
    assets = _series_from_index(latest, ("total_assets", "TA", "TotalAssets"), codes)
    eps = _series_from_index(latest, ("eps", "EPS", "EarningsPerShare"), codes)
    cfo = _series_from_index(
        latest,
        ("operating_cash_flow", "CFO", "CashFlowsFromOperatingActivities"),
        codes,
    )
    cfi = _series_from_index(
        latest,
        ("investing_cash_flow", "CFI", "CashFlowsFromInvestingActivities"),
        codes,
    )
    free_cash_flow = cfo + cfi
    shares = _series_from_index(
        latest,
        (
            "ShOutFY",
            "NumberOfIssuedAndOutstandingSharesAtTheEndOfFiscalYearIncludingTreasuryStock",
            "NumberOfIssuedAndOutstandingSharesAtTheEndOfFiscalYear",
        ),
        codes,
    )
    treasury = _series_from_index(
        latest,
        ("TrShFY", "NumberOfTreasuryStockAtTheEndOfFiscalYear"),
        codes,
    ).fillna(0.0)
    bps = _series_from_index(latest, ("BPS", "BookValuePerShare"), codes)
    inferred_shares = equity / bps.where(bps.abs() > 1e-12)
    net_shares = (shares - treasury).where((shares - treasury) > 0).combine_first(inferred_shares)
    market_cap = last_price * net_shares
    annual_dividend_per_share = _series_from_index(
        latest,
        (
            "DivAnn",
            "ResultDividendPerShareAnnual",
            "ForecastDividendPerShareAnnual",
            "AnnualDividendPerShare",
        ),
        codes,
    )

    previous_profit = _series_from_index(prior, ("profit", "Profit"), codes)
    previous_sales = _series_from_index(prior, ("net_sales", "Sales", "NetSales"), codes)
    previous_eps = _series_from_index(prior, ("eps", "EPS", "EarningsPerShare"), codes)
    previous_cfo = _series_from_index(
        prior,
        ("operating_cash_flow", "CFO", "CashFlowsFromOperatingActivities"),
        codes,
    )
    previous_cfi = _series_from_index(
        prior,
        ("investing_cash_flow", "CFI", "CashFlowsFromInvestingActivities"),
        codes,
    )
    previous_fcf = previous_cfo + previous_cfi

    frame["market_cap"] = market_cap
    frame["net_income"] = profit
    frame["book_value"] = equity
    frame["free_cash_flow"] = free_cash_flow
    frame["revenue"] = sales
    frame["operating_income"] = operating_profit
    frame["operating_cash_flow"] = cfo
    frame["total_assets"] = assets
    frame["earnings_yield"] = (eps / last_price.where(last_price > 0)).combine_first(
        profit / market_cap.where(market_cap > 0)
    )
    frame["book_to_market"] = equity / market_cap.where(market_cap > 0)
    frame["fcf_yield"] = free_cash_flow / market_cap.where(market_cap > 0)
    frame["dividend_yield"] = annual_dividend_per_share / last_price.where(last_price > 0)
    frame["roe"] = profit / equity.where(equity.abs() > 1e-12)
    frame["operating_margin"] = operating_profit / sales.where(sales.abs() > 1e-12)
    frame["fcf_conversion"] = free_cash_flow / profit.abs().where(profit.abs() > 1e-12)
    frame["accrual_quality"] = (cfo - profit) / assets.where(assets.abs() > 1e-12)
    frame["revenue_growth"] = _safe_growth(sales, previous_sales)
    frame["eps_growth"] = _safe_growth(eps, previous_eps)
    frame["fcf_growth"] = _safe_growth(free_cash_flow, previous_fcf)
    frame["operating_margin_change"] = frame["operating_margin"] - (
        _series_from_index(prior, ("operating_profit", "OP", "OperatingProfit"), codes)
        / previous_sales.where(previous_sales.abs() > 1e-12)
    )
    frame["negative_earnings_years"] = (profit < 0).astype(float) + (previous_profit < 0).astype(float)
    frame["negative_fcf_years"] = (free_cash_flow < 0).astype(float) + (previous_fcf < 0).astype(float)
    two_profit = pd.concat([profit, previous_profit], axis=1)
    two_fcf = pd.concat([free_cash_flow, previous_fcf], axis=1)
    profit_cv = two_profit.std(axis=1, ddof=0) / two_profit.mean(axis=1).abs().where(
        two_profit.mean(axis=1).abs() > 1e-12
    )
    fcf_cv = two_fcf.std(axis=1, ddof=0) / two_fcf.mean(axis=1).abs().where(
        two_fcf.mean(axis=1).abs() > 1e-12
    )
    frame["earnings_stability"] = 1.0 / (1.0 + profit_cv)
    frame["fcf_stability"] = 1.0 / (1.0 + fcf_cv)
    frame["earnings_volatility"] = profit_cv

    latest_disclosure = pd.Series(pd.NaT, index=codes, dtype="datetime64[ns]")
    if not latest.empty and "disclosed_date" in latest:
        latest_disclosure = pd.to_datetime(latest["disclosed_date"], errors="coerce").reindex(codes)
    metadata = frame[["company_name", "market", "sector", "last_price", "latest_price_date"]].copy()
    metadata["latest_disclosure_date"] = latest_disclosure
    numeric_columns = frame.columns.difference(["company_name", "market", "sector", "latest_price_date"])
    frame[numeric_columns] = frame[numeric_columns].apply(pd.to_numeric, errors="coerce")
    return frame.drop(columns=["company_name", "market", "latest_price_date"]), metadata


def _decode_reasons(value: Any) -> list[str]:
    if isinstance(value, list):
        return [str(item) for item in value]
    if isinstance(value, str):
        try:
            parsed = json.loads(value)
            if isinstance(parsed, list):
                return [str(item) for item in parsed]
        except json.JSONDecodeError:
            return [value]
    return []


def _clean_json(value: Any) -> Any:
    if value is None or value is pd.NA:
        return None
    if isinstance(value, (pd.Timestamp, dt.datetime, dt.date)):
        return value.isoformat()
    if isinstance(value, (np.integer,)):
        return int(value)
    if isinstance(value, (np.floating, float)):
        return None if not math.isfinite(float(value)) else float(value)
    if isinstance(value, (np.bool_, bool)):
        return bool(value)
    if isinstance(value, dict):
        return {str(key): _clean_json(item) for key, item in value.items()}
    if isinstance(value, (list, tuple)):
        return [_clean_json(item) for item in value]
    if pd.isna(value):
        return None
    return value


def _cache_snapshot(cache_dir: Path) -> dict[str, int]:
    files = list(cache_dir.glob("**/*")) if cache_dir.exists() else []
    regular = [path for path in files if path.is_file()]
    return {"files": len(regular), "bytes": sum(path.stat().st_size for path in regular)}


def _write_outputs(
    ranking: pd.DataFrame,
    config: JQuantsScreenConfig,
    manifest: dict[str, Any],
) -> dict[str, Path]:
    config.out_dir.mkdir(parents=True, exist_ok=True)
    csv_path = config.out_dir / "ranking.csv"
    json_path = config.out_dir / "ranking.json"
    markdown_path = config.out_dir / "ranking.md"
    manifest_path = config.out_dir / "manifest.json"
    ranking.to_csv(csv_path, index=False)
    rows = [_clean_json(row) for row in ranking.to_dict(orient="records")]
    json_path.write_text(
        json.dumps(
            {"metadata": _clean_json(manifest), "disclaimer": DISCLAIMER, "rows": rows},
            ensure_ascii=False,
            indent=2,
            allow_nan=False,
        ),
        encoding="utf-8",
    )
    display_columns = [
        column
        for column in (
            "rank",
            "code",
            "company_name",
            "market",
            "sector",
            "overall_score",
            "value_score",
            "quality_score",
            "technical_score",
            "liquidity_score",
            "value_trap_risk",
            "data_completeness",
            "positive_reasons",
            "negative_reasons",
        )
        if column in ranking.columns
    ]
    markdown = ["# J-Quants 日本株スクリーニング", "", DISCLAIMER, ""]
    if ranking.empty:
        markdown.append("条件を満たす銘柄はありませんでした。")
    else:
        markdown.append(ranking[display_columns].to_markdown(index=False))
    markdown_path.write_text("\n".join(markdown) + "\n", encoding="utf-8")
    manifest_path.write_text(
        json.dumps(_clean_json(manifest), ensure_ascii=False, indent=2, allow_nan=False),
        encoding="utf-8",
    )
    return {
        "ranking_csv": csv_path,
        "ranking_json": json_path,
        "ranking_markdown": markdown_path,
        "manifest": manifest_path,
    }


def run_screen(
    config: JQuantsScreenConfig,
    provider: JQuantsProvider | Any | None = None,
    sleep_fn: Callable[[float], None] = time.sleep,
) -> dict[str, Path]:
    as_of = _as_timestamp(config.as_of)
    cutoff = effective_cutoff(as_of.date(), config.plan)
    history_start = cutoff - pd.DateOffset(years=config.resolved_history_years)
    config.cache_dir.mkdir(parents=True, exist_ok=True)
    cache_before = _cache_snapshot(config.cache_dir)
    live_provider = provider or JQuantsProvider(
        JQuantsConfig(cache_dir=config.cache_dir, cache_ttl_seconds=86_400, max_retries=3)
    )
    pacer = RequestPacer(config.resolved_requests_per_minute, sleep_fn=sleep_fn)
    warnings: list[str] = []
    endpoints: dict[str, str] = {}

    def fetch(name: str, operation: Callable[[], pd.DataFrame]) -> pd.DataFrame:
        pacer.wait()
        try:
            result = operation()
            endpoints[name] = f"ok:{len(result)}"
            return result
        except JQuantsProviderError as exc:
            endpoints[name] = f"error:{type(exc).__name__}"
            warnings.append(f"{name}: {type(exc).__name__}")
            return pd.DataFrame()

    master = fetch("equities_master", lambda: live_provider.get_master(as_of=cutoff.date()))
    bars = fetch(
        "equities_daily_bars",
        lambda: live_provider.get_daily_bars(start=history_start.date(), end=cutoff.date()),
    )
    financials = fetch(
        "financial_summary",
        lambda: live_provider.get_financial_summary(start=history_start.date(), end=cutoff.date()),
    )
    if master.empty or bars.empty or financials.empty:
        raise RuntimeError(
            "J-Quants screening requires master, daily bars, and financial summary data; "
            f"endpoint status={endpoints}"
        )
    universe = filter_common_stock_universe(master, config.markets, config.max_symbols)
    point_in_time = point_in_time_financials(financials, cutoff)
    codes = set(universe["code"].astype(str))
    histories = build_price_histories(bars, codes, cutoff)
    fundamentals, metadata = build_fundamental_snapshot(universe, point_in_time, histories)
    liquid = fundamentals["average_daily_value"].ge(config.min_average_daily_value)
    fundamentals = fundamentals.loc[liquid.fillna(False)]
    metadata = metadata.reindex(fundamentals.index)
    histories = {code: history for code, history in histories.items() if code in fundamentals.index}
    screen_config = ValueScreenConfig(
        minimum_quality=config.minimum_quality,
        maximum_value_trap_risk=config.maximum_value_trap_risk,
        minimum_data_completeness=config.minimum_data_completeness,
    )
    scored = screen_value_stocks(fundamentals, price_history=histories, config=screen_config)
    scored = scored.join(metadata, how="left")
    scored = scored.join(
        fundamentals[["earnings_yield", "book_to_market", "fcf_yield", "roe", "operating_margin"]],
        how="left",
    )
    scored = scored.reset_index(names="code")
    scored["positive_reasons"] = scored.get("reasons", pd.Series(index=scored.index)).map(
        lambda value: " / ".join(_decode_reasons(value))
    )
    scored["negative_reasons"] = scored.get(
        "filter_reasons", pd.Series(index=scored.index)
    ).map(lambda value: " / ".join(_decode_reasons(value)))
    eligible = scored.loc[scored["eligible"].fillna(False)].copy()
    if eligible.empty:
        warnings.append("No issue passed all eligibility thresholds; output contains the highest scores only.")
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
    cache_after = _cache_snapshot(config.cache_dir)
    manifest = {
        "generated_at": pd.Timestamp.now(tz="UTC").isoformat(),
        "as_of": as_of.date().isoformat(),
        "effective_data_cutoff": cutoff.date().isoformat(),
        "history_start": history_start.date().isoformat(),
        "plan": asdict(config.plan_spec),
        "configured_history_years": config.resolved_history_years,
        "configured_requests_per_minute": config.resolved_requests_per_minute,
        "markets": list(config.markets),
        "minimum_average_daily_value": config.min_average_daily_value,
        "endpoint_coverage": endpoints,
        "universe_count": len(universe),
        "price_history_count": len(histories),
        "point_in_time_financial_rows": len(point_in_time),
        "scored_count": len(scored),
        "eligible_count": int(scored["eligible"].fillna(False).sum()),
        "output_count": len(candidates),
        "cache_before": cache_before,
        "cache_after": cache_after,
        "warnings": warnings,
        "secret_handling": "JQUANTS_API_KEY is read by the provider only and is never written to outputs.",
        "disclaimer": DISCLAIMER,
    }
    return _write_outputs(candidates, config, manifest)


def run_plan_check(
    plan: str,
    out_dir: Path,
    as_of: str | dt.date | None = None,
    provider: JQuantsProvider | Any | None = None,
) -> dict[str, Path]:
    cutoff = effective_cutoff(as_of, plan)
    live_provider = provider or JQuantsProvider(JQuantsConfig(allow_empty=True))
    status: dict[str, Any] = {
        "plan": asdict(PLAN_SPECS[plan]),
        "effective_data_cutoff": cutoff.date().isoformat(),
        "authentication": "configured but redacted",
        "connectivity": "not_checked",
    }
    try:
        master = live_provider.get_master(as_of=cutoff.date())
        status["connectivity"] = "ok"
        status["master_rows"] = len(master)
    except JQuantsProviderError as exc:
        status["connectivity"] = "error"
        status["error_type"] = type(exc).__name__
    out_dir.mkdir(parents=True, exist_ok=True)
    path = out_dir / "plan-check.json"
    path.write_text(
        json.dumps(_clean_json(status), ensure_ascii=False, indent=2, allow_nan=False),
        encoding="utf-8",
    )
    return {"plan_check": path}
