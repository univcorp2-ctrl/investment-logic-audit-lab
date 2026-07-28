from __future__ import annotations

import json
from dataclasses import dataclass, field
from typing import Final

import numpy as np
import pandas as pd


@dataclass(frozen=True)
class MetricSpec:
    weight: float
    higher_is_better: bool = True


@dataclass(frozen=True)
class FundamentalConfig:
    """Configuration for robust cross-sectional fundamental scoring."""

    winsor_lower: float = 0.05
    winsor_upper: float = 0.95
    sector_neutral: bool = True
    quality_floor: float = 45.0
    value_weight: float = 0.60
    quality_weight: float = 0.25
    growth_weight: float = 0.15
    trap_penalty_weight: float = 0.35
    value_metrics: dict[str, MetricSpec] = field(
        default_factory=lambda: {
            "earnings_yield": MetricSpec(0.19),
            "book_to_market": MetricSpec(0.13),
            "fcf_yield": MetricSpec(0.20),
            "ev_ebitda": MetricSpec(0.14, higher_is_better=False),
            "dividend_yield": MetricSpec(0.09),
            "shareholder_yield": MetricSpec(0.10),
            "net_cash_to_market_cap": MetricSpec(0.15),
        }
    )
    quality_metrics: dict[str, MetricSpec] = field(
        default_factory=lambda: {
            "roe": MetricSpec(0.13),
            "roic": MetricSpec(0.17),
            "gross_profitability": MetricSpec(0.13),
            "operating_margin": MetricSpec(0.12),
            "fcf_conversion": MetricSpec(0.13),
            "debt_to_ebitda": MetricSpec(0.12, higher_is_better=False),
            "accrual_quality": MetricSpec(0.10),
            "earnings_stability": MetricSpec(0.05),
            "fcf_stability": MetricSpec(0.05),
        }
    )
    growth_metrics: dict[str, MetricSpec] = field(
        default_factory=lambda: {
            "revenue_growth": MetricSpec(0.25),
            "eps_growth": MetricSpec(0.25),
            "fcf_growth": MetricSpec(0.20),
            "margin_stability": MetricSpec(0.15),
            "earnings_volatility": MetricSpec(0.15, higher_is_better=False),
        }
    )


ALIASES: Final[dict[str, tuple[str, ...]]] = {
    "sector": ("sector", "Sector", "sector_name", "industry"),
    "market_cap": ("market_cap", "MarketCap", "market_capitalization"),
    "enterprise_value": ("enterprise_value", "EnterpriseValue", "ev"),
    "net_income": ("net_income", "NetIncome", "profit"),
    "book_value": ("book_value", "BookValue", "equity"),
    "free_cash_flow": ("free_cash_flow", "FreeCashFlow", "fcf"),
    "ebitda": ("ebitda", "EBITDA"),
    "dividends": ("dividends", "cash_dividends", "dividend_amount"),
    "buybacks": ("buybacks", "share_buybacks", "net_buybacks"),
    "net_cash": ("net_cash", "cash_minus_debt"),
    "revenue": ("revenue", "Revenue", "sales"),
    "gross_profit": ("gross_profit", "GrossProfit"),
    "operating_income": ("operating_income", "OperatingIncome"),
    "operating_cash_flow": ("operating_cash_flow", "OperatingCashFlow", "cfo"),
    "total_assets": ("total_assets", "TotalAssets", "assets"),
    "invested_capital": ("invested_capital", "InvestedCapital"),
    "total_debt": ("total_debt", "TotalDebt", "debt"),
    "current_ratio": ("current_ratio", "CurrentRatio"),
    "asset_turnover": ("asset_turnover", "AssetTurnover"),
    "shares_outstanding": ("shares_outstanding", "SharesOutstanding"),
}


def _coalesce(frame: pd.DataFrame, name: str) -> pd.Series:
    result = pd.Series(np.nan, index=frame.index, dtype=float)
    aliases = ALIASES.get(name, (name,))
    for column in aliases:
        if column in frame.columns:
            candidate = pd.to_numeric(frame[column], errors="coerce")
            result = result.combine_first(candidate)
    return result.replace([np.inf, -np.inf], np.nan)


