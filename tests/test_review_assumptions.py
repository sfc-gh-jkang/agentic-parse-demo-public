"""Live: cost including human review. VALUE_STORY's review block is recomputed here from the story's own pages-to-check and
credits (not from the SQL), and CONTROL_APP validates the user's review assumptions. Scratch copies: SCRATCH_SUFFIX=_T21
(scripts/scratch_value.py create; scripts/scratch_control_app.py create)."""
import json
import os
import sys
from pathlib import Path

import pytest

pytestmark = pytest.mark.live

sys.path.insert(0, str(Path(__file__).resolve().parent.parent / "scripts"))
SFX = os.environ.get("SCRATCH_SUFFIX", "")
CA = "CONTROL_APP_T21" if SFX else "CONTROL_APP"


@pytest.fixture(scope="module")
def cur():
    import demo_config
    import snowflake.connector
    cfg = demo_config.load()
    conn = snowflake.connector.connect(connection_name=cfg["SNOWFLAKE_CONNECTION"], role=cfg["DEMO_ROLE"],
                                       warehouse=cfg["DEMO_WAREHOUSE"], database=cfg["DEMO_DATABASE"], schema=cfg["DEMO_SCHEMA"])
    c = conn.cursor()
    try:
        c.execute(f"CALL VALUE_STORY{SFX}(1000, 5, 60, 2)")
        assert "review" in json.loads(c.fetchone()[0])
    except Exception:
        pytest.skip("review-capable VALUE_STORY not deployed; create the scratch copy first")
    yield c
    conn.close()


def story(cur, *args):
    cur.execute(f"CALL VALUE_STORY{SFX}({', '.join(str(a) for a in args)})")
    return json.loads(cur.fetchone()[0])


def test_review_math_is_recomputed_independently(cur):
    s = story(cur, 50000, 5, 60, 2)
    plain = {m["mode"]: m for m in s["modes"]}
    r = {m["mode"]: m for m in s["review"]["modes"]}
    for mode, m in plain.items():
        check = m["pages_to_check"] / m["corpus_pages"] * 50000
        hours = check * 5 / 60
        assert r[mode]["pages_to_check_per_month"] == pytest.approx(check, rel=1e-6)
        assert r[mode]["review_hours"] == pytest.approx(hours, rel=1e-6)
        assert r[mode].get("review_cost") == pytest.approx(hours * 60, rel=1e-6)
        assert r[mode]["monthly_credits"] == pytest.approx(50000 * m["credits_per_page"], rel=1e-6)
        assert r[mode].get("credits_cost") == pytest.approx(50000 * m["credits_per_page"] * 2, rel=1e-6)
        assert r[mode].get("total_cost") == pytest.approx(hours * 60 + 50000 * m["credits_per_page"] * 2, rel=1e-6)
    assert r["AGENTIC"].get("hours_saved_by_agentic") is None
    for mode in ("OCR", "LAYOUT"):
        assert r[mode].get("hours_saved_by_agentic") == pytest.approx(r[mode]["review_hours"] - r["AGENTIC"]["review_hours"], rel=1e-6)
    assert "not a quote" in s["review"]["label"]


def test_no_price_means_no_money_for_credits_and_no_total(cur):
    r = {m["mode"]: m for m in story(cur, 50000, 5, 60)["review"]["modes"]}
    assert all(m.get("credits_cost") is None and m.get("total_cost") is None and m["monthly_credits"] > 0 for m in r.values())
    assert all(m.get("review_cost") is not None for m in r.values())


def test_no_hourly_rate_means_hours_only(cur):
    r = {m["mode"]: m for m in story(cur, 50000, 5)["review"]["modes"]}
    assert all(m.get("review_cost") is None and m["review_hours"] > 0 for m in r.values())


def test_nothing_assumed_means_no_review_block(cur):
    assert story(cur, 50000).get("review") is None


@pytest.mark.parametrize("args", [(None, 5, 60), (1000, None, 60), (1000, 0, 60), (1000, 601, 60), (1000, 5, -1), (1000, 5, 60, 0)])
def test_invalid_review_inputs_are_errors(cur, args):
    out = story(cur, *["NULL" if a is None else a for a in args])
    assert "error" in out


def app(cur, **kw):
    args = ", ".join(f"{k.upper()} => %({k})s" for k in kw)
    cur.execute(f"CALL {CA}({args})", kw)
    return json.loads(cur.fetchone()[0])


def test_set_volume_echoes_the_users_assumptions(cur):
    out = app(cur, action="set_volume", volume=50000, review_minutes=5, hourly_rate=60)
    assert (out["action"], out["volume"], out["review_minutes"], out["hourly_rate"], out.get("credit_price")) == ("set_volume", 50000, 5, 60, None)


def test_set_review_assumptions_needs_a_number_and_rejects_nonsense(cur):
    assert app(cur, action="set_review_assumptions", credit_price=2.5)["credit_price"] == 2.5
    for kw in ({}, {"review_minutes": 0}, {"review_minutes": 601}, {"hourly_rate": -1}, {"credit_price": 0}):
        assert "error" in app(cur, action="set_review_assumptions", **kw), kw
    assert "error" in app(cur, action="go_home", review_minutes=5)


def test_decimals_are_not_rounded_to_whole_numbers(cur):
    """NUMBER parameters are NUMBER(38,0) and would round 2.5 to 3; the review parameters are FLOAT."""
    s = story(cur, 50000, 2.5, 60.5, 2.25)
    assert (s["review"]["review_minutes_per_page"], s["review"]["hourly_rate"], s["review"]["price_per_credit"]) == (2.5, 60.5, 2.25)
    a = {m["mode"]: m for m in s["review"]["modes"]}["AGENTIC"]
    assert a["review_hours"] == pytest.approx(12500 * 2.5 / 60, rel=1e-6)
