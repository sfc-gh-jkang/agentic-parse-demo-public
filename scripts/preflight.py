"""Bring-your-own-document pre-flight: will AGENTIC show something on THIS file before a customer demo?

For each file: upload through UPLOAD_DOCUMENT (same checks as the app; name prefixed pf_, so the doc id is
up_pf_...), parse it in AGENTIC, LAYOUT and OCR with APP_PARSE (BILLED: pages x 3 modes; no estimate is
printed, measured credits come from PARSE_RUN_COST after the run, and usage telemetry can lag minutes),
ask a few generic questions of each mode's text alone (same prompt and model as /api/ask), and write a
markdown report. The upload is deleted afterwards unless --keep.

Usage: uv run python scripts/preflight.py FILE [FILE ...] [--out report.md] [--keep] [--cost-wait 600]
"""
import sys as _sys
from pathlib import Path as _Path
_sys.path.insert(0, str(_Path(__file__).resolve().parent))
import demo_config  # noqa: E402
_CFG = demo_config.load()
import argparse
import base64
import json
import os
import re
import sys
import time
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
S = _CFG["FQ_SCHEMA"]
MODES = ["AGENTIC", "LAYOUT", "OCR"]
NOT_FOUND = "Not in this parse"
MAX_CONTEXT = 60_000
# "No table ... appears" is the model saying the thing is absent, even when it sets found=true.
NEGATIVE = re.compile(r"^\s*(no|there (is|are) no|none)\b", re.I)
QUESTIONS = [
    "Does this document contain a table? If so, give its title or first column header and one row's values.",
    "Is there a number that appears only inside a chart, image, photo or stamp? Give one such number and what it measures.",
    "Is there a checkbox or tick box? Give one label and whether it is checked.",
    "What is the single most important total, amount or date in the document, with its label?",
]


def ask_model():
    m = re.search(r'ASK_MODEL = "([\w.-]+)"', (ROOT / "web" / "lib" / "ask.ts").read_text())
    return m.group(1)


def build_context(pages, visuals):
    """Port of web/lib/ask.ts buildContext."""
    s = lambda v: "" if v is None else str(v)
    ctx = "\n\n".join(f"[Page {int(p[0]) + 1}]\n{s(p[1])}" for p in pages)
    if visuals:
        ctx += "\n\n=== VISUALS understood by the agentic parser ===\n" + "\n".join(
            f"[Page {int(v[0]) + 1}] {s(v[2]) or 'visual'} {s(v[1])}: {s(v[3])} {s(v[4])} {s(v[5])}".strip() for v in visuals)
    return ctx[:MAX_CONTEXT]


def build_prompt(question, mode, context):
    """Port of web/lib/ask.ts buildPrompt (keep in sync)."""
    return (f"You answer a question about a document using ONLY the parsed text below. Do not use outside knowledge and do not guess. "
            f"Quote values the text states. Do not deduce a value, for example by matching unlabeled numbers to labels or reasoning from a "
            f"summary; finding the passage the question refers to is fine even when the text does not name it the same way. If the answer "
            f"is not in the text, set found to false and answer \"{NOT_FOUND}\".\n"
            "Keep the answer to one sentence at most. Include units and labels (for example \"$13.8M (USD millions)\", \"Unchecked\", \"Power feed to Rack R1\").\n"
            "Reply with JSON only: {\"found\": true|false, \"answer\": \"<short answer>\", \"pages\": [<1-based page numbers the answer comes from>]}\n\n"
            f"QUESTION: {question}\n\nPARSED TEXT ({mode} mode):\n{context}")


def parse_answer(raw):
    raw = raw.strip()
    if raw.startswith('"'):  # AI_COMPLETE over the connector returns a JSON-encoded string
        try:
            raw = json.loads(raw)
        except json.JSONDecodeError:
            pass
    found, answer = True, raw.strip()
    m = re.search(r"\{[\s\S]*\}", raw)
    if m:
        try:
            j = json.loads(m.group(0))
            answer = str(j.get("answer", answer)).strip()
            found = j.get("found") is not False
        except json.JSONDecodeError:
            pass
    if not answer or re.match(r"^\s*not (found )?in (this|the) parse", answer, re.I) or NEGATIVE.match(answer):
        found = False
    return found, (answer if found else NOT_FOUND)


