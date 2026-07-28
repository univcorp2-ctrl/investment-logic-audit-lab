# Web Architecture

ValueScope JapanはCloudflare Pagesで配信する静的SPAです。HTML、CSS、ES Modulesだけで構成し、実行時依存を持ちません。

```text
CSV file → browser File API → local CSV parser → metric derivation
→ winsorized percentile scoring → value / quality / growth / trap / technical / liquidity
→ filter and ranking table
```

## セキュリティとプライバシー

- CSVはネットワーク送信しない
- localStorageには非秘密の配点・閾値・テーマだけを保存
- APIキー入力欄を設けない
- J-Quants連携では将来、Cloudflare Worker等のbackend proxyでAPIキーを保持する
- DOMへ表示するCSV文字列はHTML escapeする
- 外部CDN scriptとanalyticsを使用しない

## Pythonとの整合

Web実装は、欠損を0埋めしないavailability-weighted scoring、5%/95% winsorize、percentile rank、業種内rank、quality floor、value-trap penalty、65/25/10の総合配点と適格条件を再現します。Pythonはpoint-in-time backtest、J-Quants ingest、詳細な因子診断を担当し、Webは候補確認と対話的分析を担当します。

## Deployment

```text
root_dir: web
build_command: npm ci && npm run build
build_output_dir: dist
production_branch: main
```
