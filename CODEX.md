# CODEX.md

## Project intent

Build and maintain a reproducible investment logic audit lab for stocks and crypto assets.

## Guardrails

- Do not present sample output as real investment performance.
- Avoid adding network-dependent tests.
- Always shift signals before applying returns.
- Always include transaction costs and slippage in strategy examples.
- Prefer simple, interpretable strategy hypotheses over black-box curve fitting.
- Treat fundamentals as point-in-time data in production.

## Common commands

```bash
pip install -e .[dev]
ruff check .
pytest
investment-audit sample --out outputs
```
