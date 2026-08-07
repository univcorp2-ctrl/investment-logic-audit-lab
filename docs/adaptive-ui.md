# Adaptive PC/iPad and iPhone UI

ValueScope Japan uses two explicit presentation modes. Widths of 768 CSS pixels and above use the PC/iPad information architecture. Widths of 767 pixels and below use a dedicated iPhone reading order.

The PC/iPad mode prioritizes comparison: a compact Today dashboard, horizontal section navigation, two-column density on iPad and three-to-four-column density on desktop. The iPhone mode prioritizes sequence: critical KPIs, current risk, decisions, conditions, P/L, and additional data, with a five-item safe-area-aware bottom navigation.

The 767/768 boundary is the single source of truth. All existing J-Quants data, paper portfolio logic, browser-local screening settings, risk limits, and analytics remain unchanged. No real broker order is sent.
