from __future__ import annotations

from datetime import date
from typing import Protocol

import pandas as pd


class MarketDataProvider(Protocol):
    """Internal interface used by screening and ingestion pipelines."""

    def get_master(self, code: str | None = None, as_of: date | str | None = None) -> pd.DataFrame:
        """Return listed-equity reference data in the internal schema."""

    def get_daily_bars(
        self,
        code: str | None = None,
        start: date | str | None = None,
        end: date | str | None = None,
        as_of: date | str | None = None,
    ) -> pd.DataFrame:
        """Return daily equity bars in the internal schema."""

    def get_financial_summary(
        self,
        code: str | None = None,
        start: date | str | None = None,
        end: date | str | None = None,
        as_of: date | str | None = None,
    ) -> pd.DataFrame:
        """Return disclosed financial summaries in the internal schema."""
