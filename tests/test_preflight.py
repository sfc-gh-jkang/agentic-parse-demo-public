"""scripts/preflight.py pure helpers (non-live): prompt stays in sync with web/lib/ask.ts, verdicts."""
import re
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(ROOT / "scripts"))
import preflight  # noqa: E402


def test_prompt_matches_app_prompt_first_line():
    ts = (ROOT / "web" / "lib" / "ask.ts").read_text()
    first = re.search(r"return `(You answer[^\n]*)", ts).group(1).replace("${NOT_FOUND}", preflight.NOT_FOUND)
    assert preflight.build_prompt("q", "OCR", "ctx").splitlines()[0] == first


def test_verdicts():
    assert preflight.verdict({"AGENTIC": True, "LAYOUT": False, "OCR": True}) == "AGENTIC wins"
    assert preflight.verdict({"AGENTIC": True, "LAYOUT": True, "OCR": True}) == "tie (all answer)"
    assert preflight.verdict({"AGENTIC": False, "LAYOUT": True, "OCR": False}) == "AGENTIC misses"
    assert preflight.verdict({"AGENTIC": False, "LAYOUT": False, "OCR": False}) == "none answer"


def test_parse_answer_not_found():
    assert preflight.parse_answer('{"found": false, "answer": "x"}') == (False, preflight.NOT_FOUND)
    assert preflight.parse_answer('{"found": true, "answer": "29.45 total"}') == (True, "29.45 total")
    # As returned by AI_COMPLETE through the connector: a JSON-quoted string.
    assert preflight.parse_answer('"{\\"found\\": false, \\"answer\\": \\"Not in this parse\\", \\"pages\\": []}"') == (False, preflight.NOT_FOUND)


def test_ask_model_read_from_app():
    assert preflight.ask_model() == "claude-sonnet-5-5"


def test_negative_answer_counts_as_not_found():
    raw = '{"found": true, "answer": "No table with a title or column headers appears in the parse."}'
    assert preflight.parse_answer(raw) == (False, preflight.NOT_FOUND)
    assert preflight.parse_answer('{"found": true, "answer": "Nordic Rail invoice total 12.00"}')[0] is True


def test_missing_file_exits_cleanly_before_connecting(monkeypatch, capsys):
    import pytest
    monkeypatch.setattr(sys, "argv", ["preflight.py", "/nonexistent/qa.docx"])
    monkeypatch.setitem(sys.modules, "snowflake.connector", None)  # importing it would fail the test
    with pytest.raises(SystemExit) as e:
        preflight.main()
    assert e.value.code == 2
    assert "not a file: /nonexistent/qa.docx" in capsys.readouterr().err
