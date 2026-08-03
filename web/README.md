# ValueScope Japan Web

J-Quantsのサニタイズ済みランキングを表示・操作するCloudflare Pages向け静的SPAです。APIキーはPython/GitHub Actionsなどのサーバー側実行環境だけで使用し、HTML、JavaScript、JSON、CSVには含めません。

## 画面機能

検索、市場・業種・適格判定のフィルタ、総合・割安・品質・データ充足率・Trap Riskのしきい値、表示件数、並べ替え、詳細パネル、表示結果CSV、総合スコア分布、上位銘柄比較を提供します。J-Quantsランキングがない場合は既存の参考データへ自動フォールバックします。

## ランキングJSON

優先して `jquants-ranking.json` を読み込みます。Pythonパイプラインの `ranking.json` をそのまま利用できます。`metadata`には`generated_at`、`as_of`、`effective_data_cutoff`、`plan`、`scored_count`、`eligible_count`、`warnings`を、`rows`には`rank`、`code`、`company_name`、`market`、`sector`、各スコア、データ日付、判定、理由を含めます。

## ローカル確認

```bash
cd web
npm ci
npm run lint
npm test
npm run build
python -m http.server 8000 -d dist
```

## Cloudflare Pages

- Root directory: `web`
- Build command: `npm ci && npm run build`
- Build output directory: `dist`
- Node.js: 22

J-QuantsのAPIキーをPagesのブラウザコードへ設定しないでください。データ更新はGitHub Actionsの `jquants-screen.yml` または安全なサーバー側バッチで行い、生成されたランキングだけを公開します。
