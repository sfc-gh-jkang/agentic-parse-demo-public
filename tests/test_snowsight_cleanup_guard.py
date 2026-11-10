"""The Snowsight guide's clean-up block must not drop anything when pasted unedited.

Pasting the old block with Run All dropped a live install once. The block is now one Snowflake
Scripting statement that raises before its first DROP unless `confirm` is edited to
'DELETE <schema>'. These checks read the block from the guide, so nothing reaches Snowflake.
"""
import re
from pathlib import Path

GUIDE = Path(__file__).resolve().parent.parent / "docs" / "install-snowsight.md"


def _section():
    t = GUIDE.read_text()
    return t[t.index("## Clean up"):t.index("## What was tested")]


def _block():
    blocks = re.findall(r"```sql\n(.*?)```", _section(), re.S)
    assert len(blocks) == 1
    return blocks[0]


def test_warns_it_deletes_and_url_changes():
    s = _section()
    assert "**Warning: this deletes the demo.**" in s
    assert "new URL" in s.replace("**", "")


def test_every_drop_is_inside_the_guarded_block():
    sql = _block()
    statements_outside = sql.split("EXECUTE IMMEDIATE $$")[0]
    assert "DROP" not in statements_outside.upper()
    assert sql.index("RAISE not_confirmed") < sql.index("EXECUTE IMMEDIATE 'DROP")


def test_unedited_confirm_cannot_match_any_schema():
    sql = _block()
    confirm = re.search(r"confirm VARCHAR DEFAULT '([^']*)'", sql).group(1)
    sch = re.search(r"sch VARCHAR DEFAULT '([^']*)'", sql).group(1)
    assert confirm == "EDIT ME"
    assert "IF (confirm IS DISTINCT FROM 'DELETE ' || sch) THEN RAISE not_confirmed" in sql
    assert confirm != "DELETE " + sch
    assert not confirm.startswith("DELETE ")


def test_names_are_validated_before_dynamic_sql():
    sql = _block()
    assert sql.index("RAISE bad_name") < sql.index("EXECUTE IMMEDIATE 'DROP")
