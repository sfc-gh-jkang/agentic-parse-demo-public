"""T13: an Uploaded Document parsed in AGENTIC mode becomes findable by the agent within ~a minute.

Live (LIVE=1). Billing: one AGENTIC parse of a generated 1-page PDF. Everything created is removed.
"""
import base64
import io
import json
import secrets
import time

import pytest

from test_search_agent import ask, search
from test_upload import _purge, _upload

pytestmark = pytest.mark.live
TIMEOUT_S = 180


def _pdf(phrase):
    from reportlab.pdfgen import canvas

    buf = io.BytesIO()
    c = canvas.Canvas(buf)
    c.setFont("Helvetica", 18)
    c.drawString(72, 720, "Field memo")
    c.drawString(72, 690, f"The reference codeword for this memo is {phrase}.")
    c.save()
    return buf.getvalue()


@pytest.fixture
def upload(cur):
    made = []
    yield made
    for d in made:
        _purge(cur, d)
    cur.execute("ALTER CORTEX SEARCH SERVICE PARSED_DOCS_SEARCH REFRESH")


def test_agentic_upload_is_searchable_and_agent_answers(cur, upload):
    phrase = "zanzibar" + secrets.token_hex(3)
    r = _upload(cur, "memo.pdf", _pdf(phrase))
    upload.append(r["doc_id"])
    t0 = time.time()
    p = json.loads(cur.execute("CALL APP_PARSE(%s, 'AGENTIC')", (r["doc_id"],)).fetchone()[0])
    assert p["ok"] and not p["error"], p
    parse_s = time.time() - t0
    t1 = time.time()

    hit = None
    while time.time() - t1 < TIMEOUT_S:
        res = search(cur, "PARSED_DOCS_SEARCH", phrase, ["DOC_ID", "CHUNK"], limit=5)
        hit = next((x for x in res if x["DOC_ID"] == r["doc_id"] and phrase in x["CHUNK"].lower()), None)
        if hit:
            break
        time.sleep(5)
    print(f"parse {parse_s:.0f}s, searchable {time.time() - t1:.0f}s after parse")
    assert hit, "uploaded doc never became searchable"

    answer = ask(cur, f"What is the reference codeword in the uploaded memo containing {phrase}?")
    print(answer)
    assert phrase in answer.lower() and r["doc_id"] in answer
