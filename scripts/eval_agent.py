"""T11 eval: run eval/questions.yaml against temp copies of the demo agent, one per orchestration model.

Usage: uv run python scripts/eval_agent.py [--models claude-sonnet-5-5 claude-opus-5-5]
Writes docs/model-eval.md. Never calls reparse (it is a forbidden tool in every check).
"""
import sys as _sys
from pathlib import Path as _Path
_sys.path.insert(0, str(_Path(__file__).resolve().parent))
import demo_config  # noqa: E402
_CFG = demo_config.load()
import argparse
import json
import os
import re
import time
from pathlib import Path

import yaml

ROOT = Path(__file__).resolve().parent.parent
S = _CFG["FQ_SCHEMA"]
FORBIDDEN_TOOLS = {"reparse"}
MODELS = ["claude-sonnet-5-5", "claude-opus-5-5"]


def load_questions(path=ROOT / "eval" / "questions.yaml"):
    return yaml.safe_load(Path(path).read_text())


def needs_docs(q):
    """True for questions that can only be answered with the snowflake_docs tool."""
    return q.get("category") == "snowflake_docs" or "snowflake_docs" in (q.get("tools_any") or [])


def split_docs_questions(questions, docs_on):
    """(questions to run, questions skipped because the docs tool is absent)."""
    if docs_on:
        return list(questions), []
    return [q for q in questions if not needs_docs(q)], [q for q in questions if needs_docs(q)]


def agent_spec(model, sql=None):
    """The agent spec from sql/09b_agents.sql with only the orchestration model replaced."""
    # Rendered with config.env names, so a temp agent in a second install calls that install's tools.
    sql = sql if sql is not None else demo_config.agents_sql(_CFG)
    spec = sql.split("CREATE OR REPLACE AGENT AGENTIC_PARSE_DEMO_AGENT", 1)[1]
    spec = spec.split("FROM SPECIFICATION\n$$\n", 1)[1].split("\n$$", 1)[0]
    new, n = re.subn(r"(?m)^(  orchestration: )\S+$", rf"\g<1>{model}", spec, count=1)
    assert n == 1, "orchestration model line not found"
    # CONTROL_APP_NAME=CONTROL_APP_T21 points the control_app tool at the scratch copy (scripts/scratch_control_app.py).
    # SCRATCH_SUFFIX=_T21 also points value_story and the parse_analytics semantic view at the scratch copies
    # (scripts/scratch_value.py) and control_app at CONTROL_APP<suffix>.
    suffix = os.environ.get("SCRATCH_SUFFIX", "")
    scratch = os.environ.get("CONTROL_APP_NAME") or (f"CONTROL_APP{suffix}" if suffix else "")
    if suffix:
        new, k = re.subn(r"(?m)^(    identifier: \S+\.VALUE_STORY)$", rf"\g<1>{suffix}", new)
        assert k == 1, "value_story identifier not found"
        new, k = re.subn(r"(?m)^(    semantic_view: \S+\.PARSE_ANALYTICS)$", rf"\g<1>{suffix}", new)
        assert k >= 1, "parse_analytics semantic view not found"
    if scratch:
        new, k = re.subn(r"(?m)^(    identifier: \S+\.)CONTROL_APP$", rf"\g<1>{scratch}", new)
        assert k == 1, "control_app identifier not found"
    return new


def parse_response(raw):
    """DATA_AGENT_RUN JSON -> (answer text, [tool names], [control_app result dicts])."""
    content = json.loads(raw).get("content", [])
    text = "".join(c.get("text", "") for c in content if c.get("type") == "text")
    results = [c["tool_result"] for c in content if c.get("type") == "tool_result"]
    tools = [r.get("name") for r in results]
    actions = []
    for r in results:
        if r.get("name") == "control_app" and r.get("status", "success") == "success":
            try:
                actions.append(json.loads(r["content"][0]["json"]["result"]))
            except (KeyError, IndexError, TypeError, json.JSONDecodeError):
                pass
    return text, tools, actions


