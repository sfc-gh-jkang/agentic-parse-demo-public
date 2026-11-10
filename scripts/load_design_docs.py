"""Load the repo's design docs into DESIGN_DOCS, one row per markdown section.

Run: uv run python scripts/load_design_docs.py   (connection from SNOWFLAKE_CONNECTION, default from config.env)
"""
import os
import re
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
DOC_GLOBS = [
    "README.md",
    "docs/SPEC.md",
    "docs/adr/*.md",
    "GLOSSARY.md",
    "docs/parse-output-notes.md",
    "docs/stage2-report.md",
    "docs/runbook.md",
    "docs/talk-track.md",
    "docs/audits.md",
    "docs/app-guide.md",
    "docs/production-path.md",
    "docs/operating-cost.md",
    "docs/sharing.md",
    "docs/technical-guide.md",
]
HEADING = re.compile(r"^(#{1,6})\s+(.*?)\s*#*\s*$")


def chunk_markdown(text: str, max_chars: int = 6000) -> list[tuple[str, str]]:
    """Split markdown into (section path, chunk) pairs at headings, ignoring fenced code."""
    sections: list[tuple[str, list[str]]] = [("", [])]
    stack: list[tuple[int, str]] = []
    in_fence = False
    for line in text.splitlines():
        if line.lstrip().startswith(("```", "~~~")):
            in_fence = not in_fence
        m = None if in_fence else HEADING.match(line)
        if m:
            level = len(m.group(1))
            stack = [s for s in stack if s[0] < level] + [(level, m.group(2))]
            sections.append((" > ".join(t for _, t in stack), [line]))
        else:
            sections[-1][1].append(line)
    out = []
    for path, lines in sections:
        body = "\n".join(lines).strip()
        if not body or (HEADING.match(body) and "\n" not in body):
            continue
        while len(body) > max_chars:
            cut = body.rfind(" ", 0, max_chars)
            cut = cut if cut > 0 else max_chars
            out.append((path, body[:cut].strip()))
            body = body[cut:].strip()
        if body:
            out.append((path, body))
    return out


def collect() -> list[tuple[str, str, str]]:
    rows = []
    for pattern in DOC_GLOBS:
        for f in sorted(ROOT.glob(pattern)):
            rel = f.relative_to(ROOT).as_posix()
            rows += [(rel, s, c) for s, c in chunk_markdown(f.read_text())]
    return rows


def main() -> None:
    # Imported here so snowsight/install.sql can import this module in a procedure without demo_config.
    import sys
    sys.path.insert(0, str(Path(__file__).resolve().parent))
    import demo_config
    import snowflake.connector

    _CFG = demo_config.load()
    TABLE = _CFG["FQ_SCHEMA"] + ".DESIGN_DOCS"
    rows = collect()
    with snowflake.connector.connect(
        connection_name=_CFG["SNOWFLAKE_CONNECTION"],
        role=_CFG["DEMO_ROLE"],
        warehouse=_CFG["DEMO_WAREHOUSE"],
    ) as conn:
        cur = conn.cursor()
        cur.execute("BEGIN")
        cur.execute(f"DELETE FROM {TABLE}")
        cur.executemany(f"INSERT INTO {TABLE} (PATH, SECTION, CHUNK) VALUES (%s, %s, %s)", rows)
        cur.execute("COMMIT")
    print(f"loaded {len(rows)} design-doc chunks into {TABLE}")


if __name__ == "__main__":
    main()
