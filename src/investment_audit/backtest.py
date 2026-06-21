from __future__ import annotations

# backtest.py - バックテストエンジン
# リファクタリング (2026-06-21): ロギング追加・dry_runフラグ・エラーメッセージ日本語化

import logging
from dataclasses import dataclass

import numpy as np
import pandas as pd

# 年間取引日数 (株式市場の標準)
TRADING_DAYS = 252

logger = logging.getLogger(__name__)


@dataclass(frozen=True)
class BacktestResult:
    """バックテスト結果を格納するデータクラス。"""
    returns: pd.Series       # 日次純リターン
    equity: pd.Series        # 累積資産曲線
    weights: pd.DataFrame    # ポジション重み (実際に適用した値)
    metrics: dict[str, float]  # パフォーマンス指標 (シャープ比・最大DD等)


def _normalize_weights(raw: pd.DataFrame, max_gross: float = 1.0) -> pd.DataFrame:
    """ポートフォリオ重みをグロスエクスポージャーで正規化する。

    - inf / NaN を 0 に置換してから正規化
    - グロスが max_gross を超える行のみスケールダウン
    """
    raw = raw.replace([np.inf, -np.inf], np.nan).fillna(0.0).astype(float)
    gross = raw.abs().sum(axis=1)
    scale = pd.Series(1.0, index=raw.index)
    needs_scale = gross > max_gross
    if needs_scale.any():
        logger.debug("重みをスケールダウン: %d日", needs_scale.sum())
    scale.loc[needs_scale] = max_gross / gross.loc[needs_scale]
    return raw.mul(scale, axis=0)


def max_drawdown(equity: pd.Series) -> float:
    """最大ドローダウン (負の値) を返す。

    equity が空の場合は 0.0 を返す。
    """
    if equity.empty:
        return 0.0
    peak = equity.cummax()
    drawdown = equity / peak - 1
    return float(drawdown.min())


def metrics_from_returns(
    returns: pd.Series,
    turnover: pd.Series | None = None,
) -> dict[str, float]:
    """リターン系列から主要パフォーマンス指標を計算する。

    Args:
        returns: 日次リターン系列
        turnover: 日次売買代金 (回転率)。Noneの場合は avg_turnover = nan

    Returns:
        年率リターン・年率ボラ・シャープ比・最大DD・ヒット率・平均回転率を含む dict
    """
    returns = returns.dropna()
    if returns.empty:
        logger.warning("リターン系列が空のため、指標を計算できません。")
        return {k: float("nan") for k in
                ["annual_return", "annual_vol", "sharpe", "max_drawdown", "hit_rate", "avg_turnover"]}

    equity = (1 + returns).cumprod()
    n = len(returns)
    years = n / TRADING_DAYS

    annual_return = float(equity.iloc[-1] ** (1 / years) - 1) if years > 0 else float("nan")
    annual_vol = float(returns.std() * np.sqrt(TRADING_DAYS))
    sharpe = annual_return / annual_vol if annual_vol > 0 else float("nan")
    hit_rate = float((returns > 0).mean())
    avg_turnover = float(turnover.mean()) if turnover is not None else float("nan")

    return {
        "annual_return": annual_return,
        "annual_vol": annual_vol,
        "sharpe": sharpe,
        "max_drawdown": max_drawdown(equity),
        "hit_rate": hit_rate,
        "avg_turnover": avg_turnover,
    }


