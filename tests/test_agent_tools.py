import json

import pytest
import demo_config  # noqa: E402  (scripts/ is on sys.path via conftest)

pytestmark = pytest.mark.live
S = demo_config.load()["FQ_SCHEMA"]  # the configured install, not the default
AGENT = f"{S}.AGENTIC_PARSE_DEMO_AGENT"


def app(cur, **kw):
    args = ", ".join(f"{k.upper()} => %({k})s" for k in kw)
    cur.execute(f"CALL {S}.CONTROL_APP({args})", kw)
    out = json.loads(cur.fetchone()[0])
    out.pop("note", None)  # constant agent-facing note, checked once below
    return out


def test_control_app_tells_the_agent_nothing_moved_outside_the_app(cur):
    cur.execute(f"CALL {S}.CONTROL_APP(ACTION => 'go_home')")
    assert "[App state]" in json.loads(cur.fetchone()[0])["note"]


def test_control_app_echoes_combined_open_document(cur):
    assert app(cur, action="open_document", doc="claim_packet", page=2, view="compare", pair="ocr", zoom="150%") == {
        "action": "open_document", "doc": "claim_packet", "page": 2, "view": "compare", "pair": "OCR", "zoom": "150"}


def test_control_app_select_visual_fills_1_based_page(cur):
    cur.execute(f"SELECT DOC_ID, VISUAL_ID, PAGE_INDEX FROM {S}.PARSE_VISUALS WHERE DOC_ID = 'claim_packet' LIMIT 1")
    doc, vis, page = cur.fetchone()
    assert app(cur, action="select_visual", doc=doc, visual=vis) == {
        "action": "select_visual", "doc": doc, "page": page + 1, "visual": vis}


def test_control_app_tour_echoes_clean_steps(cur):
    steps = [{"target": "Score_Strip", "caption": " Relations 27/27 "}, {"target": "page_buttons", "caption": "p", "doc": "claim_packet", "page": 6},
             {"target": "upload_card", "caption": "u", "route": "home"}]
    assert app(cur, action="tour", steps=json.dumps(steps))["steps"] == [
        {"target": "score_strip", "caption": "Relations 27/27"},
        {"target": "page_buttons", "caption": "p", "doc": "claim_packet", "page": 6},
        {"target": "upload_card", "caption": "u", "route": "home"}]


@pytest.mark.parametrize("kw", [
    {"action": "go_home"}, {"action": "open_upload"}, {"action": "close_visual"}, {"action": "clear_highlight"},
    {"action": "set_page", "page": 1}, {"action": "set_view", "view": "one"}, {"action": "set_mode", "mode": "layout"},
    {"action": "set_pair", "pair": "LAYOUT"}, {"action": "zoom", "zoom": "fit_page"}, {"action": "zoom", "zoom": "25"},
    {"action": "zoom", "zoom": "300"}, {"action": "show_missed", "missed": "open"}, {"action": "show_missed", "missed": "close"},
    {"action": "set_compare_answers", "compare_answers": "off"}, {"action": "set_theme", "theme": "dark"},
    {"action": "scroll", "scroll": "parsed_text"}, {"action": "highlight", "target": "cached_label", "caption": "Cached = stored"},
    {"action": "set_theme", "theme": "light", "compare_answers": "on", "scroll": "top"},  # combo
])
def test_control_app_accepts_each_action(cur, kw):
    r = app(cur, **kw)
    assert "error" not in r and r["action"] == kw["action"]