def parse_calls(raw):
    """DATA_AGENT_RUN JSON -> [(tool name, input dict)] in call order, from tool_use items."""
    out = []
    for c in json.loads(raw).get("content", []):
        if c.get("type") == "tool_use":
            u = c.get("tool_use", {})
            out.append((u.get("name"), u.get("input") or {}))
    return out


def tool_order_score(expected, tools):
    """Fraction of `expected` tools that occur in that order (longest common subsequence / len(expected))."""
    if not expected:
        return 1.0
    prev = [0] * (len(tools) + 1)
    for e in expected:
        cur = [0]
        for j, t in enumerate(tools):
            cur.append(prev[j] + 1 if t == e else max(prev[j + 1], cur[j]))
        prev = cur
    return prev[-1] / len(expected)


def redundant_calls(calls):
    """Calls that repeat an earlier call with the same tool and the same input."""
    seen, n = set(), 0
    for name, inp in calls:
        key = (name, json.dumps(inp, sort_keys=True))
        n += key in seen
        seen.add(key)
    return n


def prompt(q):
    """The question as the app sends it: with the [App state] line when the question sets one."""
    return f"{q['app_state']}\n\n{q['question']}" if q.get("app_state") else q["question"]


def check(q, text, tools, actions, calls=None):
    """Return {check_name: bool} for one question."""
    out = {}
    low = text.lower()
    for s in q.get("require_all", []):
        out[f"has '{s}'"] = s.lower() in low
    for rx in q.get("require_regex", []):
        out[f"matches /{rx}/"] = re.search(rx, text, re.I) is not None
    for rx in q.get("forbid_regex", []):
        out[f"not /{rx}/"] = re.search(rx, text, re.I) is None
    if q.get("cite_any"):
        out["cites " + "|".join(q["cite_any"])] = any(c.lower() in low for c in q["cite_any"])
    if q.get("tools_any"):
        out["tool " + "|".join(q["tools_any"])] = bool(set(q["tools_any"]) & set(tools))
    if "app_action" in q:
        want = q["app_action"]
        out["app action"] = any(all(a.get(k) == v for k, v in want.items()) for a in actions)
    if "tour_steps" in q:
        lo, hi = q["tour_steps"]
        out[f"tour {lo}-{hi} steps"] = any(a.get("action") == "tour" and lo <= len(a.get("steps") or []) <= hi for a in actions)
    for t in q.get("forbid_tools", []):
        out[f"no tool {t}"] = t not in tools
    if q.get("tool_order"):
        out["tool order " + ">".join(q["tool_order"])] = tool_order_score(q["tool_order"], tools) == 1.0
    if calls is not None:
        out["no redundant calls"] = redundant_calls(calls) == 0
    if q.get("max_calls"):
        out[f"at most {q['max_calls']} calls"] = len(tools) <= q["max_calls"]
    out["no reparse"] = not (FORBIDDEN_TOOLS & set(tools))
    return out


def decide(results):
    """results: {model: [{id, honesty, passed}]}. Keep Sonnet unless Opus passes >=2 more or Sonnet fails an
    honesty check Opus passes."""
    son, opus = results["claude-sonnet-5-5"], results["claude-opus-5-5"]
    ns, no = sum(r["passed"] for r in son), sum(r["passed"] for r in opus)
    opus_by_id = {r["id"]: r for r in opus}
    honesty_gap = [r["id"] for r in son if r["honesty"] and not r["passed"] and opus_by_id[r["id"]]["passed"]]
    if no - ns >= 2:
        return "claude-opus-5-5", f"Opus passed {no} vs Sonnet {ns} (>= 2 more)"
    if honesty_gap:
        return "claude-opus-5-5", f"Sonnet failed honesty checks Opus passed: {', '.join(honesty_gap)}"
    return "claude-sonnet-5-5", f"Sonnet {ns} vs Opus {no}; no honesty gap"


