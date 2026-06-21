from __future__ import annotations

# data.py - 価格データ取得・読み込みモジュール
# リファクタリング (2026-06-21): ロギング追加・エラーメッセージ日本語化・入力検証強化

import logging
import time
from collections.abc import Iterable
from pathlib import Path

import numpy as np
import pandas as pd

logger = logging.getLogger(__name__)

# 価格データの最大リトライ回数 (ネットワークエラー時)
_MAX_RETRY = 3
_RETRY_WAIT_SEC = 2.0


def load_price_csv(path: str | Path, date_col: str = "date") -> pd.DataFrame:
    """CSVファイルから終値の Wide DataFrame を読み込む。

    Args:
        path: CSVファイルのパス
        date_col: 日付列の列名 (デフォルト: "date")

    Returns:
        日付インデックス・銘柄列の終値 DataFrame (前方補完済み)

    Raises:
        FileNotFoundError: ファイルが存在しない
        ValueError: 日付列がない / 数値列が1つもない
    """
    path = Path(path)
    if not path.exists():
        raise FileNotFoundError(f"価格CSVファイルが見つかりません: {path}")

    logger.info("価格CSV読み込み開始: %s", path)
    df = pd.read_csv(path)

    if date_col not in df.columns:
        raise ValueError(
            f"CSVに '{date_col}' 列が必要です。"
            f"実際の列名: {list(df.columns)}"
        )

    df[date_col] = pd.to_datetime(df[date_col], utc=False)
    prices = df.set_index(date_col).sort_index()
    prices = prices.apply(pd.to_numeric, errors="coerce").dropna(how="all")

    if prices.empty:
        raise ValueError(
            f"{path} に有効な数値価格列が見つかりませんでした。"
            "列の型・内容を確認してください。"
        )

    prices = prices.ffill()
    logger.info(
        "価格CSV読み込み完了: 銘柄数=%d, 期間=%s〜%s, 行数=%d",
        len(prices.columns),
        prices.index.min().date(),
        prices.index.max().date(),
        len(prices),
    )
    return prices


def download_prices(
    tickers: Iterable[str],
    start: str = "2018-01-01",
    end: str | None = None,
    interval: str = "1d",
    dry_run: bool = False,
) -> pd.DataFrame:
    """yfinance を使って修正後終値をダウンロードする。

    テスト環境ではこの関数をモックして使用し、ネットワーク依存を避けること。

    Args:
        tickers: ティッカーシンボルのリスト (例: ["7203.T", "6758.T"])
        start: 取得開始日 (YYYY-MM-DD)
        end: 取得終了日 (YYYY-MM-DD)。None の場合は今日まで
        interval: データ間隔 ("1d", "1wk", "1mo")
        dry_run: True の場合、実際のダウンロードを行わず空の DataFrame を返す

    Returns:
        日付インデックス・銘柄列の終値 DataFrame

    Raises:
        ValueError: 有効なデータが取得できなかった場合
        ImportError: yfinance がインストールされていない場合
    """
    tickers = list(tickers)
    if not tickers:
        raise ValueError("tickers が空です。1つ以上の銘柄を指定してください。")

    logger.info(
        "価格データダウンロード開始: 銘柄数=%d, 開始=%s, 終了=%s, dry_run=%s",
        len(tickers), start, end or "today", dry_run,
    )

    if dry_run:
        logger.info("[DRY-RUN] ダウンロードをスキップします。空の DataFrame を返します。")
        return pd.DataFrame()

    try:
        import yfinance as yf
    except ImportError as e:
        raise ImportError(
            "yfinance がインストールされていません。"
            "pip install yfinance でインストールしてください。"
        ) from e

    # リトライ付きダウンロード
    last_error: Exception | None = None
    for attempt in range(1, _MAX_RETRY + 1):
        try:
            raw = yf.download(
                tickers,
                start=start,
                end=end,
                interval=interval,
                auto_adjust=True,
                progress=False,
            )
            break
        except Exception as exc:
            last_error = exc
            if attempt < _MAX_RETRY:
                logger.warning(
                    "ダウンロード失敗 (試行 %d/%d): %s - %.1f秒後にリトライ",
                    attempt, _MAX_RETRY, exc, _RETRY_WAIT_SEC,
                )
                time.sleep(_RETRY_WAIT_SEC)
            else:
                raise RuntimeError(
                    f"価格データのダウンロードに {_MAX_RETRY} 回失敗しました。"
                    f"ネットワーク接続とティッカーシンボルを確認してください。"
                ) from exc

    # 複数銘柄の場合は "Close" 列を抽出
    if isinstance(raw.columns, pd.MultiIndex):
        prices = raw["Close"] if "Close" in raw.columns.get_level_values(0) else raw.iloc[:, raw.columns.get_level_values(0) == "Adj Close"]
        if hasattr(prices, 'columns'):
            prices.columns = [c if isinstance(c, str) else c[0] for c in prices.columns]
    else:
        prices = raw[["Close"]] if "Close" in raw.columns else raw

    prices = prices.apply(pd.to_numeric, errors="coerce").replace([np.inf, -np.inf], np.nan)
    prices = prices.dropna(how="all").ffill()

    if prices.empty:
        raise ValueError(
            f"指定した銘柄 {tickers} の価格データを取得できませんでした。"
            "ティッカーシンボルと日付範囲を確認してください。"
        )

    logger.info(
        "価格データダウンロード完了: 銘柄数=%d, 行数=%d, 欠損率=%.1f%%",
        len(prices.columns),
        len(prices),
        prices.isna().mean().mean() * 100,
    )
    return prices


def validate_prices(prices: pd.DataFrame, min_periods: int = 252) -> None:
    """価格 DataFrame の基本的な整合性チェックを行う。

    Args:
        prices: 検証対象の終値 DataFrame
        min_periods: 必要な最低データ期間数 (デフォルト: 252 = 約1年)

    Raises:
        ValueError: データが不足している / 負の価格がある
    """
    if prices.empty:
        raise ValueError("prices が空です。")
    if len(prices) < min_periods:
        raise ValueError(
            f"データが不足しています: {len(prices)}行 < 必要最低{min_periods}行。"
            "分析期間を短くするか、より長いデータを用意してください。"
        )
    if (prices < 0).any().any():
        neg_cols = prices.columns[(prices < 0).any()].tolist()
        raise ValueError(f"負の価格が含まれる銘柄: {neg_cols}")
    logger.debug("価格データ検証OK: %d銘柄 × %d日", len(prices.columns), len(prices))
