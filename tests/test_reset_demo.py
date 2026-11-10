"""RESET_DEMO: removes every Uploaded Document, keeps the 11-document Corpus.

Live (LIVE=1). No parse is billed: the upload is stored, never parsed. Note this removes ALL
uploads on the account, including any a presenter left (by design: it is the reset).
"""
import base64
import json
from pathlib import Path

import pytest
import demo_config  # noqa: E402  (scripts/ is on sys.path via conftest)

pytestmark = pytest.mark.live
STAGE = f"@{demo_config.load()['FQ_SCHEMA']}.DOCS"  # never REMOVE from another install's stage
RECEIPT = (Path(__file__).resolve().parent.parent / "corpus" / "receipt_photo.jpg").read_bytes()


def reset(cur):
    """Same statements as web/app/api/reset/route.ts."""
    r = json.loads(cur.execute("CALL RESET_DEMO()").fetchone()[0])
    cur.execute(f"REMOVE {STAGE}/uploads/")
    cur.execute(f"ALTER STAGE {STAGE[1:]} REFRESH")
    return r


def test_reset_removes_uploads_and_keeps_corpus(cur):
    b64 = base64.b64encode(RECEIPT).decode("ascii")
    up = json.loads(cur.execute("CALL UPLOAD_DOCUMENT(%s, %s)", ("qa reset.jpg", b64)).fetchone()[0])
    try:
        assert up["ok"] and up["doc_id"].startswith("up_qa_reset")
        r = reset(cur)
        assert r["ok"] and r["uploads_removed"] >= 1
        rows = cur.execute("SELECT SOURCE, COUNT(*) FROM DOCUMENTS GROUP BY 1").fetchall()
        counts = dict(rows)
        assert counts.get("corpus") == 11 and "upload" not in counts
        for t in ("DOCUMENT_FILES", "PARSE_RUNS", "MODE_COMPARISONS"):
            n = cur.execute(f"SELECT COUNT(*) FROM {t} WHERE DOC_ID LIKE 'up\\\\_%' ESCAPE '\\\\'").fetchone()[0]
            assert n == 0, t
        assert cur.execute(f"LIST {STAGE}/uploads/").fetchall() == []
    finally:
        cur.execute(f"REMOVE {STAGE}/uploads/{up.get('doc_id', 'none')}")
        for t in ("MODE_COMPARISONS", "PARSE_RUNS", "DOCUMENT_FILES", "DOCUMENTS"):
            cur.execute(f"DELETE FROM {t} WHERE DOC_ID = %s", (up.get("doc_id"),))
