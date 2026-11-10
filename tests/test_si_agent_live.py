import json
import re

import pytest
import yaml
import demo_config  # noqa: E402  (scripts/ is on sys.path via conftest)

pytestmark = pytest.mark.live
S = demo_config.load()["FQ_SCHEMA"]  # the configured install, not the default
SI_AGENT = f"{S}.AGENTIC_PARSE_DEMO_SI_AGENT"
APP_AGENT = f"{S}.AGENTIC_PARSE_DEMO_AGENT"
SCREEN_CLAIM = re.compile(r"now (open|showing|on screen)|I've (opened|highlighted|switched)|the (viewer|screen) (now )?shows", re.I)
PROMPTS = [
    ("show me the stamped invoice total", "4,286.50"),
    ("open the claim packet page 2", None),
    ("switch to dark mode", None),
    ("give me a tour", None),
    ("what was Q3 revenue? show me the chart", "13.8"),
    ("where am I?", None),
]


def tool_names(cur, agent):
    cur.execute(f"DESCRIBE AGENT {agent}")
    row = cur.fetchone()
    cols = [d[0].lower() for d in cur.description]
    spec = yaml.safe_load(dict(zip(cols, row))["agent_spec"])
    return {t["tool_spec"]["name"] for t in spec["tools"]}


def test_si_agent_spec_tools(cur):
    si, app = tool_names(cur, SI_AGENT), tool_names(cur, APP_AGENT)
    assert "control_app" not in si and "control_app" in app
    assert app - si == {"control_app"}


def ask(cur, text):
    body = {"messages": [{"role": "user", "content": [{"type": "text", "text": text}]}]}
    cur.execute("SELECT SNOWFLAKE.CORTEX.DATA_AGENT_RUN(%s, %s)", (SI_AGENT, json.dumps(body)))
    content = json.loads(cur.fetchone()[0]).get("content", [])
    return "".join(c.get("text", "") for c in content if c.get("type") == "text"), \
        [c["tool_result"]["name"] for c in content if c.get("type") == "tool_result"]


@pytest.mark.parametrize("run", [1, 2])
@pytest.mark.parametrize("prompt,fact", PROMPTS)
def test_si_agent_never_claims_the_screen_moved(cur, prompt, fact, run):
    text, tools = ask(cur, prompt)
    first = re.split(r"(?<=[.!?])\s", text.strip(), 1)[0]
    print(f"\n[run {run}] {prompt!r} -> {first}")
    assert text.strip() and "control_app" not in tools
    assert not SCREEN_CLAIM.search(text), text
    if fact:
        assert fact in text, text
