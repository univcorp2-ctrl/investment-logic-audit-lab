# リファクタリングノート

**実施日**: 2026-06-21  
**対象リポジトリ**: investment-logic-audit-lab  

## 変更概要

### 改善した既存ファイル

| ファイル | 主な変更点 |
|---------|-----------|
| `src/investment_audit/backtest.py` | ロギング追加、`dry_run` フラグ追加、日本語コメント、エラーメッセージ改善 |
| `src/investment_audit/data.py` | ロギング追加、リトライ機構 (最大3回)、`validate_prices()` 追加、`dry_run` フラグ追加、日本語エラーメッセージ |

### 新規作成ファイル

| ファイル | 内容 |
|---------|------|
| `src/investment_audit/utils.py` | 共通ユーティリティ (ロギング設定、dry-run判定、指標フォーマット) |
| `.env.example` | 環境変数テンプレート |
| `REFACTORING_NOTES.md` | このファイル |

## dry-run の使い方

```bash
# 環境変数で設定
DRY_RUN=1 python -m investment_audit.cli run --tickers 7203.T 6758.T

# または .env に設定
echo "DRY_RUN=1" > .env
python -m investment_audit.cli run --tickers 7203.T 6758.T
```

## ロギングの使い方

```python
from investment_audit.utils import setup_logging
setup_logging(level="DEBUG", log_file="logs/audit.log")
```

## 主な改善ポイント

1. **ロギング**: 全主要関数で処理開始・完了・警告をログ出力
2. **dry-run フラグ**: `run_backtest()`, `download_prices()` に `dry_run=True` を追加。本番売買前のテスト実行を安全に行える
3. **エラーメッセージ**: 日本語で具体的な原因と対処法を記載
4. **入力検証**: `validate_prices()` による事前チェック
5. **リトライ**: ネットワークエラー時に最大3回リトライ
6. **.env.example**: 環境変数の一元管理テンプレート

## 注意事項

- `.env` ファイルは `.gitignore` に追加済み (`.env.example` のみコミット)
- 本番実行前は必ず `DRY_RUN=1` で動作確認すること
- yfinance は外部 API に依存するため、レート制限に注意
