from __future__ import annotations

import argparse
import csv
import json
import os
from pathlib import Path
from typing import Any

import requests

DEFAULT_KEYWORDS = [
    "stock",
    "stocks",
    "equity",
    "equities",
    "crypto",
    "bitcoin",
    "btc",
    "eth",
    "trading",
    "investment",
    "portfolio",
    "alpha",
    "backtest",
    "finance",
]


def _headers(token: str | None) -> dict[str, str]:
    headers = {
        "Accept": "application/vnd.github+json",
        "X-GitHub-Api-Version": "2022-11-28",
    }
    if token:
        headers["Authorization"] = f"Bearer {token}"
    return headers


def _get_all(url: str, token: str | None, params: dict[str, Any] | None = None) -> list[dict]:
    items: list[dict] = []
    page = 1
    while True:
        merged = {"per_page": 100, "page": page}
        if params:
            merged.update(params)
        response = requests.get(url, headers=_headers(token), params=merged, timeout=30)
        response.raise_for_status()
        batch = response.json()
        if not batch:
            break
        items.extend(batch)
        if len(batch) < 100:
            break
        page += 1
    return items


def list_candidate_repos(owner: str | None, token: str | None, keywords: list[str]) -> list[dict]:
    """List investment-related repositories visible to the token.

    Without an owner, authenticated `/user/repos` is used. With an owner, public repos
    for the user/org are listed. Private repos require `GH_INVENTORY_TOKEN`.
    """
    if owner:
        # Try user endpoint first; if it fails, try org endpoint.
        try:
            repos = _get_all(f"https://api.github.com/users/{owner}/repos", token)
        except requests.HTTPError:
            repos = _get_all(f"https://api.github.com/orgs/{owner}/repos", token)
    else:
        repos = _get_all(
            "https://api.github.com/user/repos",
            token,
            params={"affiliation": "owner,collaborator,organization_member", "sort": "updated"},
        )

    lowered_keywords = [k.lower() for k in keywords]
    candidates = []
    for repo in repos:
        blob = " ".join(
            str(repo.get(field) or "")
            for field in ["name", "description", "language", "html_url"]
        ).lower()
        topics = repo.get("topics") or []
        blob += " " + " ".join(topics).lower()
        if any(keyword in blob for keyword in lowered_keywords):
            candidates.append(
                {
                    "name": repo.get("name"),
                    "full_name": repo.get("full_name"),
                    "private": repo.get("private"),
                    "language": repo.get("language"),
                    "description": repo.get("description"),
                    "updated_at": repo.get("updated_at"),
                    "url": repo.get("html_url"),
                    "topics": ",".join(topics),
                }
            )
    return sorted(candidates, key=lambda x: str(x.get("updated_at")), reverse=True)


def write_inventory(repos: list[dict], out_dir: str | Path) -> dict[str, Path]:
    out = Path(out_dir)
    out.mkdir(parents=True, exist_ok=True)
    json_path = out / "investment_repo_inventory.json"
    csv_path = out / "investment_repo_inventory.csv"
    json_path.write_text(json.dumps(repos, indent=2, ensure_ascii=False), encoding="utf-8")
    fields = ["name", "full_name", "private", "language", "description", "updated_at", "url", "topics"]
    with csv_path.open("w", encoding="utf-8", newline="") as fh:
        writer = csv.DictWriter(fh, fieldnames=fields)
        writer.writeheader()
        writer.writerows(repos)
    return {"json": json_path, "csv": csv_path}


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description="List visible investment-related GitHub repos")
    parser.add_argument("--owner", default=os.getenv("GH_INVENTORY_OWNER"))
    parser.add_argument("--keywords", default=",".join(DEFAULT_KEYWORDS))
    parser.add_argument("--out", default="outputs/repo_inventory")
    args = parser.parse_args(argv)

    token = os.getenv("GH_INVENTORY_TOKEN") or os.getenv("GITHUB_TOKEN")
    keywords = [x.strip() for x in args.keywords.split(",") if x.strip()]
    repos = list_candidate_repos(owner=args.owner, token=token, keywords=keywords)
    paths = write_inventory(repos, args.out)
    print(f"Found {len(repos)} candidate repos")
    for key, path in paths.items():
        print(f"{key}: {path}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