def _direct(frame: pd.DataFrame, *names: str) -> pd.Series:
    result = pd.Series(np.nan, index=frame.index, dtype=float)
    for name in names:
        if name in frame.columns:
            result = result.combine_first(pd.to_numeric(frame[name], errors="coerce"))
    return result.replace([np.inf, -np.inf], np.nan)


def _safe_divide(numerator: pd.Series, denominator: pd.Series) -> pd.Series:
    denominator = denominator.where(denominator.abs() > 1e-12)
    return (numerator / denominator).replace([np.inf, -np.inf], np.nan)


def derive_fundamental_metrics(frame: pd.DataFrame) -> pd.DataFrame:
    """Create a standard metric schema without replacing missing values with zero."""

    metrics = pd.DataFrame(index=frame.index)
    market_cap = _coalesce(frame, "market_cap")
    enterprise_value = _coalesce(frame, "enterprise_value")
    net_income = _coalesce(frame, "net_income")
    book_value = _coalesce(frame, "book_value")
    fcf = _coalesce(frame, "free_cash_flow")
    ebitda = _coalesce(frame, "ebitda")
    revenue = _coalesce(frame, "revenue")
    gross_profit = _coalesce(frame, "gross_profit")
    operating_income = _coalesce(frame, "operating_income")
    cfo = _coalesce(frame, "operating_cash_flow")
    assets = _coalesce(frame, "total_assets")
    invested_capital = _coalesce(frame, "invested_capital")
    debt = _coalesce(frame, "total_debt")

    metrics["earnings_yield"] = _direct(frame, "earnings_yield").combine_first(
        _safe_divide(net_income, market_cap)
    )
    book_to_market = _direct(frame, "book_to_market")
    pbr = _direct(frame, "pbr", "price_to_book")
    metrics["book_to_market"] = book_to_market.combine_first(_safe_divide(book_value, market_cap))
    metrics["book_to_market"] = metrics["book_to_market"].combine_first(_safe_divide(1.0, pbr))
    metrics["fcf_yield"] = _direct(frame, "fcf_yield").combine_first(_safe_divide(fcf, market_cap))
    metrics["ev_ebitda"] = _direct(frame, "ev_ebitda").combine_first(
        _safe_divide(enterprise_value, ebitda)
    )
    metrics["dividend_yield"] = _direct(frame, "dividend_yield").combine_first(
        _safe_divide(_coalesce(frame, "dividends"), market_cap)
    )
    shareholder_cash = _coalesce(frame, "dividends") + _coalesce(frame, "buybacks")
    metrics["shareholder_yield"] = _direct(frame, "shareholder_yield").combine_first(
        _safe_divide(shareholder_cash, market_cap)
    )
    metrics["net_cash_to_market_cap"] = _direct(frame, "net_cash_to_market_cap").combine_first(
        _safe_divide(_coalesce(frame, "net_cash"), market_cap)
    )

    metrics["roe"] = _direct(frame, "roe").combine_first(_safe_divide(net_income, book_value))
    nopat = _direct(frame, "nopat").combine_first(operating_income * 0.70)
    metrics["roic"] = _direct(frame, "roic").combine_first(_safe_divide(nopat, invested_capital))
    metrics["gross_profitability"] = _direct(frame, "gross_profitability").combine_first(
        _safe_divide(gross_profit, assets)
    )
    metrics["operating_margin"] = _direct(frame, "operating_margin").combine_first(
        _safe_divide(operating_income, revenue)
    )
    metrics["fcf_conversion"] = _direct(frame, "fcf_conversion").combine_first(
        _safe_divide(fcf, net_income.abs())
    )
    metrics["debt_to_ebitda"] = _direct(frame, "debt_to_ebitda").combine_first(
        _safe_divide(debt, ebitda)
    )
    metrics["accrual_quality"] = _direct(frame, "accrual_quality").combine_first(
        _safe_divide(cfo - net_income, assets)
    )
    metrics["earnings_stability"] = _direct(frame, "earnings_stability")
    metrics["fcf_stability"] = _direct(frame, "fcf_stability")

    metrics["revenue_growth"] = _direct(frame, "revenue_growth", "sales_growth")
    metrics["eps_growth"] = _direct(frame, "eps_growth", "earnings_growth")
    metrics["fcf_growth"] = _direct(frame, "fcf_growth")
    metrics["margin_stability"] = _direct(frame, "margin_stability")
    metrics["earnings_volatility"] = _direct(frame, "earnings_volatility")

    passthrough = {
        "net_income": net_income,
        "free_cash_flow": fcf,
        "operating_cash_flow": cfo,
        "total_assets": assets,
        "debt_to_ebitda_change": _direct(frame, "debt_to_ebitda_change", "leverage_change"),
        "share_count_growth": _direct(frame, "share_count_growth", "dilution_rate"),
        "operating_margin_change": _direct(frame, "operating_margin_change", "margin_change"),
        "roa_change": _direct(frame, "roa_change"),
        "current_ratio_change": _direct(frame, "current_ratio_change"),
        "gross_margin_change": _direct(frame, "gross_margin_change"),
        "asset_turnover_change": _direct(frame, "asset_turnover_change"),
        "negative_earnings_years": _direct(frame, "negative_earnings_years"),
        "negative_fcf_years": _direct(frame, "negative_fcf_years"),
    }
    for name, values in passthrough.items():
        metrics[name] = values
    return metrics.replace([np.inf, -np.inf], np.nan)


