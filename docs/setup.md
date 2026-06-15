# Setup Guide

## 1. Codespacesで開く

GitHubのリポジトリ画面で `Code` → `Codespaces` → `Create codespace on main` を押すだけで開発環境が立ち上がります。

起動後は自動で以下が実行されます。

```bash
pip install -e .[dev]
```

## 2. サンプル検証を実行

```bash
investment-audit sample --out outputs
```

## 3. 自分の価格データで検証

CSVはwide形式にしてください。

```csv
date,SPY,BTC-USD,ETH-USD
2022-01-03,477.71,46458.12,3765.99
2022-01-04,477.55,45897.58,3794.06
```

実行例:

```bash
investment-audit run \
  --prices data/my_prices.csv \
  --strategy ts_mom \
  --lookback 126 \
  --skip 1 \
  --cost-bps 5 \
  --slippage-bps 2 \
  --out outputs/my_run
```

## 4. ファンダメンタル投資までやる場合

株式では最低限、以下の列を用意します。

```csv
ticker,pe,pb,roe,debt_to_equity,revenue_growth,free_cash_flow_margin,gross_margin
AAPL,28.1,39.2,1.48,1.5,0.02,0.22,0.46
```

現在の実装はスコア関数を提供しています。実運用では、提出日・公表日を持った時系列データに変換し、過去時点で見えていた値だけを使ってください。

## 5. 以前作った投資関連repoを棚卸し

`python -m investment_audit.github_repos --out outputs/repo_inventory` で、見える範囲の投資関連repoをCSV/JSON化できます。

非公開repoも含める場合は、環境変数 `GH_INVENTORY_TOKEN` に対象repo/orgのread権限を持つPATを設定してください。

## 6. 本番運用前のチェックリスト

- データは分割・配当調整済みか
- 暗号資産は取引所ごとの差、上場廃止、API停止期間を含むか
- 手数料、spread、slippage、税金を入れたか
- 出来高に対して大きすぎる注文を出していないか
- ルックアヘッド、サバイバーシップバイアス、銘柄選定バイアスがないか
- パラメータ近傍でも利益が残るか
- 完全に未使用の期間でフォワード検証したか
- paper tradingで最低1〜3か月の運用ログを取ったか
