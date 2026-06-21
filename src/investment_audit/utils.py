from __future__ import annotations

# utils.py - 共通ユーティリティモジュール
# 新規作成 (2026-06-21): ロギング設定・dry-run管理・共通ヘルパー

import logging
import os
import sys
from pathlib import Path


def setup_logging(
    level: str | int = "INFO",
    log_file: str | Path | None = None,
    fmt: str = "%(asctime)s [%(levelname)s] %(name)s: %(message)s",
) -> None:
    """アプリケーション全体のロギングを設定する。

    Args:
        level: ログレベル ("DEBUG" / "INFO" / "WARNING" / "ERROR" または数値)
        log_file: ログファイルパス。None の場合は標準エラーのみ出力
        fmt: ログフォーマット文字列
    """
    handlers: list[logging.Handler] = [logging.StreamHandler(sys.stderr)]
    if log_file is not None:
        log_path = Path(log_file)
        log_path.parent.mkdir(parents=True, exist_ok=True)
        handlers.append(logging.FileHandler(log_path, encoding="utf-8"))

    logging.basicConfig(level=level, format=fmt, handlers=handlers, force=True)
    logging.getLogger(__name__).debug("ロギング設定完了: level=%s", level)


def is_dry_run(cli_flag: bool = False) -> bool:
    """dry-run モードかどうかを判定する。

    環境変数 DRY_RUN=1 または CLI の --dry-run フラグが有効な場合に True を返す。

    Args:
        cli_flag: コマンドライン引数の --dry-run フラグ値

    Returns:
        dry-run モードなら True
    """
    env_flag = os.environ.get("DRY_RUN", "").lower() in ("1", "true", "yes")
    result = cli_flag or env_flag
    if result:
        logging.getLogger(__name__).info(
            "[DRY-RUN] 実際のデータ取得・計算をスキップします。"
            " (環境変数DRY_RUN=%s, CLIフラグ=%s)",
            env_flag, cli_flag,
        )
    return result


def format_metrics(metrics: dict[str, float], prefix: str = "") -> str:
    """パフォーマンス指標を人間が読みやすい文字列にフォーマットする。

    Args:
        metrics: metrics_from_returns() の返り値
        prefix: 各行の先頭に付けるプレフィックス

    Returns:
        フォーマット済みの文字列 (複数行)
    """
    lines = [
        f"{prefix}年率リターン : {metrics.get('annual_return', float('nan')):.2%}",
        f"{prefix}年率ボラ     : {metrics.get('annual_vol', float('nan')):.2%}",
        f"{prefix}シャープ比   : {metrics.get('sharpe', float('nan')):.2f}",
        f"{prefix}最大DD       : {metrics.get('max_drawdown', float('nan')):.2%}",
        f"{prefix}ヒット率     : {metrics.get('hit_rate', float('nan')):.2%}",
        f"{prefix}平均回転率   : {metrics.get('avg_turnover', float('nan')):.2%}",
    ]
    return "\n".join(lines)
