"""teardown.sh must not drop the default (production) names by accident.

A clone without config.env reads config.env.example, whose names are the shipped defaults, and `--yes`
skips the typed confirmation. That pair dropped a live deployment once. These run teardown.sh against a
fake `snow` that records every call, so nothing reaches Snowflake.
"""
import os
import shutil
import subprocess
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent


def _run(tmp_path, config_env, extra_env=None):
    work = tmp_path / "repo"
    (work / "scripts").mkdir(parents=True)
    shutil.copy(ROOT / "teardown.sh", work / "teardown.sh")
    shutil.copy(ROOT / "scripts" / "demo_config.py", work / "scripts" / "demo_config.py")
    shutil.copy(ROOT / "config.env.example", work / "config.env.example")
    if config_env is not None:
        (work / "config.env").write_text(config_env)
    bin_dir = tmp_path / "bin"
    bin_dir.mkdir()
    log = tmp_path / "snow.log"
    (bin_dir / "snow").write_text(f'#!/usr/bin/env bash\necho "$@" >> "{log}"\necho "+---+"\n')
    (bin_dir / "snow").chmod(0o755)
    env = {**os.environ, "PATH": f"{bin_dir}:{os.environ['PATH']}"}
    for k in ("DEMO_SCHEMA", "DEMO_ROLE", "DEMO_WAREHOUSE", "DEMO_DATABASE", "APP_NAME", "TEARDOWN_DEFAULT_NAMES"):
        env.pop(k, None)
    env.update(extra_env or {})
    r = subprocess.run(["bash", "teardown.sh", "--yes"], cwd=work, env=env, capture_output=True, text=True, timeout=60)
    calls = log.read_text() if log.exists() else ""
    return r, calls


def test_refuses_without_config_env(tmp_path):
    r, calls = _run(tmp_path, None)
    assert r.returncode != 0
    assert "config.env" in r.stdout + r.stderr
    assert "DROP" not in calls


def test_yes_refuses_default_names_without_explicit_opt_in(tmp_path):
    r, calls = _run(tmp_path, "SNOWFLAKE_CONNECTION=x\n")
    assert r.returncode != 0
    assert "TEARDOWN_DEFAULT_NAMES" in r.stdout + r.stderr
    assert "DROP" not in calls


def test_yes_drops_custom_names(tmp_path):
    cfg = "SNOWFLAKE_CONNECTION=x\nDEMO_SCHEMA=APD_T\nDEMO_ROLE=APD_T_RL\nDEMO_WAREHOUSE=APD_T_WH\nAPP_NAME=APD_T\n"
    r, calls = _run(tmp_path, cfg)
    assert r.returncode == 0, r.stderr
    assert "DROP SCHEMA IF EXISTS SNOWFLAKE_EXAMPLE.APD_T CASCADE" in calls
    assert "AGENTIC_PARSE_DEMO_RL" not in calls


def test_yes_with_default_names_and_opt_in(tmp_path):
    r, calls = _run(tmp_path, "SNOWFLAKE_CONNECTION=x\n", {"TEARDOWN_DEFAULT_NAMES": "1"})
    assert r.returncode == 0, r.stderr
    assert "DROP SCHEMA IF EXISTS SNOWFLAKE_EXAMPLE.AGENTIC_PARSE_DEMO CASCADE" in calls
