import json

from scripts.eval_agent import agent_spec, check, decide, load_questions, parse_response, prompt


def raw(text, *results):
    content = [{"type": "text", "text": text}] + [{"type": "tool_result", "tool_result": r} for r in results]
    return json.dumps({"content": content})


def viewer(result):
    return {"name": "control_app", "status": "success", "content": [{"json": {"result": json.dumps(result)}}]}


def test_parse_response_reads_text_tools_and_actions():
    t, tools, acts = parse_response(raw("hi", viewer({"action": "open_document", "doc": "d"}), {"name": "design_docs"}))
    assert (t, tools, acts) == ("hi", ["control_app", "design_docs"], [{"action": "open_document", "doc": "d"}])


def test_parse_response_ignores_failed_viewer_result():
    bad = dict(viewer({"action": "open_document"}), status="error")
    assert parse_response(raw("x", bad))[2] == []


Q = {"id": "q", "require_all": ["8.18"], "require_regex": [r"\bno\b"], "forbid_regex": [r"¥\s?\d"],
     "cite_any": ["GLOSSARY"], "tools_any": ["measured_cost", "parse_analytics"],
     "app_action": {"action": "open_document", "page": 1}}


def test_check_all_pass():
    c = check(Q, "No. 8.18 credits (glossary.md)", ["measured_cost", "control_app"],
              [{"action": "open_document", "page": 1, "doc": "x"}])
    assert all(c.values()), c


def test_check_each_failure_is_caught():
    c = check(Q, "Yes ¥5000, 8.1", ["reparse"], [{"action": "open_document", "page": 2}])
    assert [k for k, v in c.items() if v] == []


def test_check_app_page_is_exact_not_substring():
    assert not check({"app_action": {"page": 1}}, "", [], [{"page": 10}])["app action"]


def test_decide_keeps_sonnet_on_tie_and_one_more():
    s = [{"id": str(i), "honesty": False, "passed": i > 0} for i in range(3)]
    o = [{"id": str(i), "honesty": False, "passed": True} for i in range(3)]
    assert decide({"claude-sonnet-5-5": s, "claude-opus-5-5": o})[0] == "claude-sonnet-5-5"


def test_decide_opus_on_two_more():
    s = [{"id": str(i), "honesty": False, "passed": i > 1} for i in range(3)]
    o = [{"id": str(i), "honesty": False, "passed": True} for i in range(3)]
    assert decide({"claude-sonnet-5-5": s, "claude-opus-5-5": o})[0] == "claude-opus-5-5"


def test_decide_opus_on_honesty_gap():
    s = [{"id": "a", "honesty": True, "passed": False}, {"id": "b", "honesty": False, "passed": True}]
    o = [{"id": "a", "honesty": True, "passed": True}, {"id": "b", "honesty": False, "passed": False}]
    assert decide({"claude-sonnet-5-5": s, "claude-opus-5-5": o})[0] == "claude-opus-5-5"


def test_agent_spec_changes_only_model():
    base = agent_spec("claude-sonnet-5-5")
    opus = agent_spec("claude-opus-5-5")
    assert base.replace("claude-sonnet-5-5", "claude-opus-5-5", 1) == opus
    assert "tools:" in opus and "reparse" in opus


def test_questions_file_is_well_formed():
    qs = load_questions()
    assert len(qs) >= 12 and len({q["id"] for q in qs}) == len(qs)
    keys = {"require_all", "require_regex", "forbid_regex", "cite_any", "tools_any", "app_action", "tour_steps"}
    assert all(keys & set(q) for q in qs)
    assert any(q.get("honesty") for q in qs)
    assert all("reparse" not in q.get("tools_any", []) for q in qs)


def test_tour_steps_check_counts_steps():
    tour = {"action": "tour", "steps": [{"target": "score_strip", "caption": "c"}] * 5}
    assert check({"tour_steps": [4, 8]}, "", [], [tour])["tour 4-8 steps"]
    assert not check({"tour_steps": [4, 8]}, "", [], [dict(tour, steps=tour["steps"][:2])])["tour 4-8 steps"]


def test_prompt_prepends_app_state_only_when_set():
    assert prompt({"question": "where am I?"}) == "where am I?"
    assert prompt({"question": "where am I?", "app_state": "[App state: x]"}) == "[App state: x]\n\nwhere am I?"


def test_control_questions_cover_every_requested_control():
    ids = {q["id"] for q in load_questions()}
    for i in ("app_go_home", "app_open_upload", "app_layout_tab", "app_dark_mode", "app_tour", "app_explain_relations",
              "app_what_missed", "app_where_am_i"):
        assert i in ids