@pytest.mark.parametrize("kw", [
    {"action": "launch"},                                             # unknown action
    {"action": "open_document"},                                      # missing doc
    {"action": "open_document", "doc": "no_such_doc"},
    {"action": "open_document", "doc": "claim_packet", "page": 7},    # 6 pages, 1-based
    {"action": "open_document", "doc": "claim_packet", "page": 0},
    {"action": "set_page"},
    {"action": "set_page", "page": -1},                             # (a NUMBER arg rounds 1.5; the app rejects non-integers)
    {"action": "go_home", "doc": "claim_packet"},
    {"action": "set_view", "view": "grid"},
    {"action": "set_mode", "mode": "FAST"},
    {"action": "set_pair", "pair": "AGENTIC"},
    {"action": "select_visual", "doc": "claim_packet"},
    {"action": "select_visual", "doc": "claim_packet", "visual": "img-99.jpeg"},
    {"action": "zoom", "zoom": "301"},
    {"action": "zoom", "zoom": "huge"},
    {"action": "show_missed", "missed": "maybe"},
    {"action": "set_compare_answers", "compare_answers": "yes"},
    {"action": "set_theme", "theme": "blue"},
    {"action": "scroll", "scroll": "left"},
    {"action": "highlight", "target": "score_strip"},
    {"action": "highlight", "target": "nope", "caption": "c"},
    {"action": "highlight", "target": "score_strip", "caption": "x" * 401},
    {"action": "tour"},
    {"action": "tour", "steps": "not json"},
    {"action": "tour", "steps": "{}"},
    {"action": "tour", "steps": json.dumps([{"target": "score_strip", "caption": "c"}] * 9)},
    {"action": "tour", "steps": json.dumps([{"target": "nope", "caption": "c"}])},
    {"action": "tour", "steps": json.dumps([{"target": "score_strip"}])},
    {"action": "tour", "steps": json.dumps([{"target": "score_strip", "caption": "c", "route": "settings"}])},
    {"action": "tour", "steps": json.dumps([{"target": "score_strip", "caption": "c", "doc": "no_such_doc"}])},
    {"action": "tour", "steps": json.dumps([{"target": "score_strip", "caption": "c", "doc": "claim_packet", "page": 9}])},
    {"action": "tour", "steps": json.dumps(["score_strip"])},
])
def test_control_app_rejects_bad_fields(cur, kw):
    assert set(app(cur, **kw)) == {"error"}


def test_control_viewer_is_gone(cur):
    cur.execute(f"SHOW PROCEDURES LIKE 'CONTROL_VIEWER' IN SCHEMA {S}")
    assert cur.fetchall() == []


def test_semantic_view_counts_documents(cur):
    # Uploads count too, so compare with the catalog rather than the 11-Document Corpus.
    cur.execute(f"SELECT COUNT(*) FROM {S}.DOCUMENT_CATALOG")
    expected = cur.fetchone()[0]
    cur.execute(f"SELECT * FROM SEMANTIC_VIEW({S}.PARSE_ANALYTICS METRICS documents.document_count)")
    assert cur.fetchone()[0] == expected >= 11


def test_agent_spec_lists_all_tools(cur):
    cur.execute(f"DESCRIBE AGENT {AGENT}")
    cols = [c[0].lower() for c in cur.description]
    spec = cur.fetchone()[cols.index("agent_spec")]
    for name in ("parsed_documents", "design_docs", "snowflake_docs", "control_app", "mode_scores",
                 "measured_cost", "reparse", "parse_analytics", "PARSE_ANALYTICS", "CONTROL_APP", "REPARSE"):
        assert name in spec


HOME_STATE = ("[App state: route home (Document list, upload card, measured cost). Documents listed: claim_packet, "
              "quarterly_report, stamped_invoice. Compare answers across modes: on. Theme: light. Spotlight: none.]")


def run(cur, question):
    body = {"messages": [{"role": "user", "content": [{"type": "text", "text": question}]}]}
    cur.execute("SELECT SNOWFLAKE.CORTEX.DATA_AGENT_RUN(%s, %s)", (AGENT, json.dumps(body)))
    content = json.loads(cur.fetchone()[0]).get("content", [])
    text = "".join(c.get("text", "") for c in content if c.get("type") == "text")
    results = [c["tool_result"] for c in content if c.get("type") == "tool_result"]
    print(text, [r["name"] for r in results])
    assert "reparse" not in [r["name"] for r in results]
    return text, results


def result_json(r):
    out = json.loads(r["content"][0]["json"]["result"])
    out.pop("note", None)
    return out


def test_agent_drives_viewer(cur):
    text, results = run(cur, f"{HOME_STATE}\n\nshow me page 2 of claim_packet in compare view against OCR")
    actions = [result_json(r) for r in results if r["name"] == "control_app"]
    assert any(a.get("doc") == "claim_packet" and a.get("page") == 2 and a.get("pair") == "OCR" for a in actions)


def test_agent_goes_home_instead_of_refusing(cur):
    # The app always sends an [App state] line; without it the agent must not drive a screen (round 7).
    text, results = run(cur, f"{HOME_STATE}\n\ntake me to the homepage")
    assert {"action": "go_home"} in [result_json(r) for r in results if r["name"] == "control_app" and r["status"] == "success"]
    assert "can't" not in text.lower() and "cannot" not in text.lower()


def test_agent_explains_best_mode_on_relations(cur):
    text, results = run(cur, "which mode scored best on relations?")
    assert {"mode_scores", "parse_analytics"} & {r["name"] for r in results}
    assert "AGENTIC" in text.upper()


def test_agent_reports_measured_cost(cur):
    text, results = run(cur, "What did AGENTIC mode measure per 1000 pages, in AI credits?")
    assert {"measured_cost", "parse_analytics"} & {r["name"] for r in results}
    assert "8.18" in text
