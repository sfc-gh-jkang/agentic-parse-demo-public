"""The presenter chips, the talk track and the eval set must say the same words (storyline order)."""
import re
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
PANEL = (ROOT / "web" / "components" / "agent" / "chat-panel.tsx").read_text()
TALK = (ROOT / "docs" / "talk-track.md").read_text()
EVAL = (ROOT / "eval" / "questions.yaml").read_text()


def chip(name):
    m = re.search(rf'export const {name} =\s*"((?:[^"\\]|\\.)*)"', PANEL)
    assert m, name
    return m.group(1)


ORDER = ["PAYOFF_QUESTION", "VALUE_QUESTION", "REVIEW_QUESTION", "HEADLINE_QUESTION", "TRAP_QUESTION", "REPARSE_QUESTION", "DATA_QUESTION"]


def test_chips_are_in_storyline_order():
    assert re.search(r"PRESENTER_QUESTIONS = \[PAYOFF_QUESTION, VALUE_QUESTION, REVIEW_QUESTION, HEADLINE_QUESTION, TRAP_QUESTION, REPARSE_QUESTION, DATA_QUESTION\]", PANEL)


def test_each_chip_is_verbatim_in_talk_track_and_eval():
    for n in ORDER:
        q = chip(n)
        assert q in TALK, f"{n} missing from docs/talk-track.md"
        assert re.search(rf"^  question: {re.escape(q)}\s*$", EVAL, re.M), f"{n} missing from eval/questions.yaml"


def test_talk_track_beats_run_in_storyline_order():
    pos = [TALK.index("\n## " + h) for h in ("Opening payoff", "Value beat", "Beat 1", "Beat 2", "Beat 3", "Beat 4", "Beat 5", "Data beat", "Close")]
    assert pos == sorted(pos)
    qs = [TALK.index(chip(n)) for n in ORDER]
    assert qs == sorted(qs)


def test_floor_plan_panel_p1_appears_once_in_chat_samples():
    ask = (ROOT / "web" / "lib" / "ask.ts").read_text()
    assert "Panel P1" not in PANEL and ask.count("Panel P1") == 1
