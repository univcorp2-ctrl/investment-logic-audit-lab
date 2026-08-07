# Dashboard loading architecture

The dashboard previously started four independent live-price paths: the demo portfolio, performance analytics, risk diagnostics, and the app-shell portfolio summary. On a cold edge cache, those requests could trigger the same ten-security external validation work in parallel.

## Shared request coordinator

`web/fetch-coordinator.js` is loaded before quote-consuming modules and replaces only same-origin GET handling. It deduplicates in-flight static JSON and quote requests. `/api/quotes`, `/api/quotes?compact=1`, and `/api/portfolio-status` share one compact quote payload. The portfolio-status text response is generated in the browser from that shared payload.

Static JSON uses a five-minute in-memory TTL and a sessionStorage last-known-good fallback. Live quotes use a 55-second browser TTL and a 12-second timeout. A timed-out live request does not prevent the daily report from rendering.

## Fast visible fallback

`web/fast-data-bootstrap.js` loads the latest daily report and performance metrics first. The overview labels these values as daily confirmed data, then replaces only live unrealized fields after the shared quote event arrives. Load status is shown as:

- 日次データ表示済み・現在値を更新中
- 現在値更新済み
- 現在値取得失敗（前回値を表示）

## Inspecting requests

In browser developer tools, a normal initial load should show one network request to `/api/quotes?compact=1`, not one per feature module. Static JSON may be served from memory, browser cache, or the Cloudflare edge. The quote response exposes `X-Valuescope-Cache` and the server response exposes `Server-Timing` after the optimized Function is deployed.
