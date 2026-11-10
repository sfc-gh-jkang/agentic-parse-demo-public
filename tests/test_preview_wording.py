"""The release note says Public Preview; "open preview" in docs or the talk track would be repeated to customers."""
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent


def test_no_open_preview_wording():
    files = [ROOT / "README.md", *ROOT.glob("docs/**/*.md"), *ROOT.glob("web/components/**/*.tsx"), *ROOT.glob("sql/*.sql")]
    hits = [str(p.relative_to(ROOT)) for p in files if "open preview" in p.read_text().lower()]
    assert hits == []
