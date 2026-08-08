# Security detail data sources

The stock research sheet opens only after a row double-click, Enter key, or an explicit detail button. The dashboard does not request chart or news data during initial page load.

## Recommendation reasons

Fundamental and Technical evidence are displayed separately. Fundamental reasons cover valuation, quality, growth/stability, FCF, ROE, margins, value-trap risk, completeness and disclosure freshness. Technical reasons cover price versus SMA20/SMA60, RSI, momentum, volatility and drawdown. The UI accepts both the current flat API fields and the legacy nested structure.

## Financials

The API first checks J-Quants Financial Summary and Earnings Date data. If the Pages runtime does not have entitlement or the source times out, it uses only the repository's sanitized per-code stock-detail files. Missing values remain missing. Full BS/PL/CF is shown only when detailed output is actually available; Premium entitlement alone is not described as available output.

## Official disclosures versus general news

Official items come only from sanitized TDnet/Company Disclosure data. If the add-on is not connected, the UI says so and does not invent a headline.

General news is labelled `一般ニュース（公式開示ではありません）`. Google News RSS is used only for title, publisher, publication date and link, with a maximum of eight items. Article text is not copied and sentiment is not generated.

## Chart

The chart uses Yahoo Finance daily OHLC data and renders accessible SVG candlesticks. Available periods are 1M, 3M, 6M and 1Y. SMA20 and SMA60 can be toggled, and every candle can receive keyboard focus to reveal OHLC and moving-average values.

All features are for paper analysis. No broker order is sent.
