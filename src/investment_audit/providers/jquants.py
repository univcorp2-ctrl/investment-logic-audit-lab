from __future__ import annotations

import datetime as dt
import hashlib
import importlib
import inspect
import os
import time
from collections.abc import Callable, Iterable
from dataclasses import dataclass
from pathlib import Path
from typing import Any
from zoneinfo import ZoneInfo

import numpy as np
import pandas as pd


class JQuantsProviderError(RuntimeError):
    """Base error for the J-Quants V2 adapter."""


class JQuantsAuthError(JQuantsProviderError):
    """Authentication is missing or rejected."""


class JQuantsDependencyError(JQuantsProviderError):
    """The optional official client is not installed."""


class JQuantsRateLimitError(JQuantsProviderError):
    """The API returned HTTP 429 after bounded retries."""


class JQuantsUnavailableError(JQuantsProviderError):
    """The API remained unavailable after bounded retries."""


class JQuantsEmptyResponseError(JQuantsProviderError):
    """The API returned no rows when rows were required."""


@dataclass(frozen=True)
class JQuantsConfig:
    api_key: str | None = None
    max_retries: int = 2
    backoff_seconds: float = 0.5
    cache_dir: Path | None = None
    cache_ttl_seconds: int = 86_400
    allow_empty: bool = False

    def __post_init__(self) -> None:
        if self.max_retries < 0:
            raise ValueError("max_retries must be non-negative")
        if self.backoff_seconds < 0:
            raise ValueError("backoff_seconds must be non-negative")
        if self.cache_ttl_seconds < 0:
            raise ValueError("cache_ttl_seconds must be non-negative")

    @property
    def resolved_api_key(self) -> str | None:
        return self.api_key or os.getenv("JQUANTS_API_KEY")


