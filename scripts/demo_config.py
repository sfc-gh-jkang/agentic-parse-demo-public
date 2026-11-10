"""Single source for deployment names: config.env (gitignored) over config.env.example defaults.

Environment variables override both. Every committed file is written with the default names
(SNOWFLAKE_EXAMPLE.AGENTIC_PARSE_DEMO, ...); `render_tree` copies sql/, scoring/ and web/ into .build/
with those names swapped for the configured ones, so `snow sql -f` and `snow app deploy` run the copy.
Usage: python3 scripts/demo_config.py render     (writes .build/, prints the config)
       python3 scripts/demo_config.py get KEY
       python3 scripts/demo_config.py defaults-match   (yes if any deployment name is a shipped default)
"""
import os
import re
import shutil
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
KEYS = ["SNOWFLAKE_CONNECTION", "DEMO_DATABASE", "DEMO_SCHEMA", "DEMO_ROLE", "DEMO_WAREHOUSE", "APP_NAME",
        "SNOWFLAKE_ACCOUNT", "SNOWFLAKE_USER", "SNOWFLAKE_PRIVATE_KEY_PATH", "APP_HOST", "SKIP_ADMIN", "DOCS_SEARCH"]
# Names as written in committed files. Order does not matter: one regex pass, so no chained swaps.
TOKENS = {"SNOWFLAKE_EXAMPLE": "DEMO_DATABASE", "SFE_AGENTIC_PARSE_DEMO_WH": "DEMO_WAREHOUSE",
          "AGENTIC_PARSE_DEMO_RL": "DEMO_ROLE", "AGENTIC_PARSE_DEMO": "DEMO_SCHEMA"}
TOKEN_RE = re.compile(r"\b(" + "|".join(sorted(TOKENS, key=len, reverse=True)) + r")\b")
TEXT_SUFFIXES = {".sql", ".py", ".ts", ".tsx", ".mjs", ".js", ".yml", ".yaml", ".tmpl", ".json", ".md"}
WEB_SKIP = {"node_modules", ".next", "snowflake.log", "tsconfig.tsbuildinfo", "__tests__", "e2e", ".env"}


def parse_env(text: str) -> dict:
    out = {}
    for line in text.splitlines():
        line = line.strip()
        if not line or line.startswith("#") or "=" not in line:
            continue
        k, v = line.split("=", 1)
        out[k.strip()] = v.strip().strip('"').strip("'")
    return out


def load(root: Path = ROOT, environ=None) -> dict:
    environ = os.environ if environ is None else environ
    cfg = parse_env((root / "config.env.example").read_text())
    if (root / "config.env").exists():
        cfg.update(parse_env((root / "config.env").read_text()))
    cfg.update({k: environ[k] for k in KEYS if environ.get(k)})
    cfg["FQ_SCHEMA"] = f"{cfg['DEMO_DATABASE']}.{cfg['DEMO_SCHEMA']}"
    return cfg


def docs_enabled(cfg: dict) -> bool:
    """False only when DOCS_SEARCH=0: the agents are installed without the snowflake_docs tool.

    DOCS_SEARCH is auto (default; preflight sets it to 0 in config.env when the SNOWFLAKE_DOCUMENTATION database is
    missing), 1 (require the database) or 0 (never use it).
    """
    return str(cfg.get("DOCS_SEARCH", "auto")).strip().lower() not in ("0", "false", "no", "off")


def set_config_value(key: str, value: str, root: Path = ROOT) -> None:
    """Set KEY=value in config.env, replacing an existing line or appending one. Creates the file if missing."""
    f = root / "config.env"
    lines = f.read_text().splitlines() if f.exists() else []
    new = f"{key}={value}"
    for i, line in enumerate(lines):
        if re.match(rf"\s*{re.escape(key)}\s*=", line):
            lines[i] = new
            break
    else:
        lines.append(new)
    f.write_text("\n".join(lines) + "\n")