def verdict(found):
    """found: {mode: bool}. AGENTIC wins when it answers and another mode does not."""
    if found["AGENTIC"] and not all(found.values()):
        return "AGENTIC wins"
    if all(found.values()):
        return "tie (all answer)"
    if not any(found.values()):
        return "none answer"
    return "AGENTIC misses"


def purge(cur, doc_id):
    cur.execute(f"REMOVE @{S}.DOCS/uploads/{doc_id}")
    for t in ("MODE_COMPARISONS", "PARSE_RUNS", "DOCUMENT_FILES", "DOCUMENTS"):
        cur.execute(f"DELETE FROM {S}.{t} WHERE DOC_ID = %s", (doc_id,))
    cur.execute(f"ALTER CORTEX SEARCH SERVICE {S}.PARSED_DOCS_SEARCH REFRESH")


def run_file(cur, path, model, cost_wait, keep):
    data = Path(path).read_bytes()
    up = json.loads(cur.execute(f"CALL {S}.UPLOAD_DOCUMENT(%s, %s)", (f"pf_{Path(path).name}", base64.b64encode(data).decode())).fetchone()[0])
    if not up.get("ok"):
        return {"file": str(path), "error": up.get("error")}
    doc = up["doc_id"]
    out = {"file": str(path), "doc_id": doc, "modes": {}, "questions": []}
    try:
        for mode in MODES:
            t0 = time.time()
            r = json.loads(cur.execute(f"CALL {S}.APP_PARSE(%s, %s)", (doc, mode)).fetchone()[0])
            out["modes"][mode] = {"run_id": r.get("run_id"), "pages": r.get("pages"), "error": r.get("error") or (None if r.get("ok") else r),
                                  "seconds": round(time.time() - t0, 1)}
            print(f"{doc} {mode} parsed in {out['modes'][mode]['seconds']} s, pages {r.get('pages')}", flush=True)
        ctx = {}
        for mode in MODES:
            pages = cur.execute(f"SELECT p.PAGE_INDEX, p.CONTENT FROM {S}.PARSE_PAGES p WHERE p.RUN_ID = %s ORDER BY 1",
                                (out["modes"][mode]["run_id"],)).fetchall()
            vis = cur.execute(f"SELECT PAGE_INDEX, VISUAL_ID, IMAGE_TYPE, SUMMARY, VISIBLE_TEXT, DETAILS::STRING FROM {S}.PARSE_VISUALS "
                              "WHERE RUN_ID = %s AND NOT FAILED ORDER BY 1, 2", (out["modes"][mode]["run_id"],)).fetchall() if mode == "AGENTIC" else []
            out["modes"][mode]["visuals"] = len(vis)
            ctx[mode] = build_context(pages, vis)
        for q in QUESTIONS:
            row = {"question": q, "answers": {}}
            for mode in MODES:
                raw = cur.execute("SELECT AI_COMPLETE(%s, %s)", (model, build_prompt(q, mode, ctx[mode]))).fetchone()[0]
                row["answers"][mode] = parse_answer(str(raw))
            row["verdict"] = verdict({m: a[0] for m, a in row["answers"].items()})
            out["questions"].append(row)
        # Measured cost only; poll until usage telemetry reports or cost_wait runs out.
        ids = [m["run_id"] for m in out["modes"].values() if m.get("run_id")]
        t0 = time.time()
        while True:
            rows = cur.execute(f"SELECT MODE, PAGES_BILLED, CREDITS, PENDING FROM {S}.PARSE_RUN_COST WHERE RUN_ID IN ({','.join(['%s'] * len(ids))})", ids).fetchall()
            if (rows and not any(r[3] for r in rows)) or time.time() - t0 > cost_wait:
                break
            time.sleep(30)
        out["cost"] = {r[0]: {"pages_billed": r[1], "credits": None if r[3] else float(r[2]), "pending": bool(r[3])} for r in rows}
        out["cost_waited_s"] = round(time.time() - t0)
    finally:
        if not keep:
            purge(cur, doc)
            out["deleted"] = True
    return out


