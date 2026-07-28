# OSS Inspirations and License Notes

本リポジトリの追加ロジックは、次のOSSが公開している分析概念を調査し、数式・API・例外処理を本リポジトリ向けに独自実装したものです。第三者ソースコードをコピーしていません。

| Project | License | 参考にした概念 | 独自実装 |
|---|---|---|---|
| quantopian/alphalens | Apache-2.0 | Information Coefficient、分位別forward return、turnover、factor rank autocorrelation、group-neutral factor analysis | `factor_diagnostics.py` |
| microsoft/qlib | MIT | Alpha158に見られる複数時間軸の価格・出来高正規化特徴量 | `feature_library.py` |
| ranaroussi/quantstats | Apache-2.0 | Ulcer Index、Gain-to-Pain、Recovery、Tail、Omegaなどのリスク評価 | `risk_metrics.py` |
| PyPortfolio/PyPortfolioOpt | MIT | 相関クラスタとrecursive bisectionを使うHierarchical Risk Parity | `allocation.py` |

各プロジェクトの名称は出典説明のために使用しています。本リポジトリは各プロジェクトの公式派生物や認定製品ではありません。再配布物へ第三者コードを直接取り込む場合は、対象バージョンのLICENSEとNOTICEを別途確認してください。