def _percentile_score(
    values: pd.Series,
    higher_is_better: bool,
    lower_quantile: float,
    upper_quantile: float,
) -> pd.Series:
    clean = pd.to_numeric(values, errors="coerce").replace([np.inf, -np.inf], np.nan)
    valid = clean.dropna()
    output = pd.Series(np.nan, index=clean.index, dtype=float)
    if valid.empty:
        return output
    lower = float(valid.quantile(lower_quantile))
    upper = float(valid.quantile(upper_quantile))
    clipped = clean.clip(lower=lower, upper=upper)
    valid_clipped = clipped.dropna()
    if valid_clipped.nunique() <= 1:
        output.loc[valid_clipped.index] = 50.0
        return output
    ranked = valid_clipped.rank(method="average", pct=True) * 100.0
    if not higher_is_better:
        ranked = 100.0 - ranked
    output.loc[ranked.index] = ranked
    return output.clip(0.0, 100.0)


def _score_metric(
    values: pd.Series,
    spec: MetricSpec,
    config: FundamentalConfig,
    sectors: pd.Series | None,
) -> pd.Series:
    global_score = _percentile_score(
        values,
        spec.higher_is_better,
        config.winsor_lower,
        config.winsor_upper,
    )
    if not config.sector_neutral or sectors is None:
        return global_score
    output = global_score.copy()
    sector_values = sectors.fillna("__UNKNOWN__").astype(str)
    for _, index in sector_values.groupby(sector_values).groups.items():
        index_list = list(index)
        if values.loc[index_list].notna().sum() < 3:
            continue
        output.loc[index_list] = _percentile_score(
            values.loc[index_list],
            spec.higher_is_better,
            config.winsor_lower,
            config.winsor_upper,
        )
    return output


def _weighted_score(
    scores: dict[str, pd.Series], specs: dict[str, MetricSpec]
) -> tuple[pd.Series, pd.Series]:
    if not scores:
        return pd.Series(dtype=float), pd.Series(dtype=float)
    index = next(iter(scores.values())).index
    numerator = pd.Series(0.0, index=index)
    denominator = pd.Series(0.0, index=index)
    total_weight = sum(spec.weight for spec in specs.values())
    for name, spec in specs.items():
        score = scores[name]
        available = score.notna()
        numerator = numerator.add(score.fillna(0.0) * spec.weight, fill_value=0.0)
        denominator = denominator.add(available.astype(float) * spec.weight, fill_value=0.0)
    composite = numerator.div(denominator.where(denominator > 0)).clip(0.0, 100.0)
    completeness = (denominator / total_weight * 100.0).clip(0.0, 100.0)
    return composite, completeness


