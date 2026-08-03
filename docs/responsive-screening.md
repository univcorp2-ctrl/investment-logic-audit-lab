# Responsive desktop and iPhone experience

ValueScope Japan switches automatically at 768 CSS pixels. No user setting is required.

## Desktop

Desktop keeps wide ranking tables, multi-column score cards, sticky navigation and side-panel detail views. It is intended for comparing many fields at once.

## iPhone and compact mobile

The mobile layout uses safe-area insets, 44-pixel tap targets, a fixed five-item bottom navigation, card-based ranking rows, compact headers and a nearly full-screen detail drawer. The five destinations are Overview, Decisions, Screening, P/L and Plans. Rotation is detected with `matchMedia` and `orientationchange`.

The page displays a small `PC表示` or `iPhone表示` indicator so screenshots and support requests identify the active layout.

## Accessibility

Keyboard focus is visible, reduced-motion preferences are honored, navigation has an ARIA label and mobile tables preserve field labels on each card.
