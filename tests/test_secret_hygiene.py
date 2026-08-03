from __future__ import annotations

import re
from pathlib import Path


SECRET_LITERAL = re.compile(
    r"(?i)(?:api[_-]?key|access[_-]?token|refresh[_-]?token|client[_-]?secret)"
    r"\s*[:=]\s*[\"'][A-Za-z0-9_./+=-]{24,}[\"']"
)


def test_jquants_changes_do_not_contain_literal_credentials() -> None:
    root = Path(__file__).resolve().parents[1]
    paths = [
        root / "src/investment_audit/jquants_pipeline.py",
        root / "src/investment_audit/cli.py",
        root / "docs/jquants-live-screening.md",
        root / "docs/jquants-plan-guide.md",
        root / ".github/workflows/jquants-screen.yml",
    ]
    findings: list[str] = []
    for path in paths:
        text = path.read_text(encoding="utf-8")
        for match in SECRET_LITERAL.finditer(text):
            findings.append(f"{path.relative_to(root)}:{text.count(chr(10), 0, match.start()) + 1}")
    assert not findings, f"credential-like literal found in: {', '.join(findings)}"
