"""Non-live checks on the agent instructions in sql/09b_agents.sql (app agent) (QA F6, F7)."""
from pathlib import Path

_SQL = Path(__file__).resolve().parent.parent / "sql"
_ALL = (_SQL / "09b_agents.sql").read_text()
_APP = _ALL.split("CREATE OR REPLACE AGENT AGENTIC_PARSE_DEMO_AGENT\n", 1)[1].split("CREATE OR REPLACE AGENT AGENTIC_PARSE_DEMO_SI_AGENT", 1)[0]
SPEC = _APP + (_SQL / "09_agent_tools.sql").read_text()


def test_reparse_needs_a_confirming_second_turn():
    assert "Re-parsing takes two turns" in SPEC
    assert "do NOT call\n    reparse" in SPEC


def test_agent_is_told_how_to_use_the_app_state_line():
    assert "[App state: ...]" in SPEC
    assert "Never\n    quote the bracketed line" in SPEC


def test_agent_drives_the_whole_app_and_never_refuses_covered_actions():
    assert "control_viewer" not in SPEC.replace("DROP PROCEDURE IF EXISTS CONTROL_VIEWER", "")
    assert "never say you cannot when\n    the action list covers it" in SPEC
    for action in ("go_home", "open_upload", "set_mode", "set_pair", "highlight", "tour"):
        assert action in SPEC
    assert "app-guide.md" in SPEC


def flat(s):
    return " ".join(s.split())


def test_agent_without_app_state_does_not_claim_to_move_a_screen():
    # Round 7: called outside the app (Snowflake Intelligence, REST), it said "the stamped invoice is now open".
    assert "If the newest message has no [App state: ...] line, you are not inside the demo app" in flat(SPEC)
    assert "never call control_app, never say the screen moved" in flat(SPEC)


def test_agent_never_wraps_parse_output_in_parse_json():
    # Round 7: it suggested TRY_PARSE_JSON(AI_PARSE_DOCUMENT(...)), which does not compile (OBJECT argument).
    assert "never wrap it in PARSE_JSON or TRY_PARSE_JSON" in flat(SPEC)


def test_agent_knows_the_demo_procedures():
    for name in ("PARSE_DOCUMENT", "COMPARE_MODES", "PARSE_COST", "APP_PARSE", "UPLOAD_DOCUMENT", "REPARSE",
                 "MODE_SCORES", "MEASURED_COST", "CONTROL_APP", "REFRESH_MODE_COMPARISONS"):
        assert name in SPEC


def test_follow_the_evidence_only_inside_the_app():
    assert "When the message has an [App state: ...] line, also call control_app after any answer that cites" in flat(SPEC)


def test_control_app_tool_description_requires_the_app_state_line():
    assert "Call it ONLY when the user's newest message starts with an [App state: ...] line" in flat(SPEC)


def test_agent_chains_dependent_tools_and_has_one_bounded_fallback():
    assert "Chaining:" in SPEC and "feed each result into the next call" in SPEC and "finish with control_app" in SPEC
    assert "parse_analytics to find the Document" in SPEC
    assert "Recovery:" in SPEC and "ONE bounded fallback" in SPEC and "Never more than one fallback" in SPEC
    assert "A tool ERROR is\n    different: report it and do not retry." in SPEC


def test_docs_separate_agentic_parse_mode_from_the_chat_agent():
    root = Path(__file__).resolve().parent.parent / "docs"
    for name in ("talk-track.md", "app-guide.md"):
        text = (root / name).read_text()
        assert "https://docs.snowflake.com/en/user-guide/snowflake-cortex/parse-document#agentic-mode" in text
        assert "Cortex Agent" in text and "action" in text


def test_reparse_states_cost_before_asking_to_confirm():
    flat = " ".join(SPEC.split())
    assert "measured AI credits per 1000 pages for that Mode from measured_cost" in flat
    assert "a calculation from measured usage, not a quote" in flat
    assert "reply yes to confirm or no to cancel" in flat


def test_chain_is_sequential_not_parallel():
    flat = " ".join(SPEC.split())
    assert "Make these calls one at a time, in this order" in flat and "never request two of them in the same step" in flat


def test_app_agent_opens_the_document_before_a_reparse_prompt():
    flat = " ".join(SPEC.split())
    assert "FIRST tool call for a re-parse request is control_app open_document" in flat


def test_whole_demo_tour_requests_start_the_built_in_tour_not_agent_written_steps():
    f = flat(SPEC)
    assert "control_app action start_tour with no other fields" in f
    assert "do not write tour steps yourself" in f
    assert "start_tour (the app's built-in tour" in f
    assert '"Explain this screen" or a tour of just this page or screen = action tour with 4 to 8 steps' in f
    assert "start_tour" not in flat(_ALL.split("CREATE OR REPLACE AGENT AGENTIC_PARSE_DEMO_SI_AGENT", 1)[1])