def test_forbid_tools_fails_when_the_tool_was_called():
    q = {"id": "x", "forbid_tools": ["control_app"]}
    assert check(q, "ok", ["control_app"], [])["no tool control_app"] is False
    assert check(q, "ok", ["design_docs"], [])["no tool control_app"] is True


def test_round7_questions_present():
    ids = {q["id"] for q in load_questions()}
    assert {"no_app_state_control", "sql_parse_object", "procedures_list"} <= ids


from scripts.eval_agent import parse_calls, redundant_calls, tool_order_score  # noqa: E402


def test_tool_order_score_is_ordered_subsequence_fraction():
    want = ["parse_analytics", "mode_scores", "parsed_documents", "control_app"]
    assert tool_order_score(want, ["parse_analytics", "mode_scores", "parsed_documents", "control_app"]) == 1.0
    assert tool_order_score(want, ["parse_analytics", "design_docs", "mode_scores", "parsed_documents", "control_app"]) == 1.0
    assert tool_order_score(want, ["control_app", "parsed_documents", "mode_scores", "parse_analytics"]) == 0.25
    assert tool_order_score(want, ["parse_analytics", "mode_scores"]) == 0.5
    assert tool_order_score(want, []) == 0.0
    assert tool_order_score([], ["x"]) == 1.0


def test_redundant_calls_counts_exact_repeats_only():
    calls = [("parsed_documents", {"query": "a"}), ("parsed_documents", {"query": "b"}), ("parsed_documents", {"query": "a"})]
    assert redundant_calls(calls) == 1
    assert redundant_calls([("x", {}), ("y", {})]) == 0


def test_parse_calls_reads_tool_use_items_in_order():
    r = json.dumps({"content": [
        {"type": "tool_use", "tool_use": {"name": "mode_scores", "input": {"doc": "d"}}},
        {"type": "tool_result", "tool_result": {"name": "mode_scores"}},
        {"type": "tool_use", "tool_use": {"name": "control_app", "input": {"action": "highlight"}}},
    ]})
    assert parse_calls(r) == [("mode_scores", {"doc": "d"}), ("control_app", {"action": "highlight"})]


def test_check_scores_order_redundancy_and_call_budget():
    q = {"id": "q", "tool_order": ["a", "b"], "max_calls": 3}
    ok = check(q, "t", ["a", "b"], [], calls=[("a", {}), ("b", {})])
    assert all(ok.values()), ok
    bad = check(q, "t", ["b", "a", "a", "a"], [], calls=[("b", {}), ("a", {}), ("a", {}), ("a", {})])
    assert bad["tool order a>b"] is False
    assert bad["no redundant calls"] is False
    assert bad["at most 3 calls"] is False


def test_check_without_calls_skips_redundancy():
    assert "no redundant calls" not in check({"id": "q"}, "t", ["a"], [])


def test_questions_yaml_declares_headline_and_recovery():
    qs = {q["id"]: q for q in load_questions()}
    assert qs["multi_step_headline"]["tool_order"] == ["parse_analytics", "mode_scores", "parsed_documents", "control_app"]
    assert qs["recovery_fallback"]["tool_order"][0] == "parsed_documents"
    assert len(qs["recovery_fallback"]["tool_order"]) >= 2


def test_summary_is_compact_and_honest():
    from scripts.eval_agent import summary
    row = lambda i, p, o=None: {"id": i, "category": "c", "passed": p, "secs": 2.0, "tools": ["a", "b"], "order": o, "redundant": 0}
    res = {"claude-sonnet-5-5": [row("q1", True), row("multi", True, 1.0)], "claude-opus-5-5": [row("q1", True), row("multi", False, 0.75)]}
    qs = [{"id": "q1", "category": "c"}, {"id": "multi", "category": "agency", "tool_order": ["a", "b"]}]
    s = summary(res, "claude-sonnet-5-5", "why", qs, "2026-11-02")
    assert s["date"] == "2026-11-02" and s["winner"] == "claude-sonnet-5-5"
    assert s["models"] == [{"model": "claude-sonnet-5-5", "passed": 2, "total": 2, "median_secs": 2.0},
                           {"model": "claude-opus-5-5", "passed": 1, "total": 2, "median_secs": 2.0}]
    assert s["trajectory"][0] == {"model": "claude-sonnet-5-5", "id": "multi", "expected": ["a", "b"], "order": 1.0, "calls": 2, "redundant": 0}
    assert len(s["trajectory"]) == 2
