# ValueScope Japan Web

J-Quantsのサニタイズ済みランキングと、実注文を伴わないデモポートフォリオを表示するCloudflare Pages向けアプリです。APIキーはWeb成果物に含めません。

## 本番デモトレード

`demo-portfolio.json` に仮想約定を固定しています。2026年8月3日14:35～14:38（Asia/Tokyo）に適格10銘柄を各100株、Yahoo!ファイナンス日本版の「リアルタイム株価」表示で順次買ったシミュレーションです。総取得額は30,722,100円です。実際の証券口座、注文、資金移動とは接続していません。

Pages Function `/api/quotes` が60秒間隔の画面更新用価格を返します。

- 一次取得: Yahoo!ファイナンス日本版のリアルタイム表示
- 二次確認: Google Finance
- 内部確認とフォールバック: Yahoo Finance chart APIのmeta価格・最終分足
- 最大差が3%を超える場合は、その価格を損益計算に使用しません
- 公開データなので、配信元の都合による遅延・停止・訂正があります

損益推移はブラウザのlocalStorageへ最大240スナップショットだけ保存します。売買手数料、税金、配当は未反映です。

## ローカル確認

```bash
cd web
npm ci
npm run lint
npm test
npm run build
python -m http.server 8000 -d dist
```

ローカル静的サーバーではPages Functionがないため、デモ口座は取得価格表示へフォールバックします。

## Cloudflare Pages

- Root directory: `web`
- Build command: `npm ci && npm run build`
- Build output directory: `dist`
- Node.js: 22
