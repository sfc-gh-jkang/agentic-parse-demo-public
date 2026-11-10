"""Non-live: the scratch CONTROL_APP copy and the temp-agent override never touch the live names."""
import os
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent / "scripts"))
import eval_agent  # noqa: E402
import scratch_control_app as sc  # noqa: E402

ROOT = Path(__file__).resolve().parent.parent


def test_scratch_ddl_renames_only_the_procedure_and_keeps_start_tour():
    ddl = sc.scratch_ddl((ROOT / "sql" / "09_agent_tools.sql").read_text())
    assert ddl.startswith("CREATE OR REPLACE PROCEDURE CONTROL_APP_T21(")
    assert "'start_tour'" in ddl and "'presenter_questions'" in ddl
    assert "CONTROL_APP(" not in ddl
    assert ddl.rstrip().endswith("$$")


def test_agent_spec_points_at_the_scratch_tool_only_when_asked():
    sql = (ROOT / "sql" / "09b_agents.sql").read_text()
    os.environ.pop("CONTROL_APP_NAME", None)
    os.environ.pop("SCRATCH_SUFFIX", None)
    assert "AGENTIC_PARSE_DEMO.CONTROL_APP\n" in eval_agent.agent_spec("claude-sonnet-5-5", sql)
    os.environ["CONTROL_APP_NAME"] = "CONTROL_APP_T21"
    try:
        spec = eval_agent.agent_spec("claude-sonnet-5-5", sql)
    finally:
        del os.environ["CONTROL_APP_NAME"]
    assert "AGENTIC_PARSE_DEMO.CONTROL_APP_T21\n" in spec and "AGENTIC_PARSE_DEMO.CONTROL_APP\n" not in spec


def test_scratch_suffix_retargets_all_three_new_tools_and_nothing_else():
    sql = (ROOT / "sql" / "09b_agents.sql").read_text()
    os.environ.pop("CONTROL_APP_NAME", None)
    os.environ["SCRATCH_SUFFIX"] = "_T21"
    try:
        spec = eval_agent.agent_spec("claude-sonnet-5-5", sql)
    finally:
        del os.environ["SCRATCH_SUFFIX"]
    assert "AGENTIC_PARSE_DEMO.CONTROL_APP_T21\n" in spec and "AGENTIC_PARSE_DEMO.VALUE_STORY_T21\n" in spec
    assert "AGENTIC_PARSE_DEMO.PARSE_ANALYTICS_T21\n" in spec
    assert "MODE_SCORES_T21" not in spec and "MEASURED_COST_T21" not in spec and "PARSED_DOCS_SEARCH_T21" not in spec
