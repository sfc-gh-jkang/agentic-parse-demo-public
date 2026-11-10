import sys as _sys
from pathlib import Path as _Path
_sys.path.insert(0, str(_Path(__file__).resolve().parent.parent / "scripts"))
import demo_config  # noqa: E402
_CFG = demo_config.load()
import os

import pytest


def pytest_collection_modifyitems(config, items):
    if os.environ.get("LIVE") == "1":
        return
    skip = pytest.mark.skip(reason="live Snowflake test; run with LIVE=1")
    for item in items:
        if "live" in item.keywords:
            item.add_marker(skip)


@pytest.fixture(scope="session")
def cur():
    import snowflake.connector

    conn = snowflake.connector.connect(
        connection_name=_CFG["SNOWFLAKE_CONNECTION"],
        role=_CFG["DEMO_ROLE"],
        warehouse=_CFG["DEMO_WAREHOUSE"],
        database=_CFG["DEMO_DATABASE"],
        schema=_CFG["DEMO_SCHEMA"],
    )
    yield conn.cursor()
    conn.close()
