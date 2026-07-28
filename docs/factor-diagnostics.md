# Factor Diagnostics

`investment_audit.factor_diagnostics`は、割安スコアや品質スコアが将来リターンを横断面で順位付けできているかを検証します。

## 指標

- **Spearman IC:** 各評価日のfactor rankと将来リターンrankの相関
- **ICIR:** mean IC / IC standard deviation
- **Positive IC ratio:** ICが正だった評価日の割合
- **Quantile return:** factorを分位へ分けた将来平均リターン
- **Top-bottom spread:** 最上位分位−最下位分位
- **Monotonicity:** 分位番号と平均リターンの順位相関を0–100へ変換
- **Turnover:** 前回分位にいなかった新規銘柄の割合
- **Rank autocorrelation:** 前回評価日とのfactor順位相関

## 使用例

```python
from investment_audit.factor_diagnostics import analyze_factor

result = analyze_factor(
    scores=point_in_time_scores,
    prices=adjusted_close,
    horizons=(1, 5, 21, 63),
    quantiles=5,
    groups=sector_by_symbol,
    group_neutral=True,
)
print(result.summary)
```

factor scoreはその日時点までに利用可能なデータだけで作成してください。forward returnは評価専用であり、売買シグナル生成には使用しません。財務factorは決算期末日ではなく公表日以降に配置してください。
