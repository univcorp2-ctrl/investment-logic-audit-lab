# Investment Logic Audit Lab

株式・暗号資産の投資ロジックを、バックテスト、ウォークフォワード検証、手数料感応度、ファンダメンタル・スコアで監査するための研究用リポジトリです。

> 注意: これは投資助言ではありません。実運用前に、データ品質、約定可能性、税金、手数料、スリッページ、流動性、レバレッジ制約を必ず確認してください。

## できること

- 価格データCSVまたは `yfinance` から株式・ETF・暗号資産の価格を取得
- 時系列モメンタム、移動平均トレンド、クロスセクション・モメンタムを比較
- P/E、P/B、ROE、Debt/Equity、売上成長率などを使ったファンダメンタルQuality/Value/Momentumスコア
- インサンプルのバックテストとアウトオブサンプルのウォークフォワードテスト
- 手数料・スリッページ・売買回転率・ドローダウンを含む検証
- Excel / CSV / TXT レポートの自動生成
- GitHub Actions artifact として検証結果を取得
- 過去に作った投資関連リポジトリを棚卸しするRepository inventory workflow

## 最短実行

```bash
python -m venv .venv
source .venv/bin/activate
pip install -e .[dev]
investment-audit sample --out outputs
```

生成物:

- `outputs/summary.csv`
- `outputs/walk_forward.csv`
- `outputs/equity_curve.csv`
- `outputs/report.xlsx`
- `outputs/report.txt`

## GitHub Actionsで実行

1. GitHub の Actions タブを開く
2. `CI` workflow を手動実行、または push する
3. 成功後、artifact `investment-audit-outputs` を開く
4. Excel / CSV / TXT の検証レポートを確認

## 以前作った投資系リポジトリのリストアップ

このリポジトリには `Repository Inventory` workflow を入れています。

Actions から手動実行すると、以下のキーワードでリポジトリ名・説明・topicsを検索します。

```text
stock, stocks, equity, equities, crypto, bitcoin, btc, eth, trading, investment, portfolio, alpha, backtest, finance
```

非公開リポジトリや別organizationまで棚卸ししたい場合は、GitHub Actions Secret に以下を設定します。

| Secret | 用途 |
|---|---|
| `GH_INVENTORY_TOKEN` | repo一覧を読むGitHub Personal Access Token。`repo` または対象org/repoのread権限が必要 |

## 投資ロジックの考え方

このリポジトリでは、以下の順で「本当に残りそうな歪みか」を確認します。

1. **バックテスト**: 過去データで利益・Sharpe・最大DD・回転率を測る
2. **ウォークフォワード**: パラメータを一定期間で再選定し、次の期間だけで検証
3. **コスト耐性**: 手数料・スリッページを上げても残るか確認
4. **ファンダメンタル確認**: 株式はQuality/Value/Momentumで価格シグナルを補強
5. **ロバスト性**: 単一パラメータだけ勝つものを除外し、近傍パラメータでも残るものだけ候補化

## 実運用に必要なもの

| 項目 | 必須度 | 例 |
|---|---:|---|
| 価格データ | 必須 | yfinance, Polygon, Tiingo, Binance, Coinbase, Alpaca |
| ファンダメンタルデータ | 株式では強く推奨 | SEC Company Facts, Financial Modeling Prep, FactSet, Bloomberg |
| 約定・手数料モデル | 必須 | broker fee, maker/taker fee, spread, slippage |
| リスク管理 | 必須 | 最大DD停止、銘柄上限、ボラティリティターゲット、レバレッジ上限 |
| フォワード検証 | 必須 | ペーパートレード、週次・月次の検証レポート |

詳細は `docs/setup.md` と `docs/architecture.md` を参照してください。
