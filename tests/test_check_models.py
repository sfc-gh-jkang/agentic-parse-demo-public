"""scripts/check_models.py: pin discovery (non-live) and the real probes (live)."""
import os
import subprocess
import sys
from pathlib import Path

import pytest

ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(ROOT / "scripts"))
import check_models  # noqa: E402


def test_finds_both_agent_pins_and_ask_model():
    agents = check_models.agent_pins()
    assert agents == {"AGENTIC_PARSE_DEMO_AGENT": "claude-sonnet-5-5", "AGENTIC_PARSE_DEMO_SI_AGENT": "claude-sonnet-5-5"}
    assert "claude-sonnet-5-5" in check_models.complete_pins()


def test_candidates_same_family():
    assert check_models.candidates("claude-sonnet-5-5") == ["claude-sonnet-5-6", "claude-sonnet-6", "claude-sonnet-6-0", "claude-sonnet-6-5"]


@pytest.mark.live
def test_all_pinned_models_answer():
    r = subprocess.run([sys.executable, str(ROOT / "scripts" / "check_models.py")], capture_output=True, text=True,
                       env={**os.environ}, timeout=600)
    assert r.returncode == 0, r.stdout + r.stderr
    assert r.stdout.count("OK  ") >= 3
