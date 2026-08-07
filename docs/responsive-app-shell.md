# Responsive application shell

ValueScope Japan uses one codebase and automatically switches among three purpose-built layouts.

## Modes

- iPhone: up to 767 CSS pixels. One primary view at a time, fixed bottom navigation, card-based securities, full-screen details, safe-area support and 44-pixel touch targets.
- iPad: 768–1180 pixels. Sticky segmented top navigation, two-column content/control layouts and two-column card grids. Both portrait and landscape are supported.
- PC: 1181 pixels and above. Persistent left navigation rail, central workspace and right contextual status rail. Wide tables keep important columns sticky where practical.

The visible mode label reads `iPhone表示`, `iPad表示`, or `PC表示` and updates on resize and orientation change.

## Primary views

1. Overview — current P/L, unrealized P/L, drawdown, risk status, data freshness and concise market summaries.
2. Investment decisions — paper BUY/HOLD/SELL decisions and separate fundamental/technical explanations.
3. Conditions screener — user filters, weights, advanced fundamental tuning, result cards and exclusion reasons.
4. P/L and risk — equity/daily P/L/drawdown/contribution charts, analytics, risk limits and cause diagnostics.
5. Data and plans — J-Quants capabilities, plan comparison, disclosure availability and methodology.

The application shell moves existing dynamically inserted modules into these view containers; it does not duplicate data logic or IDs. The decision report is shared between the decision and plan views and is moved deterministically when navigation changes.

## Navigation and deep links

The hash parameter `view` identifies the active primary view. Existing `screen` configuration hashes are preserved. Browser back/forward restores the active view. Direct section anchors are mapped to the appropriate primary view.

## Density and accessibility

PC and iPad offer Comfortable and Compact density, stored in localStorage. iPhone always uses Comfortable density. Keyboard focus is visible, navigation uses `aria-current`, Escape closes shell-managed overlays, and reduced-motion preferences are respected.

Without JavaScript the original document remains readable; the shell is a progressive enhancement applied after page load.
