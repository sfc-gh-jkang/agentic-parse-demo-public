"""Upload seam: UPLOAD_DOCUMENT validates and stores; APP_PARSE tags app runs.

Live (LIVE=1). Billing: one AGENTIC parse of the 1-page receipt JPG (1 page). The 21-page and
oversize inputs are only uploaded-and-rejected, never parsed. Everything created is removed.
"""
import base64
import hashlib
import io
import json
import os
from pathlib import Path

import pytest
import demo_config  # noqa: E402  (scripts/ is on sys.path via conftest)

pytestmark = pytest.mark.live
CORPUS = Path(__file__).resolve().parent.parent / "corpus"
STAGE = f"@{demo_config.load()['FQ_SCHEMA']}.DOCS"  # the configured install, not the default
RECEIPT = (CORPUS / "receipt_photo.jpg").read_bytes()


def _upload(cur, name, data):
    b64 = base64.b64encode(data).decode("ascii")
    return json.loads(cur.execute("CALL UPLOAD_DOCUMENT(%s, %s)", (name, b64)).fetchone()[0])


def _pdf(pages):
    from reportlab.pdfgen import canvas

    buf = io.BytesIO()
    c = canvas.Canvas(buf)
    for i in range(pages):
        c.drawString(72, 720, f"page {i + 1}")
        c.showPage()
    c.save()
    return buf.getvalue()


def _purge(cur, doc_id):
    cur.execute(f"REMOVE {STAGE}/uploads/{doc_id}")
    for t in ("MODE_COMPARISONS", "PARSE_RUNS", "DOCUMENT_FILES", "DOCUMENTS"):
        cur.execute(f"DELETE FROM {t} WHERE DOC_ID = %s", (doc_id,))


@pytest.fixture
def created(cur):
    ids = []
    yield ids
    for d in ids:
        _purge(cur, d)


def _ok(cur, created, name, data):
    r = _upload(cur, name, data)
    if r.get("doc_id"):
        created.append(r["doc_id"])
    return r


def test_upload_receipt_stores_document_and_bytes(cur, created):
    r = _ok(cur, created, "My Receipt.JPG", RECEIPT)
    assert r["ok"] is True and r["pages"] == 1
    assert r["doc_id"].startswith("up_my_receipt_")
    cur.execute("SELECT SOURCE, FILE_TYPE, GROUND_TRUTH IS NULL FROM DOCUMENTS WHERE DOC_ID = %s", (r["doc_id"],))
    assert cur.fetchone() == ("upload", "jpg", True)
    cur.execute("SELECT BASE64_ENCODE(CONTENT), BYTES, SHA256, CONTENT_TYPE FROM DOCUMENT_FILES WHERE DOC_ID = %s",
                (r["doc_id"],))
    b64, size, sha, ctype = cur.fetchone()
    assert base64.b64decode(b64.replace("\n", "")) == RECEIPT
    assert (size, sha, ctype) == (len(RECEIPT), hashlib.sha256(RECEIPT).hexdigest(), "image/jpeg")
    cur.execute(f"SELECT COUNT(*) FROM DIRECTORY({STAGE}) WHERE RELATIVE_PATH LIKE %s", (f"uploads/{r['doc_id']}.%",))
    assert cur.fetchone()[0] == 1


@pytest.mark.parametrize("name", ["evil.exe", "notes.txt", "noext"])
def test_rejects_unsupported_types(cur, created, name):
    r = _ok(cur, created, name, b"hello world")
    assert r["ok"] is False and "type" in r["error"].lower()


def test_rejects_magic_byte_mismatch(cur, created):
    r = _ok(cur, created, "fake.png", _pdf(1))
    assert r["ok"] is False and "content" in r["error"].lower()


def test_rejects_empty_file_as_empty(cur, created):
    r = _ok(cur, created, "up_qa_empty.pdf", b"")
    assert r["ok"] is False and r["error"] == "The file is empty."


