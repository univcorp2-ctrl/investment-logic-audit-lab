# J-Quants API V2 Integration

## 方針

本リポジトリはJ-Quants API **V2**だけを新規連携対象とします。V1は2026年6月1日にサービス終了済みのため、新規コードからは利用しません。

公式Python clientの`jquantsapi.ClientV2`を任意依存として使用し、公式clientが返すDataFrameを分析用の内部標準スキーマへ正規化します。

公式情報:

- J-Quants API client: <https://github.com/J-Quants/jquants-api-client-python>
- J-Quants APIドキュメント: <https://jpx.gitbook.io/j-quants-ja>

## 対応データ

| 用途 | V2 API | ClientV2 method | 内部メソッド |
|---|---|---|---|
| 上場銘柄マスタ | `/v2/equities/master` | `get_eq_master` | `get_master` |
| 日次株価 | `/v2/equities/bars/daily` | `get_eq_bars_daily` / range | `get_daily_bars` |
| 財務サマリー | `/v2/fins/summary` | `get_fin_summary` / range | `get_financial_summary` |

公式clientのメソッド名や返却列の変更はadapter内へ閉じ込め、スクリーナー側へ直接伝播させません。

## インストール

```bash
pip install -e ".[jquants]"
```

本体だけを使う場合、J-Quants clientのインストールは不要です。

## 認証

APIキーは環境変数`JQUANTS_API_KEY`から読みます。

```bash
export JQUANTS_API_KEY="..."
```

`.env.example`は変数名だけを示します。実値を`.env`、ソースコード、ログ、テストfixture、キャッシュファイル名へ書かないでください。

### GitHub Actions Secret

1. GitHubリポジトリの **Settings** を開く。
2. **Secrets and variables** → **Actions** を開く。
3. **New repository secret**を選ぶ。
4. 名前を`JQUANTS_API_KEY`にする。
5. APIキーを登録する。

実APIを使うworkflowを将来追加する場合だけ、jobの`env`へ次を設定します。

```yaml
env:
  JQUANTS_API_KEY: ${{ secrets.JQUANTS_API_KEY }}
```

現在のCIは実APIを呼ばないため、このSecretは不要です。

## 使用例

```python
from investment_audit.providers import JQuantsConfig, JQuantsProvider

provider = JQuantsProvider(
    JQuantsConfig(
        max_retries=3,
        backoff_seconds=0.5,
        cache_dir=None,
    )
)

master = provider.get_master(as_of="2026-07-01")
bars = provider.get_daily_bars(
    code="13010",
    start="2025-01-01",
    end="2026-07-01",
)
financials = provider.get_financial_summary(
    code="13010",
    start="2024-01-01",
    end="2026-07-01",
)
```

期間一括メソッドにはAsia/Tokyoのtimezone-aware datetimeを渡します。開始日が終了日より後の場合はAPIを呼ぶ前に`ValueError`とします。

## 正規化

### 共通

- 銘柄コードをstring dtypeで保持
- 数値として返ったコードの末尾`.0`を除去
- 5桁未満の数値コードは先頭ゼロを保持
- 日付列をdatetimeへ変換
- code/dateの重複を末尾優先で除去
- `inf`と`-inf`を欠損へ変換

### 日次株価

代表的な内部列:

```text
code, date, open, high, low, close, volume,
adjusted_open, adjusted_high, adjusted_low,
adjusted_close, adjusted_volume
```

テクニカル分析には原則として調整済み価格を利用してください。

### 財務サマリー

代表的な内部列:

```text
code, disclosed_date, fiscal_year_end, period_end,
net_sales, operating_profit, ordinary_profit, profit, eps,
total_assets, equity,
operating_cash_flow, investing_cash_flow, financing_cash_flow
```

分析への投入日は`fiscal_year_end`ではなく、原則`disclosed_date`以降です。

## Retry、rate limit、cache

- 401/403: `JQuantsAuthError`
- 429: 指数backoff後も失敗すれば`JQuantsRateLimitError`
- 5xx: 指数backoff後も失敗すれば`JQuantsUnavailableError`
- 空応答: デフォルトで`JQuantsEmptyResponseError`
- 任意依存未導入: `JQuantsDependencyError`

`max_retries`は追加試行回数です。待機時間は`backoff_seconds × 2^attempt`です。

`cache_dir`を指定すると、operationと公開パラメータから作ったhash名でDataFrameを保存します。APIキーはcache keyに含めません。TTLを超えたcacheは読みません。

公式clientのrange helperは大量リクエストになり得ます。長期間・全銘柄を取得する際は、契約プランの制限を確認し、日付範囲を小さく分割して永続cacheへ保存してください。

## CI契約テスト

`tests/test_jquants_provider.py`はFake Clientだけを使い、次を検証します。

- APIキー未設定
- optional dependency未導入
- master / daily bars / financial summaryのschema変換
- 銘柄コードの文字列保持
- date rangeとJST datetime
- DataFrameページの結合
- 429 retryと指数backoff
- 429 / 5xxのtyped exception
- 空response
- 不正な日付範囲
- cache hit

ネットワーク、APIキー、J-Quantsの稼働状況には依存しません。

## 将来の本番データパイプライン

1. `get_master`でcode、上場区分、業種を取得する。
2. `get_financial_summary`を取得し、`disclosed_date`基準のpoint-in-time snapshotを作る。
3. 必要な前年差・複数年安定性・希薄化・ネットキャッシュ等を導出する。
4. `get_daily_bars`の調整済みOHLCVからテクニカル指標を計算する。
5. 同一の評価日時でfundamental、technical、liquidityを結合する。
6. `screen_value_stocks`へ渡す。
7. snapshotを日付付きParquetへ保存し、再現可能なバックテストへ使う。

本番化時は、銘柄マスタの過去時点復元、上場廃止銘柄、訂正開示、株式分割・併合、会計基準差、銀行・保険の財務指標差を別途扱ってください。