def run_model(cur, model, questions, schema=None):
    name = f"AGENTIC_PARSE_DEMO_AGENT_EVAL_{'OPUS' if 'opus' in model else 'SONNET'}{os.environ.get('EVAL_AGENT_SUFFIX', '')}"
    fqn = f"{schema or S}.{name}"
    cur.execute(f"CREATE OR REPLACE AGENT {fqn} FROM SPECIFICATION $$\n{agent_spec(model)}\n$$")
    rows = []
    try:
        for q in questions:
            body = {"messages": [{"role": "user", "content": [{"type": "text", "text": prompt(q)}]}]}
            t0 = time.time()
            try:
                cur.execute("SELECT SNOWFLAKE.CORTEX.DATA_AGENT_RUN(%s, %s)", (fqn, json.dumps(body)))
                raw = cur.fetchone()[0]
                text, tools, actions = parse_response(raw)
                calls = parse_calls(raw)
            except Exception as e:  # record the failure, keep going
                text, tools, actions, calls = f"ERROR: {e}", [], [], []
            secs = time.time() - t0
            checks = check(q, text, tools, actions, calls)
            rows.append({"id": q["id"], "category": q["category"], "honesty": bool(q.get("honesty")),
                         "passed": all(checks.values()), "checks": checks, "text": text, "tools": tools,
                         "actions": actions, "secs": secs,
                         "order": tool_order_score(q["tool_order"], tools) if q.get("tool_order") else None,
                         "redundant": redundant_calls(calls)})
            print(model, q["id"], "PASS" if rows[-1]["passed"] else "FAIL", f"{secs:.1f}s", tools, flush=True)
    finally:
        cur.execute(f"DROP AGENT IF EXISTS {fqn}")
    return rows


