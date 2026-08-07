# Parameter control and mandatory browser E2E

ValueScope Japan exposes one browser-side `パラメータコントロール` above the detailed screening controls. It does not connect to a brokerage account and never sends a real order.

## Parameter groups

- Screening: overall, Fundamental, value, quality, growth, completeness, Technical, Value Trap, trading value, market, sector, holding state, decision state, missing-data policy and top N.
- Fundamental: value, quality, growth, Value Trap, completeness, earnings yield, book-to-market, FCF yield, ROE, operating margin, disclosure age and five Fundamental weights.
- Technical: RSI range, 20/60-day momentum, volatility, drawdown, moving-average confirmations and Technical weight.
- Risk: portfolio drawdown, total unrealized loss percent/yen, per-position loss percent/yen, position concentration and sector concentration.
- Display: Standard, Large and Extra Large fonts; comfortable/compact density; contrast and reduced motion.

Settings are stored only in browser localStorage and synchronized to the existing detailed screens. They are analysis and warning parameters. The scheduled paper strategy is not silently changed.

## Readability

The final `readability.css` layer is loaded after all feature CSS. Root sizes are 16px, 18px and 20px on PC, iPad and iPhone. Phone inputs stay at 16px to prevent Safari zoom. Body content is at least 14px, supporting labels at least 13px and touch targets at least 44px.

## E2E

GitHub Actions runs Chromium Playwright E2E on every relevant push and pull request after lint, unit tests and production build.

Covered viewports:

- PC 1440×900
- iPad landscape 1024×768
- iPad portrait 768×1024
- iPhone 390×844
- iPhone 375×812

Scenarios verify preset application, font-size persistence, save/reset, no horizontal overflow, iPhone touch/input sizes, slow live-quote fallback and keyboard/accessibility smoke checks. Market API routes are deterministic fixtures; E2E never calls live external quote providers.

Run locally after installing Playwright:

```bash
cd web
npm ci
npm install --no-save --package-lock=false @playwright/test
npx playwright install chromium
npm run e2e
```

Failure screenshots, traces, videos and the HTML report are retained as GitHub Actions artifacts for 14 days.
