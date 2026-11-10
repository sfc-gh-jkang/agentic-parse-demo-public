"""T24 portability (non-live): agents without the Snowflake docs tool, preflight messages, PAT ingress, no-connection message."""
import importlib.util
import io
import json
import re
import sys
from pathlib import Path
from unittest import mock

import pytest
import yaml

ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(ROOT / "scripts"))
import app_token  # noqa: E402
import check_models  # noqa: E402
import demo_config  # noqa: E402
import eval_agent  # noqa: E402
import gen_agents_sql as gen  # noqa: E402
import setup_checks  # noqa: E402

TMPL = gen.TEMPLATE.read_text().replace("{{SNIPPETS}}", gen.snippet_block())


def spec(variant, docs):
    return yaml.safe_load(gen.render(TMPL, variant, docs))


def tools(y):
    return [t["tool_spec"]["name"] for t in y["tools"]]


# --- agent spec rendering ---------------------------------------------------------------------------------------
def test_default_output_is_byte_identical_to_committed_sql():
    assert gen.generate() == gen.OUT.read_text() == gen.generate(docs=True)
    assert "snowflake_docs" in gen.OUT.read_text()


@pytest.mark.parametrize("variant", ["app", "si"])
def test_spec_with_docs_is_valid_and_complete(variant):
    y = spec(variant, True)
    assert "snowflake_docs" in tools(y) and "snowflake_docs" in y["tool_resources"]
    assert "Use snowflake_docs for Snowflake product" in " ".join(y["instructions"]["orchestration"].split())


@pytest.mark.parametrize("variant", ["app", "si"])
def test_spec_without_docs_has_no_dangling_references(variant):
    text = gen.render(TMPL, variant, False)
    y = yaml.safe_load(text)
    assert "snowflake_docs" not in text and "SNOWFLAKE_DOCUMENTATION" not in text and "CKE_SNOWFLAKE" not in text
    assert tools(y) == [t for t in tools(spec(variant, True)) if t != "snowflake_docs"]
    assert set(y["tool_resources"]) == set(tools(y))  # every tool has a resource and vice versa
    assert "Call more than one tool when a question spans them." in " ".join(y["instructions"]["orchestration"].split())
    assert "snowflake documentation" not in text.lower()


def test_generated_no_docs_sql_and_snowsight_variants_are_current_and_clean():
    for f, text in gen.variants().items():
        assert f.read_text() == text, f"run: python3 scripts/gen_agents_sql.py ({f})"
    setup = (ROOT / "snowsight/no_docs/01_setup.sql").read_text()
    assert "SNOWFLAKE_DOCUMENTATION" not in setup and "GRANT USAGE ON DATABASE SNOWFLAKE_EXAMPLE" in setup
    assert "snowflake_docs" not in (ROOT / "snowsight/no_docs/09b_agents.sql").read_text()
    inst = (ROOT / "snowsight/install_no_docs.sql").read_text()
    assert "snowsight/no_docs/01_setup.sql" in inst and "snowsight/no_docs/09b_agents.sql" in inst
    assert "/sql/01_setup.sql" not in inst and "/sql/09b_agents.sql" not in inst


def test_render_tree_respects_docs_search(tmp_path):
    base = demo_config.load(environ={})
    off = dict(base, DOCS_SEARCH="0", DEMO_SCHEMA="OTHER_SCHEMA")
    out = demo_config.render_tree(off, out=tmp_path / "b")
    sql = (out / "sql" / "09b_agents.sql").read_text()
    assert "snowflake_docs" not in sql and "OTHER_SCHEMA" in sql
    assert "SNOWFLAKE_DOCUMENTATION" not in (out / "sql" / "01_setup.sql").read_text()
    on = demo_config.render_tree(dict(base, DOCS_SEARCH="auto"), out=tmp_path / "c")
    assert "snowflake_docs" in (on / "sql" / "09b_agents.sql").read_text()
    assert "SNOWFLAKE_DOCUMENTATION" in (on / "sql" / "01_setup.sql").read_text()


def test_docs_enabled_values():
    assert demo_config.docs_enabled({}) and demo_config.docs_enabled({"DOCS_SEARCH": "auto"}) and demo_config.docs_enabled({"DOCS_SEARCH": "1"})
    assert not demo_config.docs_enabled({"DOCS_SEARCH": "0"})
    assert demo_config.load(environ={"DOCS_SEARCH": "0"})["DOCS_SEARCH"] == "0"


def test_set_config_value_replaces_or_appends(tmp_path):
    demo_config.set_config_value("DOCS_SEARCH", "0", root=tmp_path)
    assert (tmp_path / "config.env").read_text() == "DOCS_SEARCH=0\n"
    (tmp_path / "config.env").write_text("A=1\nDOCS_SEARCH=auto\nB=2\n")
    demo_config.set_config_value("DOCS_SEARCH", "0", root=tmp_path)
    assert (tmp_path / "config.env").read_text() == "A=1\nDOCS_SEARCH=0\nB=2\n"


