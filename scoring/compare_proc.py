"""Snowpark glue shared by COMPARE_MODES and REFRESH_MODE_COMPARISONS.

Reads one Document's Ground Truth and latest Parse Runs and scores each Parse Mode
with score.score_mode. Kept apart from score.py so the scorer stays free of Snowflake.
"""
import json

import score

IMAGE_FILE_TYPES = ("jpg", "jpeg", "png", "tif", "tiff")
COUNT_COLUMNS = ("IMAGE_FACTS", "IMAGE_FACTS_FOUND", "TEXT_FACTS", "TEXT_FACTS_FOUND", "RELATIONS",
                 "RELATIONS_FOUND", "VISUALS_EXPECTED", "VISUALS_DETECTED", "CHARS", "TABLES")


def _json(v):
    return json.loads(v) if isinstance(v, str) else (v or {})


def score_document(session, doc_id):
    """One dict per Parse Mode with a latest successful run; [] when there is no Ground Truth."""
    doc = session.sql("SELECT GROUND_TRUTH, FILE_TYPE FROM DOCUMENTS WHERE DOC_ID = ?", [doc_id]).collect()
    if not doc or doc[0]["GROUND_TRUTH"] is None:
        return []
    truth = _json(doc[0]["GROUND_TRUTH"])
    is_image_file = doc[0]["FILE_TYPE"] in IMAGE_FILE_TYPES
    out = []
    for parse_run in session.sql("SELECT RUN_ID, MODE, FINISHED_AT FROM LATEST_RUNS "
                                 "WHERE DOC_ID = ? AND ERROR IS NULL ORDER BY MODE", [doc_id]).collect():
        run_id = parse_run["RUN_ID"]
        pages = {p["PAGE_INDEX"]: p["CONTENT"] or "" for p in session.sql(
            "SELECT PAGE_INDEX, CONTENT FROM PARSE_PAGES WHERE RUN_ID = ?", [run_id]).collect()}
        visuals = [{"page": v["PAGE_INDEX"], "visual_id": v["VISUAL_ID"], "image_type": v["IMAGE_TYPE"],
                    "results": _json(v["RESULTS"]), "x0": v["X0"], "y0": v["Y0"], "x1": v["X1"], "y1": v["Y1"]}
                   for v in session.sql("SELECT PAGE_INDEX, VISUAL_ID, IMAGE_TYPE, RESULTS, X0, Y0, X1, Y1 "
                                        "FROM PARSE_VISUALS WHERE RUN_ID = ? AND NOT FAILED", [run_id]).collect()]
        s = score.score_mode(truth, pages, visuals, is_image_file)
        out.append({"MODE": parse_run["MODE"], "RUN_ID": run_id, "FINISHED_AT": parse_run["FINISHED_AT"],
                    **{c: s[c] for c in COUNT_COLUMNS}, "MATCHES": s["MATCHES"], "MISSED": s["MISSED"]})
    return out