def summary(results, winner, why, questions, date=None):
    """Compact eval summary for the app's Eval results panel (web/lib/eval-summary.json)."""
    qmap = {q["id"]: q for q in questions}
    models, traj = [], []
    for m, rs in results.items():
        lat = sorted(r["secs"] for r in rs)
        models.append({"model": m, "passed": sum(r["passed"] for r in rs), "total": len(rs), "median_secs": round(lat[len(lat) // 2], 1)})
        for r in rs:
            if r.get("order") is not None:
                traj.append({"model": m, "id": r["id"], "expected": qmap[r["id"]]["tool_order"], "order": r["order"],
                             "calls": len(r["tools"]), "redundant": r["redundant"]})
    return {"date": date or time.strftime("%Y-%m-%d"), "winner": winner, "why": why, "models": models, "trajectory": traj}


def report(results, winner, why, questions):
    ms = list(results)
    lines = ["# Model eval (T11)", "",
             f"Run {time.strftime('%Y-%m-%d %H:%M %Z')} on the demo account via `SNOWFLAKE.CORTEX.DATA_AGENT_RUN`, "
             "against temp copies of `AGENTIC_PARSE_DEMO_AGENT` (same spec from `sql/09b_agents.sql`, only "
             "`models.orchestration` changed; dropped afterwards). Questions and checks: `eval/questions.yaml`; "
             "runner: `scripts/eval_agent.py`. `reparse` is forbidden in every question.", "",
             "Decision rule: keep Sonnet unless Opus passes at least 2 more questions, or Sonnet fails any "
             "honesty / no-invention / cost question (`honesty: true`) that Opus passes.", "",
             f"**Decision: `{winner}`** ({why}). Pinned in `sql/09b_agents.sql`.", "",
             "| question | category | " + " | ".join(f"{m} | {m} s" for m in ms) + " | tools (" + ms[0] + ") |",
             "|---|---|" + "---|---|" * len(ms) + "---|"]
    for i, q in enumerate(questions):
        cells = []
        for m in ms:
            r = results[m][i]
            cells += ["PASS" if r["passed"] else "FAIL", f"{r['secs']:.1f}"]
        lines.append(f"| {q['id']}{' (honesty)' if q.get('honesty') else ''} | {q['category']} | "
                     + " | ".join(cells) + f" | {', '.join(results[ms[0]][i]['tools'])} |")
    tot = []
    for m in ms:
        rs = results[m]
        lat = sorted(r["secs"] for r in rs)
        tot += [f"**{sum(r['passed'] for r in rs)}/{len(rs)}**", f"median {lat[len(lat) // 2]:.1f}"]
    lines += [f"| **total** | | " + " | ".join(tot) + " | |", "", "## Trajectory (tool order and redundant calls)", "",
              "Order score = share of the question's expected tools called in that order (extra tools allowed). "
              "Redundant = a repeat of an earlier call with the same tool and input.", "",
              "| model | question | order score | tool calls | redundant calls |", "|---|---|---|---|---|"]
    for m in ms:
        for r in results[m]:
            if r.get("order") is not None:
                lines.append(f"| {m} | {r['id']} | {r['order']:.2f} | {len(r['tools'])} | {r['redundant']} |")
        lines.append(f"| {m} | **all questions** | | {sum(len(r['tools']) for r in results[m])} | {sum(r['redundant'] for r in results[m])} |")
    lines += ["", "## Failing answers (verbatim)", ""]
    for m in ms:
        for r in results[m]:
            if r["passed"]:
                continue
            failed = [k for k, v in r["checks"].items() if not v]
            lines += [f"### {m} / {r['id']}", "", f"Failed: {', '.join(failed)}. Tools: {r['tools']}. "
                      f"Viewer actions: {r['actions']}", "", "```text", r["text"].strip() or "(empty)", "```", ""]
    (ROOT / "docs" / "model-eval.md").write_text("\n".join(lines))
    (ROOT / "web" / "lib" / "eval-summary.json").write_text(json.dumps(summary(results, winner, why, questions), indent=1) + "\n")


def main():
    import snowflake.connector

    ap = argparse.ArgumentParser()
    ap.add_argument("--models", nargs="+", default=MODELS)
    ap.add_argument("--schema", help="fully qualified scratch schema for the temp agents (default: the demo schema)")
    ap.add_argument("--only", nargs="+", help="question ids to run (skips writing docs/model-eval.md)")
    ap.add_argument("--no-report", action="store_true")
    args = ap.parse_args()
    questions = load_questions()
    if args.only:
        questions = [q for q in questions if q["id"] in args.only]
    questions, skipped = split_docs_questions(questions, demo_config.docs_enabled(_CFG))
    for q in skipped:
        print("SKIPPED", q["id"], "(needs the snowflake_docs tool; DOCS_SEARCH=0, no SNOWFLAKE_DOCUMENTATION database)")
    if skipped:
        args.no_report = True  # a partial run must not overwrite docs/model-eval.md
    conn = snowflake.connector.connect(connection_name=_CFG["SNOWFLAKE_CONNECTION"],
                                       role=_CFG["DEMO_ROLE"], warehouse=_CFG["DEMO_WAREHOUSE"],
                                       database=_CFG["DEMO_DATABASE"], schema=_CFG["DEMO_SCHEMA"])
    try:
        cur = conn.cursor()
        results = {m: run_model(cur, m, questions, args.schema) for m in args.models}
    finally:
        conn.close()
    winner, why = decide(results) if set(MODELS) <= set(results) else (args.models[0], "single model run")
    if not (args.no_report or args.only):
        report(results, winner, why, questions)
    else:
        print(json.dumps({m: [{k: r[k] for k in ("id", "passed", "tools", "order", "redundant", "actions")} | {"failed": [c for c, v in r["checks"].items() if not v]} for r in rs] for m, rs in results.items()}, indent=1))
    print("DECISION", winner, why)


if __name__ == "__main__":
    main()
