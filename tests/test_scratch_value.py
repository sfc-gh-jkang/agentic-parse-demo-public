"""Non-live: the scratch DDL for the value/data objects is rendered from the real sql/ files and only ever creates _T21 names."""
import re
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent / "scripts"))
import scratch_value as sv  # noqa: E402

FQ = "SNOWFLAKE_EXAMPLE.AGENTIC_PARSE_DEMO"


def test_every_statement_creates_a_suffixed_object_only():
    stmts = sv.statements("_T21")
    assert len(stmts) == 7
    for s in stmts:
        head = re.match(r"CREATE OR REPLACE (?:SEMANTIC VIEW|VIEW|PROCEDURE) (\w+)", s)
        assert head and head.group(1).endswith("_T21"), s[:80]
        # no live object of the new set is referenced without the suffix
        for name in sv.VIEWS + sv.OTHERS:
            assert not re.search(rf"\b{name}\b(?!_T21)", s), (name, s[:80])


def test_existing_objects_are_left_alone():
    sem = [s for s in sv.statements("_T21") if "SEMANTIC VIEW" in s][0]
    for kept in ("DOCUMENT_CATALOG", "PARSE_RUNS", "PARSE_RUN_COST", "MODE_COMPARISONS"):
        assert kept in sem and f"{kept}_T21" not in sem


def test_drops_cover_everything_created_and_use_the_suffix():
    drops = sv.drops(FQ, "_T21")
    assert len(drops) == 9 and all("_T21" in d and d.startswith("DROP ") and "IF EXISTS" in d for d in drops)
    created = {re.match(r"CREATE OR REPLACE (?:SEMANTIC VIEW|VIEW|PROCEDURE) (\w+)", s).group(1) for s in sv.statements("_T21")}
    dropped = {re.search(rf"{FQ}\.(\w+)", d).group(1) for d in drops}
    assert created == dropped


def test_07b_is_wired_into_setup_and_the_snowsight_installer_before_the_agent_tools():
    root = Path(__file__).resolve().parent.parent
    setup = (root / "setup.sh").read_text()
    assert setup.index("07b_value_and_data.sql") < setup.index("09_agent_tools.sql")
    inst = (root / "snowsight" / "install.sql").read_text()
    assert inst.index("07b_value_and_data.sql") < inst.index("09_agent_tools.sql")
