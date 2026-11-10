import json

import pytest
import demo_config  # noqa: E402  (scripts/ is on sys.path via conftest)

pytestmark = pytest.mark.live
S = demo_config.load()["FQ_SCHEMA"]  # the configured install, not the default
AGENT = f"{S}.AGENTIC_PARSE_DEMO_AGENT"


def search(cur, service, query, columns, limit=5, flt=None):
    req = {"query": query, "columns": columns, "limit": limit}
    if flt:
        req["filter"] = flt
    cur.execute("SELECT SNOWFLAKE.CORTEX.SEARCH_PREVIEW(%s, %s)", (f"{S}.{service}", json.dumps(req)))
    return json.loads(cur.fetchone()[0])["results"]


def test_chunks_cover_pages_and_visuals_of_agentic_runs(cur):
    cur.execute(f"SELECT DISTINCT KIND, MODE FROM {S}.SEARCH_CHUNKS")
    assert set(cur.fetchall()) == {("page", "AGENTIC"), ("visual", "AGENTIC")}


def test_parsed_docs_search_finds_truth_value_with_doc_id(cur):
    truth = json.load(open("corpus/stamped_invoice.truth.json"))
    signer = next(v["context"]["caption_signer"] for v in truth["visuals"] if v.get("role") == "signature")
    hits = search(cur, "PARSED_DOCS_SEARCH", f"invoice signed by {signer}", ["CHUNK", "DOC_ID", "PAGE", "KIND"])
    match = [h for h in hits[:3] if signer in h["CHUNK"]]
    assert match and match[0]["DOC_ID"] == "stamped_invoice"


def test_parsed_docs_search_filters_visuals(cur):
    hits = search(cur, "PARSED_DOCS_SEARCH", "logo", ["DOC_ID", "KIND"], flt={"@eq": {"KIND": "visual"}})
    assert hits and all(h["KIND"] == "visual" for h in hits)


def test_design_docs_search_finds_parse_run_in_glossary(cur):
    hits = search(cur, "DESIGN_DOCS_SEARCH", "What is a Parse Run?", ["PATH", "SECTION", "CHUNK"])
    assert "GLOSSARY.md" in [h["PATH"] for h in hits[:3]]


def test_agent_exists_with_three_search_tools(cur):
    cur.execute(f"DESCRIBE AGENT {AGENT}")
    cols = [c[0].lower() for c in cur.description]
    spec = cur.fetchone()[cols.index("agent_spec")]
    for needed in ("PARSED_DOCS_SEARCH", "DESIGN_DOCS_SEARCH", "CKE_SNOWFLAKE_DOCS_SERVICE", "claude-sonnet-5-5"):
        assert needed in spec


def ask(cur, question):
    body = {"messages": [{"role": "user", "content": [{"type": "text", "text": question}]}]}
    cur.execute("SELECT SNOWFLAKE.CORTEX.DATA_AGENT_RUN(%s, %s)", (AGENT, json.dumps(body)))
    resp = json.loads(cur.fetchone()[0])
    return "".join(c.get("text", "") for c in resp.get("content", []) if c.get("type") == "text")


def test_agent_answers_corpus_question_with_citation(cur):
    answer = ask(cur, "What is the invoice number on the stamped invoice, and who is it billed to?")
    print(answer)
    assert "INV-2026-0917" in answer and "Contoso" in answer
    assert "stamped_invoice" in answer


def test_agent_says_agentic_mode_takes_no_prompt(cur):
    answer = ask(cur, "Can I give AI_PARSE_DOCUMENT AGENTIC mode a prompt or custom instructions?")
    print(answer)
    low = answer.lower()
    assert low.lstrip("*# ").startswith("no") or "does not accept" in low or "doesn't accept" in low or "no prompt" in low