def report_md(results, model):
    lines = ["# Pre-flight report", "",
             f"Generated {time.strftime('%Y-%m-%d %H:%M %Z')} by `scripts/preflight.py` on `{_CFG['SNOWFLAKE_CONNECTION']}`. "
             f"Each answer comes from AI_COMPLETE (`{model}`) over ONE mode's stored parse text, with the same prompt as the app's "
             "Compare answers table. Credits are measured from `CORTEX_AI_FUNCTIONS_USAGE_HISTORY` via `PARSE_RUN_COST`; "
             "\"pending\" means telemetry had not reported yet (it can lag minutes), never an estimate.", ""]
    for r in results:
        lines += [f"## {Path(r['file']).name}", ""]
        if r.get("error"):
            lines += [f"Upload rejected: {r['error']}", ""]
            continue
        lines += ["| Mode | Pages | Parse seconds | Visuals reported | AI credits (measured) |", "|---|---|---|---|---|"]
        for m in MODES:
            c = r.get("cost", {}).get(m, {})
            cr = "pending" if c.get("pending", True) else f"{c['credits']:.6f}"
            lines.append(f"| {m} | {r['modes'][m].get('pages')} | {r['modes'][m]['seconds']} | {r['modes'][m].get('visuals', 'n/a') if m == 'AGENTIC' else 'n/a'} | {cr} |")
        lines += ["", "| Question | AGENTIC | LAYOUT | OCR | Verdict |", "|---|---|---|---|---|"]
        for q in r["questions"]:
            cells = [q["answers"][m][1].replace("|", "\\|") for m in MODES]
            lines.append(f"| {q['question']} | " + " | ".join(cells) + f" | {q['verdict']} |")
        wins = sum(q["verdict"] == "AGENTIC wins" for q in r["questions"])
        ties = sum(q["verdict"].startswith("tie") for q in r["questions"])
        lines += ["", f"Summary: AGENTIC wins {wins}, ties {ties}, of {len(r['questions'])} questions. "
                  + ("Good demo document: AGENTIC shows something the other modes cannot." if wins else
                     "AGENTIC adds little on this document; LAYOUT is enough and cheaper. Consider a document with charts, stamps or photos."),
                  "", f"Upload `{r['doc_id']}` {'deleted after the run' if r.get('deleted') else 'kept (--keep)'}.", ""]
    return "\n".join(lines)


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("files", nargs="+")
    ap.add_argument("--out", default="preflight-report.md")
    ap.add_argument("--keep", action="store_true", help="keep the upload (and its runs) in the demo")
    ap.add_argument("--cost-wait", type=int, default=600, help="seconds to wait for usage telemetry")
    args = ap.parse_args()
    missing = [f for f in args.files if not Path(f).is_file()]
    if missing:
        ap.exit(2, f"preflight: not a file: {', '.join(missing)}\n")
    import snowflake.connector

    conn = snowflake.connector.connect(connection_name=_CFG["SNOWFLAKE_CONNECTION"],
                                       role=_CFG["DEMO_ROLE"], warehouse=_CFG["DEMO_WAREHOUSE"],
                                       database=_CFG["DEMO_DATABASE"], schema=_CFG["DEMO_SCHEMA"])
    cur = conn.cursor()
    model = ask_model()
    results = [run_file(cur, f, model, args.cost_wait, args.keep) for f in args.files]
    conn.close()
    md = report_md(results, model)
    Path(args.out).write_text(md)
    print(md)
    for r in results:
        for m, c in r.get("cost", {}).items():
            print(f"{Path(r['file']).name} {m}: {c['pages_billed']} pages, " + ("credits pending (telemetry lag)" if c["pending"] else f"{c['credits']:.6f} AI credits"))


if __name__ == "__main__":
    main()
