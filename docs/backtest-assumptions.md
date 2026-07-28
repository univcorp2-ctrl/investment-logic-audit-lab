# Backtest Assumptions

## 目的

バックテストはスコアの将来収益との関係、コスト耐性、パラメータ近傍での頑健性を調べるための検証器です。実運用の約定を完全再現するものではありません。

## 入力

### Prices

- 行: 営業日
- 列: 銘柄コード
- 値: 原則として調整済み終値
- 日付indexはUTCとして解釈した後、timezoneなしの日時へ正規化
- 重複日は末尾を採用
- 列順と銘柄コードを固定

### Scores

- pricesと同じwide形式
- 各日付時点で利用可能だったスコアだけを入れる
- future revisionを過去へ遡及させない
- 欠損期間は前方補完されるため、スコアの有効期限をデータ作成側で管理する

## Point-in-timeと公表ラグ

`run_ranked_portfolio`はスコアを`fundamental_lag_days`だけ遅らせます。

```text
lagged_scores = scores.shift(fundamental_lag_days)
```

ただし、これは元データのpoint-in-time化を代替しません。財務データは次の順で作成してください。

1. 決算期末日ではなく公表日を記録する。
2. 公表日より前の日付へ数値を配置しない。
3. 訂正開示は訂正後にだけ反映する。
4. 必要に応じて公表後の安全ラグを追加する。

## リバランス

- `monthly`: 各月の最終観測日
- `weekly`: 金曜締め週の最終観測日
- ranking上位`top_n`を選択
- `equal`: 等ウェイト
- `score`: 選択銘柄内でスコア差を正規化
- `max_position`で1銘柄上限を設定

目標ウェイトはさらに1期間shiftされ、次の価格変化から適用されます。

```text
execution_weights = target_weights.shift(1)
```

したがって、リバランス日の終値で計算したスコアを同日のリターンへ適用しません。

## リターン

```text
asset_return[t] = price[t] / price[t-1] - 1
portfolio_gross[t] = sum(weight[t] × asset_return[t])
```

現金リターンは0、借入金利は0として扱います。配当は調整済み価格へ含まれている前提です。

## Turnoverとコスト

```text
turnover[t] = sum(abs(weight[t] - weight[t-1]))
cost[t] = turnover[t] × (cost_bps + slippage_bps) / 10,000
net_return[t] = gross_return[t] - cost[t]
```

このモデルは線形コストです。次は含みません。

- bid-ask spreadの日中変動
- 板の厚さ
- 注文サイズ依存の市場インパクト
- ストップ高・ストップ安
- 売買停止
- 借株料と空売り規制
- 税

小型株の検証では、最低平均売買代金、参加率上限、非線形インパクトを追加してください。

## Benchmark

デフォルトbenchmarkは、各日の利用可能銘柄を等ウェイトしたリターンです。TOPIX等を使う場合は、同じ期間・通貨・配当込み条件のbenchmark seriesを別途用意してください。

## 指標

- CAGR
- annualized volatility
- Sharpe ratio
- Sortino ratio
- Calmar ratio
- maximum drawdown
- average turnover
- daily hit rate
- average gross exposure
- benchmark excess CAGR

リスクフリーレートは0です。短期間、定数リターン、下方偏差0では比率が`NaN`になることがあります。

## Robustness summary

`robustness_summary`は次の近傍を総当たりします。

- `top_n`
- `cost_bps`
- `fundamental_lag_days`

出力DataFrameのattrs:

- `positive_sharpe_ratio`
- `median_sharpe`
- `worst_max_drawdown`

単一の最適パラメータではなく、近傍の多くで結果が維持されるかを確認してください。

## Walk-forward

既存walk-forwardでは学習期間、purge期間、テスト期間を時系列順に分けます。パラメータ選択は学習期間だけで行い、テスト期間の成績を次の窓の選択へ直接使いません。

最低限、次を確認してください。

- 複数の市場局面を含むか
- purgeが特徴量lookbackより十分か
- OOS窓ごとの成績が一部期間だけに依存していないか
- コストを上げても優位性が残るか
- top-Nやlagを少し変えても崩壊しないか

## バイアスと残課題

### Survivorship bias

現在上場中の銘柄だけで過去を検証すると、倒産・上場廃止銘柄が消えます。過去時点の銘柄マスタを使ってください。

### Look-ahead bias

- 当日終値由来のtechnical signalは1期間遅延
- 財務値は公表日以降
- benchmark構成も過去時点の構成を使う

### Selection bias

多数の指標・重み・閾値を試すほど、見かけの優位性が生じます。最終仕様を固定した後に未使用期間で検証してください。

### Corporate actions

株式分割、併合、配当、権利落ち、銘柄コード変更は入力価格・銘柄マスタの品質に依存します。

### Capacity

流動性スコアは粗いフィルターです。運用資産額に応じた参加率と市場インパクトを別途評価してください。
