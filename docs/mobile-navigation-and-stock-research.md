# iPhone screen navigation and stock research

## iPhone navigation

At 767 CSS pixels and below, the five bottom buttons are route-like screens rather than scroll shortcuts. The hash stores `screen` and the P/L screen stores its subpanel in `panel`. Browser back, forward and reload restore the selected screen.

Screens are Overview, Investment Decision, Conditions, P/L and Risk, and More. P/L and Risk has Current, Holdings, Chart, Risk and Metrics subpanels. Only the selected phone screen and selected performance subpanel are shown. PC and iPad keep the wide dashboard layout.

## Opening a security

Desktop and iPad users can double-click a ranking row, press Enter, or use the explicit Detail button. iPhone users use the Security Detail button. The detail view is a side sheet on wide screens and a full-screen sheet on iPhone.

Tabs are Overview, Recommendation Reasons, Financials, Disclosures and News, and Chart. Recommendation reasons always separate Fundamental from Technical evidence. The explanation is generated only from stored numeric metrics and rule results.

## Data sources

- Recommendation and metrics: sanitized ranking and daily paper report.
- Financial summary: sanitized J-Quants Financial Summary output after the scheduled refresh. Until then the UI shows an explicit unavailable state.
- Full BS/PL/CF: shown only when the current entitlement and generated output provide it.
- Official disclosures: sanitized TDnet add-on output only. No item is fabricated when the add-on is not configured.
- General news: Google News RSS titles, publisher, date and link only. It is labelled as non-official news and no article body or sentiment is generated.
- Chart: Yahoo Finance daily OHLCV fetched lazily by the Pages Function. The chart is not requested on initial page load.

## Chart

The accessible SVG chart shows daily candlesticks, volume, SMA20 and SMA60. Periods are 1M, 3M, 6M and 1Y. Indicator toggles currently cover SMA20, SMA60 and volume. Each candle is keyboard focusable and exposes its OHLC values.

## Safety

The detail screen is research and paper-analysis only. It does not send a real order. The API key is never delivered to the browser.
