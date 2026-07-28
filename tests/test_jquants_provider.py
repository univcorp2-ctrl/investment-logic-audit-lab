from __future__ import annotations

from datetime import datetime
from pathlib import Path
from typing import Any

import pandas as pd
import pytest

from investment_audit.providers.jquants import (
    JQuantsAuthError,
    JQuantsConfig,
    JQuantsDependencyError,
    JQuantsEmptyResponseError,
    JQuantsProvider,
    JQuantsRateLimitError,
    JQuantsUnavailableError,
)


class HttpError(RuntimeError):
    def __init__(self, status_code: int) -> None:
        super().__init__(f"HTTP {status_code}")
        self.status_code = status_code


class FakeClient:
    def __init__(self) -> None:
        self.calls: list[tuple[str, dict[str, Any]]] = []
        self.failures: list[int] = []
        self.empty = False
        self.pages = False

    def _respond(self, name: str, kwargs: dict[str, Any], frame: pd.DataFrame) -> Any:
        self.calls.append((name, kwargs))
        if self.failures:
            raise HttpError(self.failures.pop(0))
        if self.empty:
            return pd.DataFrame()
        if self.pages:
            return [frame.iloc[:1], frame.iloc[1:]]
        return frame

    def get_eq_master(self, code: str | None = None, date_yyyymmdd: str | None = None) -> Any:
        frame = pd.DataFrame(
            {"Code": ["00120", "13010"], "CoName": ["Alpha", "Beta"], "Date": ["2026-07-01"] * 2}
        )
        return self._respond(
            "get_eq_master", {"code": code, "date_yyyymmdd": date_yyyymmdd}, frame
        )

    def get_eq_bars_daily(
        self,
        code: str | None = None,
        date_yyyymmdd: str | None = None,
        from_yyyymmdd: str | None = None,
        to_yyyymmdd: str | None = None,
    ) -> Any:
        frame = pd.DataFrame(
            {
                "Code": ["00120", "00120"],
                "Date": ["2026-07-01", "2026-07-02"],
                "O": [100.0, 101.0],
                "H": [102.0, 103.0],
                "L": [99.0, 100.0],
                "C": [101.0, 102.0],
                "Vo": [1000, 1200],
                "AdjC": [101.0, 102.0],
            }
        )
        return self._respond(
            "get_eq_bars_daily",
            {
                "code": code,
                "date_yyyymmdd": date_yyyymmdd,
                "from_yyyymmdd": from_yyyymmdd,
                "to_yyyymmdd": to_yyyymmdd,
            },
            frame,
        )

    def get_eq_bars_daily_range(self, start_dt: datetime, end_dt: datetime) -> Any:
        frame = pd.DataFrame(
            {
                "Code": ["13010", "13020"],
                "Date": [start_dt.date().isoformat(), end_dt.date().isoformat()],
                "C": [200.0, 201.0],
            }
        )
        return self._respond(
            "get_eq_bars_daily_range", {"start_dt": start_dt, "end_dt": end_dt}, frame
        )

    def get_fin_summary(
        self,
        code: str | None = None,
        date_yyyymmdd: str | None = None,
        from_yyyymmdd: str | None = None,
        to_yyyymmdd: str | None = None,
    ) -> Any:
        frame = pd.DataFrame(
            {
                "Code": ["00120"],
                "DiscDate": ["2026-06-30"],
                "Sales": [1000.0],
                "OP": [120.0],
                "Profit": [80.0],
                "EPS": [50.0],
            }
        )
        return self._respond(
            "get_fin_summary",
            {
                "code": code,
                "date_yyyymmdd": date_yyyymmdd,
                "from_yyyymmdd": from_yyyymmdd,
                "to_yyyymmdd": to_yyyymmdd,
            },
            frame,
        )


def test_master_and_bars_are_normalized_and_code_stays_string() -> None:
    client = FakeClient()
    provider = JQuantsProvider(client=client)
    master = provider.get_master(as_of="2026-07-01")
    bars = provider.get_daily_bars(code="00120", start="2026-07-01", end="2026-07-02")
    assert master.loc[0, "code"] == "00120"
    assert str(master["code"].dtype) == "string"
    assert {"date", "open", "high", "low", "close", "volume", "adjusted_close"}.issubset(
        bars.columns
    )
    assert bars["code"].tolist() == ["00120", "00120"]
    assert pd.api.types.is_datetime64_any_dtype(bars["date"])


def test_range_uses_timezone_aware_jst_datetimes_and_supports_pages() -> None:
    client = FakeClient()
    client.pages = True
    provider = JQuantsProvider(client=client)
    bars = provider.get_daily_bars(start="2026-07-01", end="2026-07-02")
    _, kwargs = client.calls[-1]
    assert kwargs["start_dt"].tzinfo is not None
    assert kwargs["start_dt"].utcoffset().total_seconds() == 9 * 3600
    assert len(bars) == 2


def test_financial_summary_uses_internal_schema() -> None:
    provider = JQuantsProvider(client=FakeClient())
    summary = provider.get_financial_summary(code="00120", as_of="2026-06-30")
    assert summary.loc[0, "net_sales"] == 1000.0
    assert summary.loc[0, "operating_profit"] == 120.0
    assert summary.loc[0, "code"] == "00120"


def test_missing_key_and_missing_optional_dependency(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.delenv("JQUANTS_API_KEY", raising=False)
    with pytest.raises(JQuantsAuthError):
        JQuantsProvider()

    monkeypatch.setenv("JQUANTS_API_KEY", "not-a-real-key")

    def missing_module(name: str) -> Any:
        if name == "jquantsapi":
            raise ImportError(name)
        return __import__(name)

    monkeypatch.setattr("investment_audit.providers.jquants.importlib.import_module", missing_module)
    with pytest.raises(JQuantsDependencyError):
        JQuantsProvider()


def test_rate_limit_retries_with_exponential_backoff() -> None:
    client = FakeClient()
    client.failures = [429, 429]
    sleeps: list[float] = []
    provider = JQuantsProvider(
        JQuantsConfig(max_retries=2, backoff_seconds=0.25),
        client=client,
        sleep_fn=sleeps.append,
    )
    result = provider.get_master()
    assert not result.empty
    assert sleeps == [0.25, 0.5]


def test_rate_limit_and_server_error_have_typed_failures() -> None:
    rate_client = FakeClient()
    rate_client.failures = [429, 429]
    with pytest.raises(JQuantsRateLimitError):
        JQuantsProvider(
            JQuantsConfig(max_retries=1, backoff_seconds=0), client=rate_client
        ).get_master()

    server_client = FakeClient()
    server_client.failures = [503, 503]
    with pytest.raises(JQuantsUnavailableError):
        JQuantsProvider(
            JQuantsConfig(max_retries=1, backoff_seconds=0), client=server_client
        ).get_master()


def test_empty_response_and_invalid_date_range() -> None:
    client = FakeClient()
    client.empty = True
    with pytest.raises(JQuantsEmptyResponseError):
        JQuantsProvider(client=client).get_master()
    with pytest.raises(ValueError):
        JQuantsProvider(client=FakeClient()).get_daily_bars(
            start="2026-07-02", end="2026-07-01"
        )


def test_cache_prevents_duplicate_client_calls(tmp_path: Path) -> None:
    client = FakeClient()
    provider = JQuantsProvider(
        JQuantsConfig(cache_dir=tmp_path, cache_ttl_seconds=60), client=client
    )
    first = provider.get_master(as_of="2026-07-01")
    second = provider.get_master(as_of="2026-07-01")
    pd.testing.assert_frame_equal(first, second)
    assert len(client.calls) == 1