def _piotroski_like(metrics: pd.DataFrame) -> tuple[pd.Series, pd.Series]:
    tests = pd.DataFrame(index=metrics.index)

    def add(name: str, values: pd.Series, predicate: pd.Series) -> None:
        tests[name] = predicate.astype(float).where(values.notna())

    roa = _safe_divide(metrics["net_income"], metrics["total_assets"])
    add("positive_roa", roa, roa > 0)
    add(
        "positive_cfo",
        metrics["operating_cash_flow"],
        metrics["operating_cash_flow"] > 0,
    )
    add("improving_roa", metrics["roa_change"], metrics["roa_change"] > 0)
    accrual_values = metrics[["operating_cash_flow", "net_income"]].min(axis=1, skipna=False)
    add(
        "cash_exceeds_profit",
        accrual_values,
        metrics["operating_cash_flow"] > metrics["net_income"],
    )
    add(
        "lower_leverage",
        metrics["debt_to_ebitda_change"],
        metrics["debt_to_ebitda_change"] < 0,
    )
    add(
        "better_liquidity",
        metrics["current_ratio_change"],
        metrics["current_ratio_change"] > 0,
    )
    add(
        "no_dilution",
        metrics["share_count_growth"],
        metrics["share_count_growth"] <= 0,
    )
    add(
        "better_margin",
        metrics["gross_margin_change"],
        metrics["gross_margin_change"] > 0,
    )
    add(
        "better_turnover",
        metrics["asset_turnover_change"],
        metrics["asset_turnover_change"] > 0,
    )
    return tests.sum(axis=1, min_count=1), tests.notna().sum(axis=1) / len(tests.columns) * 100.0


def _value_trap_risk(metrics: pd.DataFrame, completeness: pd.Series) -> pd.Series:
    indicators = pd.DataFrame(index=metrics.index)
    indicators["loss"] = (metrics["net_income"] < 0).astype(float).where(metrics["net_income"].notna())
    indicators["persistent_loss"] = (metrics["negative_earnings_years"] >= 2).astype(float).where(
        metrics["negative_earnings_years"].notna()
    )
    indicators["negative_fcf"] = (metrics["free_cash_flow"] < 0).astype(float).where(
        metrics["free_cash_flow"].notna()
    )
    indicators["persistent_negative_fcf"] = (metrics["negative_fcf_years"] >= 2).astype(float).where(
        metrics["negative_fcf_years"].notna()
    )
    indicators["leverage_worsening"] = (metrics["debt_to_ebitda_change"] > 0.5).astype(float).where(
        metrics["debt_to_ebitda_change"].notna()
    )
    indicators["high_leverage"] = (metrics["debt_to_ebitda"] > 4.0).astype(float).where(
        metrics["debt_to_ebitda"].notna()
    )
    indicators["dilution"] = (metrics["share_count_growth"] > 0.03).astype(float).where(
        metrics["share_count_growth"].notna()
    )
    indicators["revenue_decline"] = (metrics["revenue_growth"] < -0.10).astype(float).where(
        metrics["revenue_growth"].notna()
    )
    indicators["margin_decline"] = (metrics["operating_margin_change"] < -0.03).astype(float).where(
        metrics["operating_margin_change"].notna()
    )
    weights = pd.Series(
        {
            "loss": 1.0,
            "persistent_loss": 1.5,
            "negative_fcf": 1.0,
            "persistent_negative_fcf": 1.5,
            "leverage_worsening": 1.0,
            "high_leverage": 1.2,
            "dilution": 0.8,
            "revenue_decline": 0.8,
            "margin_decline": 0.8,
        }
    )
    numerator = indicators.mul(weights, axis=1).sum(axis=1, min_count=1)
    denominator = indicators.notna().mul(weights, axis=1).sum(axis=1)
    observed_risk = numerator.div(denominator.where(denominator > 0)) * 100.0
    observed_risk = observed_risk.fillna(50.0)
    missing_penalty = (100.0 - completeness) * 0.30
    return (observed_risk * 0.70 + missing_penalty).clip(0.0, 100.0)


