# ValueScope Japan Web

Cloudflare Pages向けの静的SPAです。CSVはブラウザ内だけで解析し、外部サーバーへ送信しません。APIキーや認証情報を保存する機能はありません。

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

ファンダメンタルCSVには`symbol`、`code`、`Code`、`ticker`のいずれかが必要です。重み、閾値、テーマだけをlocalStorageへ保存します。CSV内容とAPIキーは保存しません。
