# Web loading performance

ValueScope Japan uses a static-first, live-later loading model.

The ranking, latest daily report and performance metrics are Cloudflare Pages assets. Identical browser requests are deduplicated and timestamp cache-busting parameters are ignored for cache keys. Confirmed daily P/L and drawdown can therefore appear without waiting for public quote providers.

A single compact quote request is shared by page modules. The browser aborts it after four seconds and falls back to the last successful session payload or daily report. The Pages Function uses ten Yahoo query2 chart requests in parallel with 2.5-second per-source timeouts. Regular page loads are marked `internally-checked`; slower external comparison is optional and never blocks initial rendering.

Useful checks:

- `/jquants-ranking.json`
- `/data/paper-trading/latest-report.json`
- `/data/paper-trading/performance-metrics.json`
- `/api/quotes?compact=1`
