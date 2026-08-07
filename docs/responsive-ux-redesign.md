# Responsive UX redesign

ValueScope Japan uses one authoritative application shell. Existing analysis modules remain unchanged and are moved into five task-oriented destinations after their asynchronous initialization.

## Breakpoints

- iPhone: 0–767 CSS px
- iPad: 768–1180 CSS px
- PC: 1181 CSS px and wider

The mode is recalculated on resize and orientation change. The visible indicator reads `iPhone表示`, `iPad表示`, or `PC表示`.

## Information architecture

1. Overview: confirmed daily total P/L, live unrealized P/L, current drawdown, fundamental cutoff, hero and essential status.
2. Investment decision: BUY/HOLD/SELL reasons separated into Fundamental and Technical views.
3. Conditions: browser-only screening, advanced fundamental tuning, exclusions and the full ranking table inside progressive disclosure.
4. P/L and risk: live demo positions, performance charts, analytics ratios, drawdown diagnosis and local risk limits.
5. Data and plans: J-Quants plan comparison, disclosure capability, methodology and strategy-lab research.

## PC

PC uses a sticky left rail. At 1440px and wider a compact context rail is also shown. Between 1181 and 1439 the context rail is hidden so the main analysis stays wide. A Standard/Compact density switch is stored in localStorage.

## iPad

iPad uses a sticky horizontal workspace navigation instead of a cramped side rail. Cards use two columns where possible. Complex charts remain one column and tables scroll inside labelled containers.

## iPhone

The primary navigation becomes a five-item safe-area-aware bottom bar. Only one destination is rendered at a time, eliminating the previous endless page. Overview charts, full ranking, advanced conditions and position details use progressive disclosure. Ranking and portfolio tables become labelled cards, and the security detail drawer becomes a full-screen sheet.

## Accessibility

- Minimum phone touch target: 44px
- Visible keyboard focus ring
- Safe-area insets for notched devices
- Reduced-motion support
- No nested `<main>` landmark
- Existing IDs, filters, report tabs and download controls are preserved

## Manual verification sizes

- 390×844: iPhone portrait
- 430×932: large iPhone
- 768×1024: iPad portrait
- 1024×768: iPad landscape
- 1440×900: desktop

For each size, verify the visible mode badge, navigation placement, no page-level horizontal overflow, readable cards, table behavior and full-screen detail sheet on iPhone.
