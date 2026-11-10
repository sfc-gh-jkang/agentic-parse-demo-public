"""Write docs/stage2-report.md: per-Document, per-Parse-Mode accuracy and measured cost.

Reads stored Parse Runs only (COMPARE_MODES, PARSE_COST); never re-parses.
Usage: uv run python scripts/report.py
"""
import sys as _sys
from pathlib import Path as _Path
_sys.path.insert(0, str(_Path(__file__).resolve().parent))
import demo_config  # noqa: E402
_CFG = demo_config.load()
import datetime as dt
import json
import os
from pathlib import Path

import snowflake.connector

MODES = ["OCR", "LAYOUT", "AGENTIC"]
OUT = Path(__file__).resolve().parent.parent / "docs" / "stage2-report.md"


def rows(cur, sql, *args):
    cur.execute(sql, args)
    cols = [c[0] for c in cur.description]
    return [dict(zip(cols, r)) for r in cur.fetchall()]


def pct(found, total):
    return "n/a" if not total else f"{found}/{total} ({100 * found / total:.0f}%)"


def main():
    cur = snowflake.connector.connect(
        connection_name=_CFG["SNOWFLAKE_CONNECTION"], role=_CFG["DEMO_ROLE"],
        warehouse=_CFG["DEMO_WAREHOUSE"], database=_CFG["DEMO_DATABASE"], schema=_CFG["DEMO_SCHEMA"]).cursor()
    account, region = cur.execute("SELECT CURRENT_ACCOUNT(), CURRENT_REGION()").fetchone()
    docs = [r["DOC_ID"] for r in rows(cur, "SELECT DOC_ID FROM DOCUMENTS WHERE SOURCE = 'corpus' ORDER BY 1")]
    scores = {d: {r["MODE"]: r for r in rows(cur, "CALL COMPARE_MODES(%s)", d)} for d in docs}
    cost = {r["MODE"]: r for r in rows(cur, "CALL PARSE_COST(NULL)")}
    totals = {m: {k: 0 for k in ["IMAGE_FACTS", "IMAGE_FACTS_FOUND", "TEXT_FACTS", "TEXT_FACTS_FOUND",
                                 "RELATIONS", "RELATIONS_FOUND", "VISUALS_EXPECTED", "VISUALS_DETECTED"]}
              for m in MODES}
    for d in docs:
        for m in MODES:
            for k in totals[m]:
                totals[m][k] += scores[d][m][k] or 0

    now = dt.datetime.now().strftime("%Y-%m-%d %H:%M")
    L = [f"# Stage 2 report: Parse Mode accuracy and measured cost", "",
         f"Generated {now} from stored Parse Runs in region {region} by `scripts/report.py`. "
         "Accuracy is scored by `COMPARE_MODES` against the Corpus Ground Truth (method in `scoring/score.py`); "
         "cost is measured by `PARSE_COST` from `SNOWFLAKE.ACCOUNT_USAGE.CORTEX_AI_FUNCTIONS_USAGE_HISTORY` "
         "(https://docs.snowflake.com/en/sql-reference/account-usage/cortex_ai_functions_usage_history). "
         "AGENTIC mode is in preview (https://docs.snowflake.com/en/user-guide/snowflake-cortex/parse-document#agentic-mode).",
         "", "## Corpus totals", "",
         "| Measure | OCR | LAYOUT | AGENTIC |", "|---|---|---|---|"]
    for label, a, b in [("Facts inside images", "IMAGE_FACTS_FOUND", "IMAGE_FACTS"),
                        ("Facts in page text", "TEXT_FACTS_FOUND", "TEXT_FACTS"),
                        ("Relations (value with its label, edge, row)", "RELATIONS_FOUND", "RELATIONS")]:
        L.append(f"| {label} | " + " | ".join(pct(totals[m][a], totals[m][b]) for m in MODES) + " |")
    # OCR and LAYOUT return text only; they cannot report Visuals, so 0% would be a category error.
    L.append("| Visuals detected and typed | n/a (text only) | n/a (text only) | "
             + pct(totals["AGENTIC"]["VISUALS_DETECTED"], totals["AGENTIC"]["VISUALS_EXPECTED"]) + " |")
    L.append("| Measured AI credits per 1,000 pages | " + " | ".join(
        f"{cost[m]['CREDITS_PER_1K_PAGES']}" if m in cost and cost[m]["CREDITS_PER_1K_PAGES"] is not None else "pending"
        for m in MODES) + " |")
    L.append("| Runs measured / pending | " + " | ".join(
        f"{cost[m]['MEASURED_RUNS']} / {cost[m]['PENDING_RUNS']}" if m in cost else "-" for m in MODES) + " |")
    L += ["", "Credits are AI credits billed per page, excluding warehouse credits. They include every stored run, "
          "test runs too.", "", "## Per Document", "",
          "Each cell: facts inside images · relations · visuals detected (AGENTIC only).", "",
          "| Document | OCR | LAYOUT | AGENTIC |", "|---|---|---|---|"]
    for d in docs:
        def cell(r, mode):
            vis = f"{r['VISUALS_DETECTED']}/{r['VISUALS_EXPECTED']}" if mode == "AGENTIC" else "–"
            return f"{r['IMAGE_FACTS_FOUND']}/{r['IMAGE_FACTS']} · {r['RELATIONS_FOUND']}/{r['RELATIONS']} · {vis}"
        L.append(f"| `{d}` | " + " | ".join(cell(scores[d][m], m) for m in MODES) + " |")
    L += ["", "## What AGENTIC missed", ""]
    for d in docs:
        missed = scores[d]["AGENTIC"]["MISSED"]
        missed = json.loads(missed) if isinstance(missed, str) else missed
        items = [f["fact"] for f in missed["facts"]] + [f"visual: {v}" for v in missed["visuals"]]
        if items:
            L.append(f"- `{d}`: " + "; ".join(items))
    L += ["", "## Method", "",
          "- A *fact* is one visible value from Ground Truth. It counts when it appears on its own page, in the "
          "page text or in the values (not key names) of that page's Visual results. Only a table that spans pages "
          "may match on another page.",
          "- Numbers match to the precision Ground Truth states: 13.8 accepts 13.75 to 13.85, a whole number needs "
          "that exact number, and dates are not read as numbers.",
          "- A *relation* counts only when its values are paired: a markdown table row, values next to each other on "
          "one line, or a small object in the structured results. Prose summaries never pair values.",
          "- A Visual counts as detected when an AGENTIC Visual of an accepted type overlaps the drawn box (IoU at "
          "least 0.3) on the same page. Whole-page scans and photos are read as the page, so they are scored as "
          "facts, not as Visuals.",
          "- These rules were tightened after an independent review found that looser matching let OCR text lines "
          "count as paired values. `tests/test_compare_fairness.py` holds the exploit cases; 7 of its 10 fail "
          "against the earlier scorer.",
          "", "## Ground Truth edits made while building the scorer", "",
          "- `inspection_form`, `claim_packet`: image_type `form` changed to `other` (with accepted alternatives), "
          "because `form` is not a type AGENTIC can return "
          "(https://docs.snowflake.com/en/user-guide/snowflake-cortex/parse-document#agentic-mode). "
          "No drawn content changed; the PDFs are byte-identical.",
          "- `control_contract`: added text-channel facts (title, effective date, parties, governing law, clause "
          "headings) so the Control Document has something to score. They were taken from the generator's own text; "
          "the PDF is byte-identical.",
          "- No other Ground Truth value was changed."]
    OUT.write_text("\n".join(L) + "\n")
    print(OUT)


if __name__ == "__main__":
    main()
