# Parameter control and readability

## Purpose

`#parameterControl` centralizes browser-side research settings that were previously spread across the screening, fundamental and risk panels. It does not send broker orders and does not silently change the scheduled server-side paper strategy.

## Storage compatibility

The control center writes the same localStorage structures used by existing modules:

- `valuescope-screening-lab-v1`
- `valuescope-fundamental-tuning-v1`
- `valuescope-risk-policy-v1`
- `valuescope-display-preferences-v1`

It also writes `valuescope-parameter-bundle-v1` with `schemaVersion: 1` for JSON export/import. Saving dispatches `valuescope:parameters-changed` and mirrors values into already-mounted legacy controls.

## Parameters

Tabs cover screening thresholds, detailed fundamentals, technical confirmation, browser-side risk limits, display preferences and settings management. Presets are Balanced, Value, Quality, Trend, Low Volatility, Free Safe and Loss Control.

Risk limits are alerts and research constraints only. They do not execute a trade or edit the GitHub Actions paper strategy.

## Readability

The final CSS layer is `readability.css`. It is loaded last and supports:

- `normal`: 100%
- `large`: approximately 112.5%
- `xlarge`: approximately 125%

Normal PC/iPad body text starts at 16px. Normal iPhone body text starts at 15px. Operational labels are at least 12px, standard card/table text is at least 14px, and phone controls remain at least 44px high. Preferences are applied by `font-preferences-boot.js` before the feature modules initialize.

## JSON management

Exports contain only parameter values and the schema version. They contain no API key, authentication data, market-data payload or broker credential. Invalid schema versions and out-of-range values are rejected with an accessible error message.

## Playwright E2E matrix

The mandatory Chromium workflow checks:

- PC: 1440×900
- iPad landscape: 1024×768
- iPad portrait: 768×1024
- iPhone: 390×844
- compact iPhone: 375×812

Tests cover parameter persistence, synchronization with existing controls, font scaling, import/export/reset, minimum font and touch sizes, horizontal overflow and static daily KPI rendering while live quotes are delayed.

Run locally after installing Playwright:

```bash
cd web
npm ci
npm run e2e:install
npm run e2e
```
