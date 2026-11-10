"""Missed facts are shown to the audience, so they must read as the Ground Truth was written."""
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / "scoring"))

from score import facts_for_visual  # noqa: E402


def test_text_facts_describe_as_written_not_normalized():
    vis = {"page": 0, "channel": "image", "date": "2026-09-18", "sheet": "A-101", "scale": "1:100"}
    shown = {f.describe() for f in facts_for_visual(vis)}
    assert {"2026-09-18", "A-101", "1:100"} <= shown
    assert not shown & {"2026 09 18", "a 101", "1 100"}


def test_display_string_does_not_change_matching_identity():
    vis = {"page": 0, "channel": "image", "sheet": "A-101"}
    (fact,) = [f for f in facts_for_visual(vis) if f.kind == "text"]
    assert fact.value == "a 101"


def test_relation_pairing_window_uses_normalized_tokens():
    """Regression: the display string must not widen or narrow relation matching."""
    from score import Fact, _paired_on_line, PAIR_SLACK_TOKENS  # noqa: E402

    date = Fact(0, "image", "text", "2026 09 18", shown="2026-09-18")
    who = Fact(0, "image", "text", "dana whitfield", shown="Dana Whitfield")
    rel = Fact(0, "image", "relation", (date, who))
    gap = " ".join(["x"] * PAIR_SLACK_TOKENS)
    assert _paired_on_line(rel, f"2026-09-18 {gap} Dana Whitfield")
    assert not _paired_on_line(rel, f"2026-09-18 {gap} x Dana Whitfield")