def run_backtest(
    prices: pd.DataFrame,
    signals: pd.DataFrame,
    cost_bps: float = 5.0,
    slippage_bps: float = 2.0,
    max_gross: float = 1.0,
    dry_run: bool = False,
) -> BacktestResult:
    """ベクトル化クローズ・トゥ・クローズ バックテストを実行する。

    翌日シグナル適用方式: t日のシグナル → t+1日の取引・リターン計算

    Args:
        prices: 銘柄×日付の終値 DataFrame
        signals: 銘柄×日付のシグナル DataFrame (正=ロング, 負=ショート)
        cost_bps: 片道コスト (basis points)
        slippage_bps: スリッページ (basis points)
        max_gross: グロスエクスポージャー上限 (1.0 = 100%)
        dry_run: True の場合、ログのみ出力して空の BacktestResult を返す

    Returns:
        BacktestResult (リターン・資産曲線・重み・指標)

    Raises:
        ValueError: prices が空 / signals に未知の銘柄が含まれる
    """
    if prices.empty:
        raise ValueError("prices は空にできません。価格データを確認してください。")

    unknown_cols = set(signals.columns) - set(prices.columns)
    if unknown_cols:
        raise ValueError(f"signals に未知の銘柄が含まれています: {sorted(unknown_cols)}")

    logger.info(
        "バックテスト開始: 銘柄数=%d, 期間=%s〜%s, コスト=%.1fbps, dry_run=%s",
        len(prices.columns),
        prices.index.min().date() if not prices.empty else "N/A",
        prices.index.max().date() if not prices.empty else "N/A",
        cost_bps,
        dry_run,
    )

    if dry_run:
        logger.info("[DRY-RUN] バックテストをスキップします。実際の計算は行いません。")
        empty = pd.Series(dtype=float)
        return BacktestResult(
            returns=empty,
            equity=empty,
            weights=pd.DataFrame(),
            metrics={k: float("nan") for k in
                     ["annual_return", "annual_vol", "sharpe", "max_drawdown", "hit_rate", "avg_turnover"]},
        )

    prices = prices.sort_index().ffill().dropna(how="all")
    signals = signals.reindex(index=prices.index, columns=prices.columns).fillna(0.0)
    asset_returns = prices.pct_change().replace([np.inf, -np.inf], np.nan).fillna(0.0)

    target_weights = _normalize_weights(signals, max_gross=max_gross)
    # 前日の目標重みを翌日に適用 (look-ahead bias 回避)
    weights = target_weights.shift(1).fillna(0.0)

    gross_returns = (weights * asset_returns).sum(axis=1)
    gross_turnover = weights.diff().abs().sum(axis=1).shift(-1).fillna(0.0)
    cost = gross_turnover * ((cost_bps + slippage_bps) / 10_000)
    net_returns = gross_returns - cost
    equity = (1 + net_returns).cumprod()
    metrics = metrics_from_returns(net_returns, gross_turnover)

    logger.info(
        "バックテスト完了: 年率リターン=%.2f%%, シャープ比=%.2f, 最大DD=%.2f%%",
        metrics.get("annual_return", float("nan")) * 100,
        metrics.get("sharpe", float("nan")),
        metrics.get("max_drawdown", float("nan")) * 100,
    )

    return BacktestResult(returns=net_returns, equity=equity, weights=weights, metrics=metrics)


def fee_sensitivity(
    prices: pd.DataFrame,
    signals: pd.DataFrame,
    fee_grid_bps: list[float] | None = None,
) -> pd.DataFrame:
    """同一戦略を複数のコスト水準で実行し、手数料感度分析を行う。

    Args:
        prices: 終値 DataFrame
        signals: シグナル DataFrame
        fee_grid_bps: テストするコスト (bps) のリスト。デフォルト: [0, 5, 10, 25, 50, 100]

    Returns:
        fee_bps 列と各パフォーマンス指標列を持つ DataFrame
    """
    if fee_grid_bps is None:
        fee_grid_bps = [0, 5, 10, 25, 50, 100]

    logger.info("手数料感度分析: %d水準でテスト", len(fee_grid_bps))
    rows = []
    for fee in fee_grid_bps:
        result = run_backtest(prices, signals, cost_bps=fee, slippage_bps=fee / 2)
        rows.append({"fee_bps": fee, **result.metrics})
    return pd.DataFrame(rows)
