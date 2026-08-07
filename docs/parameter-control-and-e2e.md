# Parameter control center and E2E coverage

## Central parameter screen

The `パラメータコントロール` screen is placed at the top of the existing Conditions view. It consolidates browser-only settings that were previously split across the screening lab, Fundamental tuning and risk diagnostics.

Groups:

- Overall screening thresholds and score weights
- Fundamental value, quality, growth, earnings yield, book-to-market, FCF yield, ROE, operating margin and disclosure age
- Technical RSI, moving averages, momentum, volatility and drawdown
- Portfolio and per-position drawdown/unrealized-loss warning limits
- Font size, display density and high contrast

Settings are stored in localStorage and synchronized to the existing controls. They do not alter server-side paper-trading rules and never submit a broker order.

## Font sizes

New users start at an 18px root font. Options are 16px, 18px and 20px. Important labels and secondary text are forced to at least 13px, while controls and data labels are at least 14px. Phone controls retain a 44px minimum touch target.

## Mandatory E2E

`web-ci.yml` installs Playwright 1.61.1 without modifying the lockfile and runs Chromium E2E at:

- 1440×900 desktop
- 1024×768 iPad
- 390×844 iPhone

The E2E suite checks parameter persistence, synchronization with existing controls, font-size persistence, minimum visible font size, automatic mode labels, 44px touch targets and page-level horizontal overflow. Failure traces, screenshots and videos are uploaded as GitHub Actions artifacts.

A separate workflow, `Production E2E`, runs the same device projects against the public Cloudflare Pages URL after deployment.