class JQuantsProvider:
    """J-Quants API V2 adapter using the official ``jquantsapi.ClientV2``.

    The client can be injected for tests. No live API call is made by the CI
    suite, and the API key is never included in cache keys or error messages.
    """

    def __init__(
        self,
        config: JQuantsConfig | None = None,
        client: Any | None = None,
        sleep_fn: Callable[[float], None] = time.sleep,
    ) -> None:
        self.config = config or JQuantsConfig()
        self._sleep = sleep_fn
        self._client = client if client is not None else self._load_default_client()
        if self.config.cache_dir is not None:
            self.config.cache_dir.mkdir(parents=True, exist_ok=True)

    def _load_default_client(self) -> Any:
        api_key = self.config.resolved_api_key
        if not api_key:
            raise JQuantsAuthError(
                "JQUANTS_API_KEY is not configured. Store it in the environment or a GitHub Actions secret."
            )
        try:
            module = importlib.import_module("jquantsapi")
        except ImportError as exc:
            raise JQuantsDependencyError(
                "Install the optional dependency with: pip install -e '.[jquants]'"
            ) from exc
        client_class = getattr(module, "ClientV2", None)
        if client_class is None:
            raise JQuantsDependencyError("The installed jquantsapi package has no ClientV2 class")
        return client_class(api_key=api_key)

    @staticmethod
    def _date_text(value: dt.date | str | None) -> str | None:
        if value is None:
            return None
        parsed = pd.Timestamp(value)
        if pd.isna(parsed):
            raise ValueError(f"invalid date: {value}")
        return parsed.strftime("%Y%m%d")

    @staticmethod
    def _jst_datetime(value: dt.date | str) -> dt.datetime:
        parsed = pd.Timestamp(value)
        if pd.isna(parsed):
            raise ValueError(f"invalid date: {value}")
        plain_date = parsed.date()
        return dt.datetime.combine(plain_date, dt.time.min, tzinfo=ZoneInfo("Asia/Tokyo"))

    @staticmethod
    def _validate_range(
        start: dt.date | str | None,
        end: dt.date | str | None,
    ) -> None:
        if start is not None and end is not None and pd.Timestamp(start) > pd.Timestamp(end):
            raise ValueError("start must be on or before end")

    @staticmethod
    def _status_code(exc: BaseException) -> int | None:
        direct = getattr(exc, "status_code", None)
        if isinstance(direct, int):
            return direct
        response = getattr(exc, "response", None)
        response_code = getattr(response, "status_code", None)
        return response_code if isinstance(response_code, int) else None

    @staticmethod
    def _invoke(method: Callable[..., Any], options: Iterable[tuple[tuple[str, ...], Any]]) -> Any:
        signature = inspect.signature(method)
        parameters = signature.parameters
        accepts_kwargs = any(
            parameter.kind is inspect.Parameter.VAR_KEYWORD
            for parameter in parameters.values()
        )
        kwargs: dict[str, Any] = {}
        for aliases, value in options:
            if value is None:
                continue
            if accepts_kwargs:
                kwargs[aliases[0]] = value
                continue
            for alias in aliases:
                if alias in parameters:
                    kwargs[alias] = value
                    break
        return method(**kwargs)

    @staticmethod
    def _as_frame(payload: Any) -> pd.DataFrame:
        if isinstance(payload, pd.DataFrame):
            return payload.copy()
        if payload is None:
            return pd.DataFrame()
        if isinstance(payload, list):
            if not payload:
                return pd.DataFrame()
            if all(isinstance(page, pd.DataFrame) for page in payload):
                return pd.concat(payload, ignore_index=True)
            return pd.DataFrame(payload)
        if isinstance(payload, dict):
            for value in payload.values():
                if isinstance(value, list):
                    return pd.DataFrame(value)
            return pd.DataFrame([payload])
        raise JQuantsProviderError(
            f"Unsupported J-Quants response type: {type(payload).__name__}"
        )

    def _cache_path(self, operation: str, parameters: dict[str, Any]) -> Path | None:
        if self.config.cache_dir is None:
            return None
        serialized = "|".join(
            f"{key}={value.isoformat() if isinstance(value, (dt.date, dt.datetime)) else value}"
            for key, value in sorted(parameters.items())
            if value is not None
        )
        digest = hashlib.sha256(f"{operation}|{serialized}".encode()).hexdigest()[:24]
        return self.config.cache_dir / f"{operation}-{digest}.pkl"

    def _read_cache(self, path: Path | None) -> pd.DataFrame | None:
        if path is None or not path.exists():
            return None
        age = time.time() - path.stat().st_mtime
        if age > self.config.cache_ttl_seconds:
            return None
        cached = pd.read_pickle(path)
        return cached.copy() if isinstance(cached, pd.DataFrame) else None

    @staticmethod
    def _write_cache(path: Path | None, frame: pd.DataFrame) -> None:
        if path is not None:
            frame.to_pickle(path)

    def _request(
        self,
        operation: str,
        options: list[tuple[tuple[str, ...], Any]],
        cache_parameters: dict[str, Any],
    ) -> pd.DataFrame:
        cache_path = self._cache_path(operation, cache_parameters)
        cached = self._read_cache(cache_path)
        if cached is not None:
            return cached
        method = getattr(self._client, operation, None)
        if method is None or not callable(method):
            raise JQuantsProviderError(f"ClientV2 does not provide {operation}")

        attempts = self.config.max_retries + 1
        for attempt in range(attempts):
            try:
                frame = self._as_frame(self._invoke(method, options))
                if frame.empty and not self.config.allow_empty:
                    raise JQuantsEmptyResponseError(f"{operation} returned no rows")
                self._write_cache(cache_path, frame)
                return frame
            except JQuantsEmptyResponseError:
                raise
            except Exception as exc:
                status = self._status_code(exc)
                if status in {401, 403}:
                    raise JQuantsAuthError("J-Quants rejected the configured API key") from exc
                retryable = status == 429 or (status is not None and 500 <= status < 600)
                if retryable and attempt + 1 < attempts:
                    self._sleep(self.config.backoff_seconds * (2**attempt))
                    continue
                if status == 429:
                    raise JQuantsRateLimitError(
                        "J-Quants rate limit exceeded after bounded retries"
                    ) from exc
                if status is not None and 500 <= status < 600:
                    raise JQuantsUnavailableError(
                        "J-Quants remained unavailable after bounded retries"
                    ) from exc
                raise JQuantsProviderError(f"{operation} failed") from exc
        raise JQuantsProviderError(f"{operation} failed without a response")

    @staticmethod
    def _code(value: Any) -> Any:
        if pd.isna(value):
            return pd.NA
        text = str(value).strip()
        if text.endswith(".0") and text[:-2].isdigit():
            text = text[:-2]
        return text.zfill(5) if text.isdigit() and len(text) < 5 else text

    @classmethod
    def _normalize(
        cls,
        frame: pd.DataFrame,
        aliases: dict[str, tuple[str, ...]],
        date_columns: tuple[str, ...],
    ) -> pd.DataFrame:
        normalized = frame.copy()
        for canonical, candidates in aliases.items():
            if canonical in normalized.columns:
                continue
            for candidate in candidates:
                if candidate in normalized.columns:
                    normalized[canonical] = normalized[candidate]
                    break
        if "code" in normalized.columns:
            normalized["code"] = normalized["code"].map(cls._code).astype("string")
        for column in date_columns:
            if column in normalized.columns:
                normalized[column] = pd.to_datetime(normalized[column], errors="coerce")
        canonical_columns = [column for column in aliases if column in normalized.columns]
        remaining = [column for column in normalized.columns if column not in canonical_columns]
        normalized = normalized[canonical_columns + remaining]
        subset = [column for column in ("code", *date_columns) if column in normalized.columns]
        if subset:
            normalized = normalized.drop_duplicates(subset=subset, keep="last")
            normalized = normalized.sort_values(subset, kind="stable")
        return normalized.reset_index(drop=True).replace([np.inf, -np.inf], np.nan)

    def get_master(
        self,
        code: str | None = None,
        as_of: dt.date | str | None = None,
    ) -> pd.DataFrame:
        frame = self._request(
            "get_eq_master",
            [
                (("code",), code),
                (("date_yyyymmdd", "date"), self._date_text(as_of)),
            ],
            {"code": code, "as_of": as_of},
        )
        return self._normalize(
            frame,
            {
                "code": ("Code",),
                "company_name": ("CoName", "CompanyName"),
                "company_name_english": ("CoNameEn", "CompanyNameEnglish"),
                "market_code": ("Mkt", "MarketCode"),
                "market_name": ("MktNm", "MarketCodeName"),
                "sector_17": ("S17", "Sector17CodeName"),
                "sector_33": ("S33", "Sector33CodeName"),
                "date": ("Date",),
            },
            ("date",),
        )

    def get_daily_bars(
        self,
        code: str | None = None,
        start: dt.date | str | None = None,
        end: dt.date | str | None = None,
        as_of: dt.date | str | None = None,
    ) -> pd.DataFrame:
        self._validate_range(start, end)
        if (
            code is None
            and as_of is None
            and start is not None
            and end is not None
            and hasattr(self._client, "get_eq_bars_daily_range")
        ):
            operation = "get_eq_bars_daily_range"
            options = [
                (("start_dt",), self._jst_datetime(start)),
                (("end_dt",), self._jst_datetime(end)),
            ]
        else:
            operation = "get_eq_bars_daily"
            options = [
                (("code",), code),
                (("date_yyyymmdd", "date"), self._date_text(as_of)),
                (("from_yyyymmdd", "start", "from_date"), self._date_text(start)),
                (("to_yyyymmdd", "end", "to_date"), self._date_text(end)),
            ]
        frame = self._request(
            operation,
            options,
            {"code": code, "start": start, "end": end, "as_of": as_of},
        )
        normalized = self._normalize(
            frame,
            {
                "code": ("Code",),
                "date": ("Date",),
                "open": ("O", "Open"),
                "high": ("H", "High"),
                "low": ("L", "Low"),
                "close": ("C", "Close"),
                "volume": ("Vo", "Volume"),
                "adjusted_open": ("AdjO", "AdjustmentOpen"),
                "adjusted_high": ("AdjH", "AdjustmentHigh"),
                "adjusted_low": ("AdjL", "AdjustmentLow"),
                "adjusted_close": ("AdjC", "AdjustmentClose"),
                "adjusted_volume": ("AdjVo", "AdjustmentVolume"),
            },
            ("date",),
        )
        if code is not None and "code" in normalized.columns:
            normalized = normalized.loc[normalized["code"] == self._code(code)].reset_index(drop=True)
        return normalized

    def get_financial_summary(
        self,
        code: str | None = None,
        start: dt.date | str | None = None,
        end: dt.date | str | None = None,
        as_of: dt.date | str | None = None,
    ) -> pd.DataFrame:
        self._validate_range(start, end)
        if (
            code is None
            and as_of is None
            and start is not None
            and end is not None
            and hasattr(self._client, "get_fin_summary_range")
        ):
            operation = "get_fin_summary_range"
            options = [
                (("start_dt",), self._jst_datetime(start)),
                (("end_dt",), self._jst_datetime(end)),
            ]
        else:
            operation = "get_fin_summary"
            options = [
                (("code",), code),
                (("date_yyyymmdd", "date"), self._date_text(as_of)),
                (("from_yyyymmdd", "start", "from_date"), self._date_text(start)),
                (("to_yyyymmdd", "end", "to_date"), self._date_text(end)),
            ]
        frame = self._request(
            operation,
            options,
            {"code": code, "start": start, "end": end, "as_of": as_of},
        )
        normalized = self._normalize(
            frame,
            {
                "code": ("Code",),
                "disclosed_date": ("DiscDate", "DisclosedDate"),
                "fiscal_year_end": ("FYE", "CurrentFiscalYearEndDate"),
                "period_end": ("CurPerEn", "CurrentPeriodEndDate"),
                "net_sales": ("Sales", "NetSales"),
                "operating_profit": ("OP", "OperatingProfit"),
                "ordinary_profit": ("OdP", "OrdinaryProfit"),
                "profit": ("Profit",),
                "eps": ("EPS", "EarningsPerShare"),
                "total_assets": ("TA", "TotalAssets"),
                "equity": ("Eq", "Equity"),
                "operating_cash_flow": ("CFO", "CashFlowsFromOperatingActivities"),
                "investing_cash_flow": ("CFI", "CashFlowsFromInvestingActivities"),
                "financing_cash_flow": ("CFF", "CashFlowsFromFinancingActivities"),
            },
            ("disclosed_date", "fiscal_year_end", "period_end"),
        )
        if code is not None and "code" in normalized.columns:
            normalized = normalized.loc[normalized["code"] == self._code(code)].reset_index(drop=True)
        return normalized
