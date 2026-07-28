# Investment Logic Audit Lab

日本株を含む株式ユニバースに対して、**割安性・企業品質・成長安定性・バリュートラップ・テクニカル・流動性**を統合評価し、候補銘柄を説明付きで順位付けするPythonツールキットです。

過去データを使った検証では、ファンダメンタル情報の公表ラグ、翌期執行、売買コスト、スリッページ、売買回転率を考慮します。将来のJ-Quants API V2接続に備えた任意依存プロバイダーも含みます。

> **重要:** 本リポジトリは調査・検証用であり、投資助言ではありません。実取引の前に、データのpoint-in-time性、上場廃止銘柄を含むユニバース、企業行動、税・借株・市場インパクトを別途確認してください。

## 主な機能

### ファンダメンタル分析

- Value: earnings yield、book-to-market、FCF yield、EV/EBITDA、配当利回り、株主還元利回り、ネットキャッシュ比率
- Quality: ROE、ROIC、gross profitability、営業利益率、FCF conversion、debt/EBITDA、accrual quality、利益・FCF安定性
- Growth / Stability: 売上・EPS・FCF成長、マージン安定性、利益変動性
- Value trap: 継続赤字、継続的な負のFCF、レバレッジ悪化、希薄化、売上・利益率悪化、データ不足
- 欠損を0で埋めず、利用可能な指標だけで重みを再正規化
- 5%/95% winsorize、percentile rank、任意の業種中立化
- Piotroski F-score相当の部分評価と充足率
- 0–100スコア、指標別寄与、判定理由、信頼度

### テクニカル分析

- SMA 20/50/200、EMA 20
- RSI 14、MACD 12/26/9、Bollinger Bands
- ATR 14、ADX 14、年率ボラティリティ
- 52週高安位置、63/126/252営業日のrelative strength
- 出来高トレンド、63日ブレイクアウト、平均売買代金
- trend、momentum、mean reversion、riskのサブスコア
- 売買判断用`decision_score`は1期間遅延し、当日終値の先読みを防止

### 割安株スクリーナー

デフォルトの総合スコアは次の配分です。

```text
overall_score
  = 65% × undervaluation_score
  + 25% × technical_score
  + 10% × liquidity_risk_score
```

デフォルト除外条件:

- `quality_score < 40`
- `value_trap_risk > 60`
- `data_completeness < 45`
- `liquidity_score < 20`

すべて設定で変更できます。

### 検証

- 月次または週次リバランス
- 上位N銘柄
- 等ウェイトまたはスコアウェイト
- ファンダメンタル公表ラグ
- 翌営業日執行
- 手数料、スリッページ、turnover
- CAGR、年率ボラティリティ、Sharpe、Sortino、Calmar、最大ドローダウン、勝率、exposure、ベンチマーク超過
- top-N、コスト、公表ラグの近傍感度をまとめるrobustness summary

## セットアップ

```bash
python -m venv .venv
source .venv/bin/activate  # Windows PowerShell: .venv\Scripts\Activate.ps1
python -m pip install --upgrade pip
pip install -e ".[dev]"
```

Parquetを使う場合:

```bash
pip install -e ".[parquet]"
```

J-Quants API V2を使う場合:

```bash
pip install -e ".[jquants]"
```

## 最短デモ

完全オフラインで割安株スクリーナーを実行します。

```bash
investment-audit value-screen-demo \
  --out outputs/value-ranking.csv \
  --json outputs/value-ranking.json
```

既存の戦略監査デモ:

```bash
investment-audit sample --out outputs
```

## 実データで割安株を順位付け

```bash
investment-audit value-screen \
  --fundamentals data/fundamentals.csv \
  --technical data/technical.csv \
  --out outputs/value-ranking.csv \
  --json outputs/value-ranking.json
```

CSVとParquetに対応します。先頭列を銘柄コードのindexとして読み込みます。銘柄コードは文字列で保存し、先頭ゼロを失わないようにしてください。

### ファンダメンタル入力

直接指標を渡すことも、金額項目から導出させることもできます。代表的な入力列:

```text
sector, market_cap, enterprise_value, net_income, book_value,
free_cash_flow, ebitda, dividends, buybacks, net_cash,
revenue, gross_profit, operating_income, operating_cash_flow,
total_assets, invested_capital, total_debt,
revenue_growth, eps_growth, fcf_growth,
margin_stability, earnings_volatility,
earnings_stability, fcf_stability,
share_count_growth, debt_to_ebitda_change,
operating_margin_change, negative_earnings_years,
negative_fcf_years, average_daily_value
```

