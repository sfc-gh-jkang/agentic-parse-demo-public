"""UPLOAD_DOCUMENT's Python body, run offline against a fake session (no Snowflake, nothing billed).

The handler is pulled out of sql/07_upload.sql and exec'd, so these tests check the code that deploys.
"""
import base64
import io
import json
import re
import zipfile
from pathlib import Path

SQL = (Path(__file__).resolve().parent.parent / "sql" / "07_upload.sql").read_text()


def _handler():
    body = re.search(r"PROCEDURE UPLOAD_DOCUMENT\(.*?\nAS\n\$\$\n(.*?)\n\$\$;", SQL, re.S).group(1)
    ns: dict = {}
    exec(body, ns)  # noqa: S102 - our own checked-in source
    return ns


class _Rows:
    def collect(self):
        return []


class _FailingSession:
    """INSERT raises an error that names internal objects, as Snowflake does."""

    def sql(self, text, params=None):
        if text.startswith("INSERT"):
            raise RuntimeError("SQL compilation error: Object 'SNOWFLAKE_EXAMPLE.AGENTIC_PARSE_DEMO.DOCUMENTS' does not exist")
        return _Rows()


def _docx(page_breaks: int, app_pages: int | None = None) -> bytes:
    brk = '<w:p><w:r><w:br w:type="page"/></w:r></w:p>' * page_breaks
    buf = io.BytesIO()
    with zipfile.ZipFile(buf, "w") as z:
        z.writestr("word/document.xml", f'<w:document xmlns:w="w"><w:body>{brk}</w:body></w:document>')
        if app_pages is not None:
            z.writestr("docProps/app.xml", f"<Properties><Pages>{app_pages}</Pages></Properties>")
    return buf.getvalue()


def test_docx_with_more_than_20_pages_by_page_breaks_is_rejected():
    ns = _handler()
    assert ns["_pages"]("docx", _docx(25)) == 26


def test_docx_page_count_prefers_app_xml_when_larger():
    assert _handler()["_pages"]("docx", _docx(0, app_pages=30)) == 30


def test_short_docx_without_evidence_stays_unknown():
    """One section and no Pages property: the count is unknown, not 1 (README: DOCX PAGES may be NULL)."""
    assert _handler()["_pages"]("docx", _docx(0)) is None


def test_upload_rejects_long_docx():
    ns = _handler()
    out = json.loads(ns["upload"](None, "long.docx", base64.b64encode(_docx(40)).decode()))
    assert out == {"ok": False, "error": "Document has 41 pages; the limit is 20 pages."}


def test_store_failure_does_not_return_internal_error_text():
    ns = _handler()
    out = json.loads(ns["upload"](_FailingSession(), "memo.docx", base64.b64encode(_docx(1)).decode()))
    assert out["ok"] is False
    assert "SNOWFLAKE_EXAMPLE" not in out["error"] and "compilation" not in out["error"].lower()


class _OkSession:
    def __init__(self):
        self.binds = []
        self.file = self

    def sql(self, text, params=None):
        self.binds.append((text, params))
        return _Rows()

    def put_stream(self, *a, **k):
        return None


def test_accepted_docx_still_stores_null_pages():
    s = _OkSession()
    out = json.loads(_handler()["upload"](s, "memo.docx", base64.b64encode(_docx(5)).decode()))
    assert out["ok"] is True and out["pages"] is None
    insert = next(p for t, p in s.binds if t.startswith("INSERT INTO DOCUMENTS"))
    assert insert[-1] == -1  # bound as -1, stored as NULL by NULLIF
