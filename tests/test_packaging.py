"""Packaging: config rendering, and no author-specific values in tracked files."""
import os
import re
import subprocess
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent / "scripts"))
import demo_config  # noqa: E402

ROOT = Path(__file__).resolve().parent.parent
PKG = {"DEMO_DATABASE": "MY_DB", "DEMO_SCHEMA": "AGENTIC_PARSE_DEMO_PKGTEST",
       "DEMO_ROLE": "AGENTIC_PARSE_DEMO_PKGTEST_RL", "DEMO_WAREHOUSE": "SFE_AGENTIC_PARSE_DEMO_PKGTEST_WH",
       "APP_NAME": "PKG_APP"}


def test_defaults_render_unchanged(tmp_path):
    cfg = demo_config.load(environ={})
    cfg.update({k: v for k, v in demo_config.parse_env((ROOT / "config.env.example").read_text()).items()
                if k in PKG})
    out = demo_config.render_tree(cfg, out=tmp_path / "b")
    for f in (ROOT / "sql").rglob("*.sql"):
        assert (out / "sql" / f.relative_to(ROOT / "sql")).read_text() == f.read_text(), f


def test_render_swaps_every_name_once():
    cfg = {**PKG, "FQ_SCHEMA": "MY_DB.AGENTIC_PARSE_DEMO_PKGTEST"}
    src = ("USE ROLE AGENTIC_PARSE_DEMO_RL; USE WAREHOUSE SFE_AGENTIC_PARSE_DEMO_WH; "
           "CALL SNOWFLAKE_EXAMPLE.AGENTIC_PARSE_DEMO.PARSE_COST(NULL); "
           "/api/v2/databases/SNOWFLAKE_EXAMPLE/schemas/AGENTIC_PARSE_DEMO/agents/AGENTIC_PARSE_DEMO_AGENT:run")
    out = demo_config.render_text(src, cfg)
    assert out == ("USE ROLE AGENTIC_PARSE_DEMO_PKGTEST_RL; USE WAREHOUSE SFE_AGENTIC_PARSE_DEMO_PKGTEST_WH; "
                   "CALL MY_DB.AGENTIC_PARSE_DEMO_PKGTEST.PARSE_COST(NULL); "
                   "/api/v2/databases/MY_DB/schemas/AGENTIC_PARSE_DEMO_PKGTEST/agents/AGENTIC_PARSE_DEMO_AGENT:run")


def test_app_yml_name_and_namespace():
    cfg = {**PKG}
    out = demo_config.render_app_yml((ROOT / "web" / "app.yml").read_text(), cfg)
    assert re.search(r"^name: PKG_APP$", out, re.M)
    assert re.search(r"^database: MY_DB$", out, re.M)
    assert re.search(r"^schema: AGENTIC_PARSE_DEMO_PKGTEST$", out, re.M)
    assert re.search(r"^query_warehouse: SFE_AGENTIC_PARSE_DEMO_PKGTEST_WH$", out, re.M)


def test_skip_admin_strips_si_block():
    sql = (ROOT / "sql" / "09b_agents.sql").read_text()
    out = demo_config.strip_admin(sql)
    assert "ACCOUNTADMIN" not in out and "CREATE OR REPLACE AGENT AGENTIC_PARSE_DEMO_SI_AGENT" in out


def test_env_overrides_files(tmp_path):
    (tmp_path / "config.env.example").write_text("SNOWFLAKE_CONNECTION=default\nDEMO_DATABASE=A\nDEMO_SCHEMA=B\n")
    (tmp_path / "config.env").write_text("SNOWFLAKE_CONNECTION=mine\n")
    cfg = demo_config.load(tmp_path, environ={"DEMO_SCHEMA": "C"})
    assert (cfg["SNOWFLAKE_CONNECTION"], cfg["FQ_SCHEMA"]) == ("mine", "A.C")


def test_no_author_specific_values_in_tracked_files():
    # Home paths, account locators (3 letters + 5 digits) and account URLs; extra terms via APD_BANNED.
    banned = re.compile(r"/Users/|\b[A-Z]{3}\d{5}\b|(?<![\w<-])(?!myaccount\.|myorg-)[a-z0-9][a-z0-9-]*\.snowflakecomputing\.(com|app)" + ("|" + os.environ["APD_BANNED"] if os.environ.get("APD_BANNED") else ""))
    files = subprocess.run(["git", "ls-files"], cwd=ROOT, capture_output=True, text=True, check=True).stdout.split()
    hits = []
    for f in files:
        p = ROOT / f
        if f == "tests/test_packaging.py" or not p.is_file() or p.suffix in {".pdf", ".png", ".jpg", ".webm", ".mp4", ".gif"}:
            continue
        try:
            text = p.read_text()
        except UnicodeDecodeError:
            continue
        hits += [f"{f}:{i}" for i, line in enumerate(text.splitlines(), 1) if banned.search(line)]
    assert not hits, hits[:40]


def test_live_tests_use_the_configured_namespace():
    # A live test that hardcodes the default schema reads, or REMOVEs from, another install's objects.
    hits = [p.name for p in (ROOT / "tests").glob("test_*.py")
            if p.name != "test_packaging.py" and "(cur" in p.read_text() and "SNOWFLAKE_EXAMPLE.AGENTIC_PARSE_DEMO" in p.read_text()]
    assert not hits, hits