def score_fundamentals(
    frame: pd.DataFrame,
    config: FundamentalConfig | None = None,
) -> pd.DataFrame:
    """Score valuation, quality, growth and value-trap risk on a 0-100 scale."""

    if frame.empty:
        return pd.DataFrame(index=frame.index)
    config = config or FundamentalConfig()
    metrics = derive_fundamental_metrics(frame)
    sectors = None
    for column in ALIASES["sector"]:
        if column in frame.columns:
            sectors = frame[column]
            break

    all_scores: dict[str, pd.Series] = {}
    group_results: dict[str, tuple[pd.Series, pd.Series]] = {}
    for group_name, specs in (
        ("value", config.value_metrics),
        ("quality", config.quality_metrics),
        ("growth_stability", config.growth_metrics),
    ):
        group_scores: dict[str, pd.Series] = {}
        for metric, spec in specs.items():
            score = _score_metric(metrics[metric], spec, config, sectors)
            group_scores[metric] = score
            all_scores[metric] = score
        group_results[group_name] = _weighted_score(group_scores, specs)

    value_score, value_completeness = group_results["value"]
    quality_score, quality_completeness = group_results["quality"]
    growth_score, growth_completeness = group_results["growth_stability"]
    total_metric_weight = (
        sum(spec.weight for spec in config.value_metrics.values())
        + sum(spec.weight for spec in config.quality_metrics.values())
        + sum(spec.weight for spec in config.growth_metrics.values())
    )
    weighted_available = (
        value_completeness * sum(spec.weight for spec in config.value_metrics.values())
        + quality_completeness * sum(spec.weight for spec in config.quality_metrics.values())
        + growth_completeness * sum(spec.weight for spec in config.growth_metrics.values())
    )
    data_completeness = (weighted_available / total_metric_weight).clip(0.0, 100.0)
    trap_risk = _value_trap_risk(metrics, data_completeness)
    quality_penalty = (config.quality_floor - quality_score).clip(lower=0.0) * 0.80
    base_score = (
        value_score.fillna(50.0) * config.value_weight
        + quality_score.fillna(50.0) * config.quality_weight
        + growth_score.fillna(50.0) * config.growth_weight
    )
    undervaluation = (
        base_score - quality_penalty.fillna(0.0) - trap_risk * config.trap_penalty_weight
    ).clip(0.0, 100.0)
    confidence = (data_completeness * (1.0 - trap_risk / 150.0)).clip(0.0, 100.0)
    piotroski, piotroski_completeness = _piotroski_like(metrics)

    output = pd.DataFrame(index=frame.index)
    output["undervaluation_score"] = undervaluation
    output["value_score"] = value_score
    output["quality_score"] = quality_score
    output["growth_stability_score"] = growth_score
    output["value_trap_risk"] = trap_risk
    output["data_completeness"] = data_completeness
    output["confidence"] = confidence
    output["piotroski_f_score"] = piotroski
    output["piotroski_completeness"] = piotroski_completeness
    output["value_data_completeness"] = value_completeness
    output["quality_data_completeness"] = quality_completeness
    output["growth_data_completeness"] = growth_completeness

    for metric, score in all_scores.items():
        output[f"{metric}_score"] = score
        if metric in config.value_metrics:
            weight = config.value_metrics[metric].weight * config.value_weight
        elif metric in config.quality_metrics:
            weight = config.quality_metrics[metric].weight * config.quality_weight
        else:
            weight = config.growth_metrics[metric].weight * config.growth_weight
        output[f"{metric}_contribution"] = (score - 50.0) * weight

    labels = {
        "earnings_yield": "利益利回り",
        "book_to_market": "純資産価値",
        "fcf_yield": "FCF利回り",
        "ev_ebitda": "EV/EBITDA",
        "net_cash_to_market_cap": "ネットキャッシュ",
        "roic": "ROIC",
        "gross_profitability": "粗利益収益性",
    }
    reasons: list[str] = []
    for index in output.index:
        row_reasons: list[str] = []
        ranked_metrics = sorted(
            ((name, all_scores[name].loc[index]) for name in all_scores),
            key=lambda item: -1 if pd.isna(item[1]) else -float(item[1]),
        )
        for name, score in ranked_metrics:
            if pd.notna(score) and score >= 70 and len(row_reasons) < 3:
                row_reasons.append(f"{labels.get(name, name)}が相対的に良好")
        if trap_risk.loc[index] >= 60:
            row_reasons.append("バリュートラップ要因が強い")
        if data_completeness.loc[index] < 50:
            row_reasons.append("データ不足のため信頼度が低い")
        reasons.append(json.dumps(row_reasons or ["中立的な評価"], ensure_ascii=False))
    output["reasons"] = reasons
    return output.replace([np.inf, -np.inf], np.nan)
