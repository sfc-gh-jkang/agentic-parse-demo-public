"""Parse every Corpus Document in every Parse Mode via the PARSE_DOCUMENT procedure.

Usage: uv run python scripts/parse_corpus.py [--modes OCR,LAYOUT,AGENTIC] [--docs a,b] [--missing]
--missing skips Document/mode pairs that already have a successful Parse Run (setup.sh re-runs stay free).
Each call is billed per page; see docs/SPEC.md for the cost guardrails.
"""
import sys as _sys
from pathlib import Path as _Path
_sys.path.insert(0, str(_Path(__file__).resolve().parent))
import demo_config  # noqa: E402
_CFG = demo_config.load()
import argparse
import os
import time
from concurrent.futures import ThreadPoolExecutor

import snowflake.connector


def connect():
    return snowflake.connector.connect(
        connection_name=_CFG["SNOWFLAKE_CONNECTION"],
        role=_CFG["DEMO_ROLE"], warehouse=_CFG["DEMO_WAREHOUSE"],
        database=_CFG["DEMO_DATABASE"], schema=_CFG["DEMO_SCHEMA"])


def parse(doc_id: str, mode: str) -> tuple[str, str, str, float]:
    t0 = time.time()
    with connect() as conn:
        run_id = conn.cursor().execute("CALL PARSE_DOCUMENT(%s, %s)", (doc_id, mode)).fetchone()[0]
        err = None
        if not run_id.startswith("ERROR"):
            err = conn.cursor().execute(
                "SELECT ERROR FROM PARSE_RUNS WHERE RUN_ID = %s", (run_id,)).fetchone()[0]
    return doc_id, mode, err or run_id, time.time() - t0


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--modes", default="OCR,LAYOUT,AGENTIC")
    ap.add_argument("--docs", default="")
    ap.add_argument("--missing", action="store_true")
    args = ap.parse_args()
    with connect() as conn:
        docs = [r[0] for r in conn.cursor().execute(
            "SELECT DOC_ID FROM DOCUMENTS WHERE SOURCE = 'corpus' ORDER BY DOC_ID")]
    if args.docs:
        docs = [d for d in docs if d in args.docs.split(",")]
    jobs = [(d, m) for d in docs for m in args.modes.split(",")]
    if args.missing:
        with connect() as conn:
            done = set(conn.cursor().execute("SELECT DOC_ID, MODE FROM PARSE_RUNS WHERE ERROR IS NULL").fetchall())
        jobs = [j for j in jobs if j not in done]
    print(f"{len(jobs)} parse jobs", flush=True)
    with ThreadPoolExecutor(max_workers=6) as pool:
        for doc_id, mode, result, secs in pool.map(lambda j: parse(*j), jobs):
            print(f"{doc_id:22} {mode:8} {secs:6.1f}s  {result}", flush=True)


if __name__ == "__main__":
    main()
