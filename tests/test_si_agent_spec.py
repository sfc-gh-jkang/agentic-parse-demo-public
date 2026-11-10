"""Non-live checks: the two agents come from one template and the SI agent has no screen control."""
import importlib.util
import re
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
_spec = importlib.util.spec_from_file_location("gen_agents_sql", ROOT / "scripts" / "gen_agents_sql.py")
gen = importlib.util.module_from_spec(_spec)
_spec.loader.exec_module(gen)

TMPL = gen.TEMPLATE.read_text()
APP = gen.render(TMPL, "app")
SI = gen.render(TMPL, "si")
SCREEN_CLAIM = re.compile(r"now (open|showing|on screen)|I've (opened|highlighted|switched)|the (viewer|screen) (now )?shows", re.I)


def test_generated_sql_is_not_stale():
    assert gen.OUT.read_text() == gen.generate(), "run: python3 scripts/gen_agents_sql.py"


def test_app_agent_keeps_control_app():
    assert "name: control_app" in APP and "identifier: SNOWFLAKE_EXAMPLE.AGENTIC_PARSE_DEMO.CONTROL_APP" in APP


def test_si_agent_has_no_control_app_or_screen_language():
    assert "control_app" not in SI.lower()
    assert "[App state" not in SI and "highlight (target" not in SI
    assert not SCREEN_CLAIM.search(SI)
    assert "Snowflake Intelligence, with no screen" in " ".join(SI.split())


def test_si_agent_has_every_other_tool():
    def tools(s):
        return set(re.findall(r"^      name: (\w+)$", s, re.M))
    assert tools(APP) - tools(SI) == {"control_app"}
    assert tools(SI) == tools(APP) - {"control_app"}


def test_only_si_agent_is_registered():
    sql = gen.OUT.read_text()
    assert "ADD AGENT SNOWFLAKE_EXAMPLE.AGENTIC_PARSE_DEMO.AGENTIC_PARSE_DEMO_SI_AGENT" in sql
    assert "DROP AGENT SNOWFLAKE_EXAMPLE.AGENTIC_PARSE_DEMO.AGENTIC_PARSE_DEMO_AGENT;" in sql
    assert "ADD AGENT SNOWFLAKE_EXAMPLE.AGENTIC_PARSE_DEMO.AGENTIC_PARSE_DEMO_AGENT;" not in sql


def test_shared_text_is_identical():
    shared = gen.render(TMPL, "none").splitlines()
    app_lines, si_lines = APP.splitlines(), SI.splitlines()
    assert shared and all(l in app_lines and l in si_lines for l in shared)
