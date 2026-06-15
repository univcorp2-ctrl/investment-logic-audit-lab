from __future__ import annotations

import time
from dataclasses import dataclass
from typing import Any

import requests

SEC_BASE = "https://data.sec.gov/api/xbrl/companyfacts/CIK{cik}.json"


@dataclass(frozen=True)
class SecClient:
    user_agent: str
    delay_seconds: float = 0.2

    def companyfacts(self, cik: str) -> dict[str, Any]:
        """Fetch SEC Company Facts JSON for a zero-padded CIK.

        SEC requests require a descriptive User-Agent. Keep the caller responsible for
        setting contact information via an environment variable or configuration file.
        """
        cik10 = str(cik).zfill(10)
        headers = {"User-Agent": self.user_agent, "Accept-Encoding": "gzip, deflate"}
        response = requests.get(SEC_BASE.format(cik=cik10), headers=headers, timeout=30)
        time.sleep(self.delay_seconds)
        response.raise_for_status()
        return response.json()


def latest_us_gaap_value(companyfacts: dict[str, Any], concept: str) -> float | None:
    """Extract the latest USD value for a US-GAAP concept when present."""
    facts = companyfacts.get("facts", {}).get("us-gaap", {}).get(concept, {}).get("units", {})
    usd = facts.get("USD") or facts.get("shares") or []
    if not usd:
        return None
    completed = [x for x in usd if x.get("form") in {"10-K", "10-Q"} and x.get("val") is not None]
    if not completed:
        return None
    completed.sort(key=lambda x: (x.get("end", ""), x.get("filed", "")))
    return float(completed[-1]["val"])