@pytest.mark.parametrize("name,data", [
    ("corrupt.png", b"\x89PNG\r\n\x1a\n" + b"\x00" * 40),
    ("corrupt.jpg", b"\xff\xd8\xff\xe0" + b"\x00" * 40),
    ("corrupt.tif", b"II*\x00" + b"\x00" * 40),
    ("truncated.jpg", RECEIPT[: len(RECEIPT) // 2]),
])
def test_rejects_corrupt_images_with_valid_magic(cur, created, name, data):
    r = _ok(cur, created, name, data)
    assert r["ok"] is False and "could not be opened" in r["error"]
    assert not r.get("doc_id")


def test_rejects_more_than_20_pages(cur, created):
    r = _ok(cur, created, "long.pdf", _pdf(21))
    assert r["ok"] is False and "20 pages" in r["error"]
    assert not r.get("doc_id")


def test_accepts_20_page_pdf_boundary_is_not_needed_but_1_page_pdf_counts(cur, created):
    r = _ok(cur, created, "one.pdf", _pdf(1))
    assert r["ok"] is True and r["pages"] == 1


def test_rejects_over_10mb_before_writing(cur, created):
    before = cur.execute("SELECT COUNT(*) FROM DOCUMENTS").fetchone()[0]
    r = _ok(cur, created, "big.jpg", b"\xff\xd8\xff" + os.urandom(10 * 1024 * 1024))
    assert r["ok"] is False and "10 MB" in r["error"]
    assert cur.execute("SELECT COUNT(*) FROM DOCUMENTS").fetchone()[0] == before


def test_path_traversal_filename_is_sanitized(cur, created):
    r = _ok(cur, created, "../../x.pdf", _pdf(1))
    assert r["ok"] is True
    assert r["doc_id"].startswith("up_") and "/" not in r["doc_id"] and ".." not in r["doc_id"]
    cur.execute("SELECT STAGE_PATH FROM DOCUMENTS WHERE DOC_ID = %s", (r["doc_id"],))
    assert cur.fetchone()[0] == f"uploads/{r['doc_id']}.pdf"


def test_app_parse_runs_agentic_on_upload_and_tags_run_as_app(cur, created):
    r = _ok(cur, created, "receipt.jpg", RECEIPT)
    p = json.loads(cur.execute("CALL APP_PARSE(%s, 'AGENTIC')", (r["doc_id"],)).fetchone()[0])
    assert p["ok"] is True and p["run_id"] and p["error"] is None and p["pages"] == 1
    cur.execute("SELECT TRIGGER_SOURCE, MODE, PAGE_COUNT FROM PARSE_RUNS WHERE RUN_ID = %s", (p["run_id"],))
    assert cur.fetchone() == ("app", "AGENTIC", 1)
    cur.execute("SELECT COUNT(*) FROM MODE_COMPARISONS WHERE DOC_ID = %s", (r["doc_id"],))
    assert cur.fetchone()[0] == 0  # no Ground Truth, nothing to score


def test_app_parse_rejects_bad_mode_and_unknown_doc(cur):
    assert json.loads(cur.execute("CALL APP_PARSE('receipt_photo', 'BOGUS')").fetchone()[0])["ok"] is False
    assert json.loads(cur.execute("CALL APP_PARSE('no_such_doc', 'OCR')").fetchone()[0])["ok"] is False


def _big_pdf():
    """One-page PDF carrying a 2100x1150 noise image: about 9.06 MB (measured), just under the limit."""
    import os

    from PIL import Image
    from reportlab.lib.utils import ImageReader
    from reportlab.pdfgen import canvas

    w, h = 2100, 1150
    img = Image.frombytes("RGB", (w, h), os.urandom(w * h * 3))
    png = io.BytesIO()
    img.save(png, "PNG")
    png.seek(0)
    buf = io.BytesIO()
    c = canvas.Canvas(buf)
    c.drawImage(ImageReader(png), 20, 200, 560, 300)
    c.showPage()
    c.save()
    return buf.getvalue()


def test_upload_near_the_10mb_limit_stores_every_byte(cur, created):
    # Regression: DOCUMENT_FILES.CONTENT used the 8 MB BINARY default on this account and
    # a 9 MB upload failed with "Binary value ... is too long and would be truncated".
    data = _big_pdf()
    assert 8.3e6 < len(data) < 10 * 1024 * 1024, len(data)
    r = _ok(cur, created, "big_scan.pdf", data)
    assert r["ok"], r
    size, sha = cur.execute("SELECT BYTES, SHA256 FROM DOCUMENT_FILES WHERE DOC_ID = %s", (r["doc_id"],)).fetchone()
    assert (size, sha) == (len(data), __import__("hashlib").sha256(data).hexdigest())


def test_docx_upload_stores_with_unknown_page_count(cur, created):
    """DOCX has no page count; PAGES must be stored as NULL, not the string 'None' (QA F1)."""
    import zipfile

    buf = io.BytesIO()
    with zipfile.ZipFile(buf, "w") as z:
        z.writestr("word/document.xml", "<w:document/>")
    data = buf.getvalue()
    r = _ok(cur, created, "memo.docx", data)
    assert r["ok"], r
    assert r["pages"] is None
    row = cur.execute("SELECT FILE_TYPE, PAGES FROM DOCUMENTS WHERE DOC_ID = %s", (r["doc_id"],)).fetchone()
    assert row == ("docx", None)