欠けている列は欠損として扱われ、0には置換されません。業種中立評価は同一業種に有効値が3銘柄以上ある場合に適用し、それ未満では全体順位へフォールバックします。

### テクニカル入力

銘柄コードをindexとして、次の列を任意で渡せます。

```text
technical_score, risk_score, average_dollar_volume_20d
```

Python APIでは銘柄ごとのOHLCV履歴を`price_history`として渡し、テクニカル指標を内部計算できます。

## Python API

```python
import pandas as pd

from investment_audit.screening import ValueScreenConfig, screen_value_stocks

fundamentals = pd.read_csv("data/fundamentals.csv", index_col=0)
technical = pd.read_csv("data/technical.csv", index_col=0)

ranking = screen_value_stocks(
    fundamentals,
    technical_scores=technical,
    config=ValueScreenConfig(
        minimum_quality=45,
        maximum_value_trap_risk=50,
        minimum_data_completeness=60,
    ),
)

print(ranking.loc[ranking["eligible"]].head(20))
```

## J-Quants API V2準備

公式Python clientの`jquantsapi.ClientV2`を任意依存として利用します。APIキーは環境変数だけから読み、ログ・キャッシュキー・Git履歴へ含めません。

```bash
export JQUANTS_API_KEY="..."  # 実値はローカル環境だけに設定
```

PowerShell:

```powershell
$env:JQUANTS_API_KEY="..."
```

```python
from investment_audit.providers import JQuantsProvider

provider = JQuantsProvider()
master = provider.get_master(as_of="2026-07-01")
bars = provider.get_daily_bars(code="13010", start="2026-01-01", end="2026-07-01")
financials = provider.get_financial_summary(code="13010", start="2025-01-01", end="2026-07-01")
```

対応対象:

- 上場銘柄マスタ: `/v2/equities/master`
- 日次株価: `/v2/equities/bars/daily`
- 財務サマリー: `/v2/fins/summary`

CIでは実APIを呼びません。Fake Clientにより認証未設定、任意依存未導入、429、5xx、空応答、期間取得、ページ結合、キャッシュ、銘柄コード文字列保持を検証します。

詳細は[`docs/jquants-v2.md`](docs/jquants-v2.md)を参照してください。

## バックテスト例

```python
from investment_audit.portfolio import RankedPortfolioConfig, run_ranked_portfolio

result = run_ranked_portfolio(
    prices=prices_wide,
    scores=point_in_time_scores_wide,
    config=RankedPortfolioConfig(
        top_n=20,
        rebalance="monthly",
        weighting="equal",
        fundamental_lag_days=20,
        cost_bps=5,
        slippage_bps=2,
    ),
)

print(result.metrics)
```

スコアは公表日時基準で作成してください。`fundamental_lag_days`は安全側の追加ラグであり、元データ自体のpoint-in-time整備を代替しません。

## 品質ゲート

GitHub ActionsはPython 3.11 / 3.12で次を実行します。

```bash
ruff check ...
mypy ...
pytest --cov-fail-under=85 ...
pytest
pytest
```

最初のcoverage実行に加えて同じ全テストを2回再実行し、flakyな挙動を検出します。J-QuantsのテストはネットワークとSecretに依存しません。

## 設計資料

- [スコアリング方法](docs/scoring-methodology.md)
- [J-Quants API V2連携](docs/jquants-v2.md)
- [バックテスト前提](docs/backtest-assumptions.md)
- [既存アーキテクチャ](docs/architecture.md)

## 既知の限界

- 銘柄ユニバースに上場廃止銘柄がなければサバイバーシップバイアスが残ります。
- 財務数値は決算期末日ではなく、公表日時以降だけ利用可能にする必要があります。
- 分割・併合・配当等は調整済み価格の品質に依存します。
- 小型株では表示価格で約定できないため、流動性制約と市場インパクトモデルが別途必要です。
- sector-neutral rankは業種内の銘柄数が少ないと不安定です。
- スコアは相対順位であり、絶対的な本源価値推定ではありません。
- 過去のバックテスト成績は将来の成績を保証しません。
