# iPhone paged navigation

At widths up to 767 CSS pixels, ValueScope uses one destination and one subpage at a time. Existing data modules are not duplicated; their DOM sections are temporarily shown or hidden with `hidden`, `inert`, and `aria-hidden`.

## Destinations and subpages

- Overview: Today, demo status, data freshness
- Decision: judgement, Fundamental, Technical, ranking
- Conditions: simple, Fundamental, Technical, risk, display
- P/L: summary, equity, drawdown, metrics, cause analysis
- Other: J-Quants, disclosures/news, strategy lab, export

The segmented pager is fixed below the compact iPhone header. Previous/Next buttons and the page counter reduce long scrolling. The selected destination and subpage are stored in the URL hash and restored by browser Back/Forward and reload.

Parameter labels use explicit badges: F for Fundamental (what to own), T for Technical (when to enter/exit), R for risk, S for screening/universe, and UI for display preferences.
