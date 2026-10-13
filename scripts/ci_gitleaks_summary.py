"""Emit gitleaks findings as workflow annotations / step summary.

Used by CI only: secrets themselves are never printed (gitleaks runs with
``--redact`` and this script only reports rule id + file + line).
"""

from __future__ import annotations

import json
import os
import sys
from pathlib import Path


def main() -> int:
    report = Path(sys.argv[1] if len(sys.argv) > 1 else "/tmp/gitleaks.json")
    log = Path(sys.argv[2] if len(sys.argv) > 2 else "/tmp/gitleaks.log")
    findings = []
    if report.exists() and report.stat().st_size:
        try:
            findings = json.loads(report.read_text(encoding="utf-8"))
        except (ValueError, OSError):
            findings = []

    lines = [f"gitleaks findings: {len(findings)}"]
    for finding in findings:
        file = finding.get("File", "")
        line = finding.get("StartLine", "")
        rule = finding.get("RuleID", "")
        lines.append(f"gitleaks rule {rule} in {file}:{line}")
        print(f"::error file={file},line={line}::gitleaks rule {rule} in {file}:{line}")

    if not findings and log.exists():
        tail = log.read_text(encoding="utf-8", errors="replace").splitlines()[-50:]
        lines.append("gitleaks log tail:")
        lines.extend(tail)

    summary_path = os.environ.get("GITHUB_STEP_SUMMARY")
    if summary_path:
        with open(summary_path, "a", encoding="utf-8") as handle:
            handle.write("### Secret scan (gitleaks)\n\n```\n")
            handle.write("\n".join(lines))
            handle.write("\n```\n")
    else:
        print("\n".join(lines))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
