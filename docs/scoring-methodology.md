# Scoring Methodology

## 目的

このスコアは「安いものを無条件に買う」のではなく、**割安性を主軸にしながら、企業品質・成長安定性・バリュートラップ・買い時・流動性を同時に確認する**ための横断面ランキングです。

すべての主要サブスコアは0–100で、100ほど望ましい評価です。`value_trap_risk`だけは100ほど危険です。指標別`*_contribution`は50を中立点とした寄与値なので、0–100には制限されません。

## 1. 入力の安全処理

1. 数値へ変換できない値、`inf`、`-inf`は欠損にする。
2. 分母が0または極小の比率は欠損にする。
3. 欠損を0で埋めない。
4. 各指標をデフォルト5%/95%分位でwinsorizeする。
5. percentile rankへ変換する。
6. 「低いほど良い」指標は順位を反転する。
7. 業種中立化が有効で、同一業種に有効値が3銘柄以上あれば業種内順位を使う。それ未満は全体順位を使う。

各複合スコアでは、利用可能な指標の重みだけを再正規化します。したがって欠損が直接0点になることはありません。ただし、欠損の多さは`data_completeness`と`confidence`を下げ、バリュートラップの不足データ罰点にも反映されます。

## 2. Value score

デフォルト重み:

| 指標 | 重み | 良い方向 |
|---|---:|---|
| earnings yield | 19% | 高い |
| book-to-market | 13% | 高い |
| FCF yield | 20% | 高い |
| EV/EBITDA | 14% | 低い |
| dividend yield | 9% | 高い |
| shareholder yield | 10% | 高い |
| net cash / market cap | 15% | 高い |

`book_to_market`がなければ`book_value / market_cap`、さらにPBRがあれば`1 / PBR`を利用できます。

## 3. Quality score

| 指標 | 重み | 良い方向 |
|---|---:|---|
| ROE | 13% | 高い |
| ROIC | 17% | 高い |
| gross profitability | 13% | 高い |
| operating margin | 12% | 高い |
| FCF conversion | 13% | 高い |
| debt / EBITDA | 12% | 低い |
| accrual quality | 10% | 高い |
| earnings stability | 5% | 高い |
| FCF stability | 5% | 高い |

ROICは投入資本があり、NOPATがない場合に営業利益×70%を簡易NOPATとして利用します。これは税率の精緻な推定ではなく、比較用のフォールバックです。

## 4. Growth / Stability score

| 指標 | 重み | 良い方向 |
|---|---:|---|
| revenue growth | 25% | 高い |
| EPS growth | 25% | 高い |
| FCF growth | 20% | 高い |
| margin stability | 15% | 高い |
| earnings volatility | 15% | 低い |

成長率は公表済み財務値だけから計算し、将来予想値を混ぜる場合は予想値であることを別列・別モデルとして管理してください。

## 5. Value trap risk

利用可能な情報から次を判定します。

- 当期赤字
- 2期以上の継続赤字
- 負のFCF
- 2期以上の継続的な負のFCF
- debt/EBITDAの悪化
- debt/EBITDA > 4
- 3%超の株式希薄化
- 売上成長率 < -10%
- 営業利益率変化 < -3ポイント
- データ不足

観測された危険度70%と不足データ罰点30%を組み合わせ、0–100へ制限します。

## 6. Undervaluation score

デフォルト:

```text
base_score
  = 60% × value_score
  + 25% × quality_score
  + 15% × growth_stability_score

quality_penalty
  = max(45 - quality_score, 0) × 0.8

undervaluation_score
  = clip(base_score
         - quality_penalty
         - 35% × value_trap_risk,
         0, 100)
```

このため、単純な低PER・低PBR銘柄でも、赤字・負のFCF・高レバレッジ・希薄化が強ければ上位に残りにくくなります。

## 7. Piotroski-like score

利用可能な範囲で次の9条件を評価します。

- ROAが正
- 営業CFが正
- ROA改善
- 営業CFが利益を上回る
- レバレッジ低下
- 流動性改善
- 希薄化なし
- 粗利益率改善
- 総資産回転率改善

不足項目は0点にせず未評価とし、`piotroski_completeness`を併記します。

## 8. Technical score

```text
technical_score
  = 40% × trend_score
  + 30% × momentum_score
  + 15% × mean_reversion_score
  + 15% × risk_score
```

### Trend

- 終値 > SMA50
- 終値 > SMA200
- SMA50 > SMA200
- SMA20 > SMA50
- ADX >= 20

長期下降トレンドは明示的に減点します。

### Momentum

- MACD histogram
- 63/126/252日relative strength
- RSIの健全な上昇帯
- 過熱RSIの減点
- 価格・出来高ブレイクアウト

### Mean reversion

- RSI < 35
- Bollinger下限割れ
- 52週レンジ下位
- MACD histogram改善

ただし、SMA200を下回る場合は「安いだけの下降継続」を避けるため減点します。

### Risk

- 年率ボラティリティ
- SMA200下
- 52週安値圏
- ATR/価格
- 最低平均売買代金

売買判断に使う`decision_score`は`technical_score.shift(1)`です。当日終値から計算したシグナルを同日リターンへ適用しません。

## 9. Liquidity / risk score

平均売買代金またはmarket capの横断面percentileを70%、テクニカル`risk_score`を30%として組み合わせます。どちらもない場合は中立50を使います。

## 10. Overall scoreと適格条件

```text
overall_score
  = 65% × undervaluation_score
  + 25% × technical_score
  + 10% × liquidity_risk_score
```

デフォルト適格条件:

```text
quality_score >= 40
value_trap_risk <= 60
data_completeness >= 45
liquidity_score >= 20
```

`overall_score`が高くても適格条件を満たさない銘柄は`eligible=False`となり、`filter_reasons`へ理由を出します。

## 解釈上の注意

- 横断面順位はユニバース依存です。大型株だけの順位と全市場順位は比較できません。
- 業種中立評価は業種内の相対評価であり、業種全体の割高・割安を消します。
- 低い`data_completeness`で上位になった銘柄は、必ず原データを確認してください。
- `confidence`は予測確率ではなく、データ充足率とtrap riskを基にした運用上の信頼度です。
- 本源価値のDCF推定ではありません。