def agents_sql(cfg: dict, root: Path = ROOT) -> str:
    """sql/09b_agents.sql text with the configured names, and without the docs tool when DOCS_SEARCH=0."""
    if docs_enabled(cfg):
        text = (root / "sql" / "09b_agents.sql").read_text()
    else:
        sys.path.insert(0, str(Path(__file__).resolve().parent))
        import gen_agents_sql
        text = gen_agents_sql.generate(docs=False)
    return render_text(text, cfg)


def render_text(text: str, cfg: dict) -> str:
    return TOKEN_RE.sub(lambda m: cfg[TOKENS[m.group(1)]], text)


def render_app_yml(text: str, cfg: dict) -> str:
    text = render_text(text, cfg)
    return re.sub(r"^name: .*$", f"name: {cfg['APP_NAME']}", text, count=1, flags=re.M)


def strip_admin(sql: str) -> str:
    """Drop the trailing ACCOUNTADMIN block (Snowflake Intelligence registration) for SKIP_ADMIN installs."""
    i = sql.find("USE ROLE ACCOUNTADMIN;")
    return sql if i < 0 else sql[:i] + "-- SKIP_ADMIN: Snowflake Intelligence registration skipped\n"


def _copy(src: Path, dst: Path, cfg: dict, skip=frozenset()):
    for p in sorted(src.rglob("*")):
        rel = p.relative_to(src)
        if any(part in skip for part in rel.parts) or p.is_dir():
            continue
        out = dst / rel
        out.parent.mkdir(parents=True, exist_ok=True)
        if p.suffix in TEXT_SUFFIXES and p.name != "package-lock.json":
            text = p.read_text()
            if rel.as_posix() == "app.yml":
                text = render_app_yml(text, cfg)
            else:
                text = render_text(text, cfg)
            if not docs_enabled(cfg) and rel.as_posix() in ("01_setup.sql", "09b_agents.sql"):
                sys.path.insert(0, str(Path(__file__).resolve().parent))
                import gen_agents_sql
                text = render_text(gen_agents_sql.no_docs_text(rel.name, p.read_text()), cfg)
            if cfg.get("SKIP_ADMIN") == "1" and p.name == "09b_agents.sql":
                text = strip_admin(text)
            out.write_text(text)
        else:
            shutil.copy2(p, out)


def render_tree(cfg: dict, root: Path = ROOT, out: Path | None = None) -> Path:
    out = out or root / ".build"
    if out.exists():
        shutil.rmtree(out)
    _copy(root / "sql", out / "sql", cfg)
    _copy(root / "scoring", out / "scoring", cfg, {"__pycache__"})
    _copy(root / "web", out / "web", cfg, WEB_SKIP)
    return out


def connect(schema: bool = True, **kw):
    """snowflake.connector connection as the demo role, warehouse and (optionally) schema."""
    import snowflake.connector

    c = load()
    args = dict(connection_name=c["SNOWFLAKE_CONNECTION"], role=c["DEMO_ROLE"], warehouse=c["DEMO_WAREHOUSE"])
    if schema:
        args.update(database=c["DEMO_DATABASE"], schema=c["DEMO_SCHEMA"])
    args.update(kw)
    return snowflake.connector.connect(**args)


if __name__ == "__main__":
    c = load()
    if sys.argv[1:2] == ["get"]:
        print(c.get(sys.argv[2], ""))
    elif sys.argv[1:2] == ["defaults-match"]:
        # "yes" when the schema, role, warehouse or app is one of the shipped defaults (teardown.sh guards on this).
        d = parse_env((ROOT / "config.env.example").read_text())
        same = any(c.get(k) == d.get(k) for k in ("DEMO_SCHEMA", "DEMO_ROLE", "DEMO_WAREHOUSE", "APP_NAME"))
        print("yes" if same else "no")
    elif sys.argv[1:2] == ["render"]:
        print(render_tree(c))
    else:
        print(__doc__)
