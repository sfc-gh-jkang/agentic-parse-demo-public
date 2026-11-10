"""Record raw SSE event types from agent:run for an agent. Usage: agent_stream_spike.py <AGENT_FQN> "<question>"."""
import sys as _sys
from pathlib import Path as _Path
_sys.path.insert(0, str(_Path(__file__).resolve().parent))
import demo_config  # noqa: E402
_CFG = demo_config.load()
import json
import os
import sys

import requests
import snowflake.connector

agent, question = sys.argv[1], sys.argv[2]
conn = snowflake.connector.connect(connection_name=_CFG["SNOWFLAKE_CONNECTION"],
                                   role=_CFG["DEMO_ROLE"], warehouse=_CFG["DEMO_WAREHOUSE"])
db, schema, name = agent.split(".")
url = f"https://{conn.host}/api/v2/databases/{db}/schemas/{schema}/agents/{name}:run"
body = {"messages": [{"role": "user", "content": [{"type": "text", "text": question}]}], "stream": True}
headers = {"Authorization": f'Snowflake Token="{conn.rest.token}"', "Content-Type": "application/json",
           "Accept": "text/event-stream"}
event = None
with requests.post(url, json=body, headers=headers, stream=True, timeout=180) as r:
    print("HTTP", r.status_code)
    for line in r.iter_lines(decode_unicode=True):
        if line.startswith("event:"):
            event = line[6:].strip()
        elif line.startswith("data:"):
            raw = line[5:].strip()
            try:
                print(json.dumps({"event": event, "data": json.loads(raw)}))
            except json.JSONDecodeError:
                print(json.dumps({"event": event, "raw": raw}))
conn.close()
