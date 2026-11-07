#!/usr/bin/env python3
"""Guardrail: fail if any inline `style="..."` attribute sneaks back in.

Production runs a strict CSP (`style-src 'self'`), so inline style attributes
are blocked by the browser. Use CSS classes in styles.css instead. CSSOM
assignments such as `el.style.color = ...` are allowed and not matched here.

Scans src/ (all .ts files) and index.html. Exits 1 on any match.
"""

import re
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent

PATTERN = re.compile(r"""style\s*=\s*["']""")

# Allow-listed exceptions (file, line substring). Keep empty until needed.
ALLOWLIST: list[tuple[str, str]] = []

TARGETS = [ROOT / "src", ROOT / "index.html"]


def iter_files():
    for target in TARGETS:
        if target.is_file():
            yield target
        elif target.is_dir():
            yield from sorted(target.rglob("*.ts"))


def main() -> int:
    violations = []
    for path in iter_files():
        text = path.read_text(encoding="utf-8")
        for lineno, line in enumerate(text.splitlines(), start=1):
            if PATTERN.search(line):
                rel = str(path.relative_to(ROOT))
                if any(a == rel and s in line for a, s in ALLOWLIST):
                    continue
                violations.append(f"{rel}:{lineno}: {line.strip()}")

    if violations:
        print("Inline style attributes are not allowed (CSP style-src 'self').")
        print("Move the styling into styles.css classes instead.\n")
        for v in violations:
            print(f"  {v}")
        return 1

    print("No inline style attributes found.")
    return 0


if __name__ == "__main__":
    sys.exit(main())
