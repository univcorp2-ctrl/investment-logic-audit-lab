# J-Quants plan guide

Status checked 2026-08-03. Plan details and endpoint availability can change; verify the official J-Quants pricing and API-reference pages before upgrading.

| Plan | Monthly price, tax included | Typical history | API rate limit | Practical use in this repository |
|---|---:|---:|---:|---|
| Free | ¥0 | 2 years, generally delayed 12 weeks | 5 requests/min | Integration tests, delayed factor research, reproducible prototypes |
| Light | ¥1,650 | 5 years, current data | 60 requests/min | Current daily/weekly screening and small-universe automation |
| Standard | ¥3,300 | 10 years, current data | 120 requests/min | More robust regime tests plus datasets such as margin/short and selected EDINET ownership data |
| Premium | ¥16,500 | All offered history; some datasets up to 20 years | 500 requests/min | Large-scale research, broad automation, premium datasets, and faster financial-data availability where offered |

Dataset coverage differs by endpoint. Free is primarily API access and has strong delay/history restrictions; paid plans also offer CSV access for many datasets. Standard and Premium unlock some ownership, margin, and additional datasets. Premium is required for selected premium-only indices and near-real-time financial-data improvements announced by J-Quants.

Official references:

- Pricing: https://jpx-jquants.com/en/pricing
- Plan/API limits: https://jpx-jquants.com/en/plan
- API V2 authentication/migration: https://jpx-jquants.com/en/spec/migration-v1-v2
- API reference: https://jpx-jquants.com/en/spec

## Which plan fits this strategy?

For a daily or weekly value/quality screen, Light is the least expensive plan that removes the 12-week delay and normally provides enough request capacity. Standard is the stronger research choice because ten years is more useful for out-of-sample and multi-regime validation, while the monthly price remains modest. Premium is difficult to justify before the strategy, workflow, and portfolio size have already demonstrated a need for its data breadth and throughput.

## Subscription break-even hurdle

Annual subscription cost is approximately ¥19,800 for Light, ¥39,600 for Standard, and ¥198,000 for Premium. The data must improve net annual results by at least the following amount merely to cover the subscription, before taxes and trading costs:

| Capital | Light | Standard | Premium |
|---:|---:|---:|---:|
| ¥1,000,000 | 1.98% | 3.96% | 19.80% |
| ¥3,000,000 | 0.66% | 1.32% | 6.60% |
| ¥5,000,000 | 0.40% | 0.79% | 3.96% |
| ¥10,000,000 | 0.20% | 0.40% | 1.98% |

This is a cost hurdle, not an expected-return forecast. A paid plan does not create alpha; it can reduce staleness, improve sample length, and enable cleaner validation. Upgrade only after the delayed Free pipeline works end to end, then compare an out-of-sample Standard-data strategy against the same rules on Free-compatible cutoffs.