# --- preflight --------------------------------------------------------------------------------------------------
def test_preflight_auto_missing_db_warns_saves_and_continues(capsys):
    saved = {}
    assert setup_checks.docs_check({"DOCS_SEARCH": "auto"}, False, lambda k, v: saved.update({k: v})) == 0
    out = capsys.readouterr().out
    assert saved == {"DOCS_SEARCH": "0"}
    assert "WITHOUT" in out and "Cortex Knowledge Extension: Snowflake Documentation" in out and "SNOWFLAKE_DOCUMENTATION" in out
    assert "https://www.snowflake.com/en/developers/guides/get-started-snowflake-cortex-knowledge-extensions/" in out
    assert "https://docs.snowflake.com/en/user-guide/snowflake-cortex/cortex-knowledge-extensions/cke-overview" in out


def test_preflight_required_missing_db_blocks(capsys):
    assert setup_checks.docs_check({"DOCS_SEARCH": "1"}, False, lambda *a: pytest.fail("must not save")) == 1
    assert "FAIL" in capsys.readouterr().out


def test_preflight_db_present_changes_nothing(capsys):
    assert setup_checks.docs_check({"DOCS_SEARCH": "auto"}, True, lambda *a: pytest.fail("must not save")) == 0
    assert "OK" in capsys.readouterr().out


def test_preflight_disabled_is_quiet_and_skips(capsys):
    assert setup_checks.docs_check({"DOCS_SEARCH": "0"}, False, lambda *a: pytest.fail("must not save")) == 0
    assert "DOCS_SEARCH=0" in capsys.readouterr().out


# --- eval --------------------------------------------------------------------------------------------------------
def test_eval_skips_docs_questions_when_tool_absent():
    qs = eval_agent.load_questions()
    run, skipped = eval_agent.split_docs_questions(qs, False)
    assert {q["id"] for q in skipped} >= {"agentic_prompt", "agentic_what"}
    assert not any(eval_agent.needs_docs(q) for q in run) and len(run) + len(skipped) == len(qs)
    assert eval_agent.split_docs_questions(qs, True) == (qs, [])


def test_eval_agent_spec_without_docs_has_no_docs_tool():
    cfg = dict(demo_config.load(environ={}), DOCS_SEARCH="0")
    assert "snowflake_docs" not in eval_agent.agent_spec("claude-sonnet-5-5", sql=demo_config.agents_sql(cfg))


# --- PAT ingress -------------------------------------------------------------------------------------------------
def test_pat_wins_and_is_never_printed(monkeypatch, capsys):
    monkeypatch.setenv("SNOWFLAKE_PAT", "pat-secret-123")
    with mock.patch("urllib.request.urlopen", side_effect=AssertionError("no HTTP exchange for a PAT")):
        assert app_token.ingress_token() == "pat-secret-123"
        assert app_token.main() == 0
    cap = capsys.readouterr()
    assert "pat-secret-123" not in cap.out + cap.err and cap.out == ""
    assert app_token.ingress_header("T") == {"Authorization": 'Snowflake Token="T"'}


def test_keypair_path_exchanges_jwt_for_token(monkeypatch, tmp_path):
    from cryptography.hazmat.primitives import serialization
    from cryptography.hazmat.primitives.asymmetric import rsa

    key = rsa.generate_private_key(public_exponent=65537, key_size=2048)
    kp = tmp_path / "k.p8"
    kp.write_bytes(key.private_bytes(serialization.Encoding.PEM, serialization.PrivateFormat.PKCS8, serialization.NoEncryption()))
    monkeypatch.delenv("SNOWFLAKE_PAT", raising=False)
    cfg = {"SNOWFLAKE_PRIVATE_KEY_PATH": str(kp), "SNOWFLAKE_ACCOUNT": "myorg-acct", "SNOWFLAKE_USER": "me", "APP_HOST": "myaccount.snowflakecomputing.app"}
    seen = {}

    def fake(req):
        seen["url"], seen["body"] = req.full_url, req.data.decode()
        return io.BytesIO(b"oauth-token\n")
    with mock.patch("urllib.request.urlopen", side_effect=fake):
        assert app_token.ingress_token(cfg, environ={}) == "oauth-token"
    assert seen["url"] == "https://myorg-acct.snowflakecomputing.com/oauth/token"
    assert "jwt-bearer" in seen["body"] and "scope=myaccount.snowflakecomputing.app" in seen["body"]


def test_no_credentials_explains_both_options(monkeypatch, capsys):
    monkeypatch.delenv("SNOWFLAKE_PAT", raising=False)
    with pytest.raises(SystemExit) as e:
        app_token.mint_oauth({"SNOWFLAKE_PRIVATE_KEY_PATH": "<path-to-rsa_key.p8>"})
    assert e.value.code == 2 and "SNOWFLAKE_PAT" in capsys.readouterr().err


def test_no_scripts_assume_keypair_for_snow_connections():
    for f in ("setup.sh", "teardown.sh"):
        text = (ROOT / f).read_text()
        assert "private_key" not in text.lower() and "PRIVATE_KEY" not in text


# --- check_models without a connection --------------------------------------------------------------------------
def test_check_models_without_connection_says_what_to_do():
    class Boom:
        @staticmethod
        def connect(**kw):
            raise RuntimeError("Connection name 'default' not found in connections.toml\nstack...")
    with pytest.raises(SystemExit) as e:
        check_models.connect(dict(demo_config.load(environ={})), connector=Boom)
    msg = str(e.value)
    assert e.value.code not in (0, None) and "config.env" in msg and "snow connection test" in msg and "stack" not in msg
