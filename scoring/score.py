"""Score stored Parse Runs against Ground Truth.

Pure Python, no Snowflake imports, so the COMPARE_MODES procedure and offline
reporting share one implementation.

What a Parse Mode produced is read as two things: the page *text* every mode
returns, and (AGENTIC only) the structured *results* of each Visual it reports.

A *fact* is one visible value from Ground Truth (chart value, table cell, label,
date, stamp text, checkbox state). It is recovered when it appears on its own
page, in the page text or in the *values* of that page's Visual results (never
their key names). Only a table that spans pages may match on another page.
Numbers match to the precision Ground Truth states them in: 13.8 accepts 13.75 to
13.85, 1905 rejects an axis tick of 1900, and a whole number needs that exact
number. Dates and other hyphenated digit runs are not read as numbers.

A *relation* is a set of values that belong together: a chart point (Q3, 13.8),
a diagram connection (Rack R1 -> Switch SW1), a KPI (ARR, $48.2M), a table row.
It is recovered only when its values are *paired* in one record:
  - a markdown table row;
  - a text line where the values sit together (within a few tokens of each other);
  - a small object or list in a Visual's structured details, holding at most two
    values more than the relation itself.
Prose (summary, description, notes) never pairs values: a sentence that mentions
Q3 and 13.8 has not said that Q3 is 13.8.

A Visual is *detected* when an AGENTIC Visual of an accepted image_type overlaps
the Ground Truth box (IoU >= 0.3) on the same page. OCR and LAYOUT cannot report
Visuals by design, so detection is reported for AGENTIC only.
"""
from __future__ import annotations

import json
import re
from dataclasses import dataclass, field

# Ground Truth keys that describe layout or provenance, not visible content.
NON_CONTENT_KEYS = {
    "page", "channel", "bbox", "image_type", "accept_types", "context", "role",
    "chart_type", "kind", "spans_pages", "rows_per_page", "colspan", "rowspan",
    "row", "col", "group", "meaning", "pages", "doc_id", "id", "skew_degrees",
}
# Keys whose values are lists of relations (each item one record).
RELATION_LIST_KEYS = {"points", "edges", "connections", "components", "kpis", "events",
                      "rows", "values", "line_items", "legend", "rooms"}
# Visual result keys holding prose: searchable for facts, never a pairing record.
PROSE_KEYS = {"summary", "description", "scene_description", "notes"}
IOU_MATCH = 0.3
EXTRA_LEAVES_ALLOWED = 2   # a pairing object may hold this many values beyond the relation
PAIR_SLACK_TOKENS = 2      # tokens allowed between a relation's values on one text line


@dataclass(frozen=True)
class Fact:
    page: int
    channel: str          # "image" | "text"
    kind: str             # "number" | "text" | "checkbox" | "relation"
    value: object         # relation: tuple of member Facts
    label: str = ""       # checkbox label, for kind == "checkbox"
    decimals: int = 0     # stated precision, for kind == "number"
    spans: tuple = ()     # other pages a spanning table may match on
    visual: int = field(default=-1, compare=False)  # index of the Ground Truth Visual
    shown: str = field(default="", compare=False)   # the Ground Truth string as written, for display

    def describe(self) -> str:
        if self.kind == "checkbox":
            return f"[{'x' if self.value else ' '}] {self.label}"
        if self.kind == "relation":
            return " | ".join(m.describe() for m in self.value)
        if self.kind == "number":
            return f"{self.value:.{self.decimals}f}"
        return self.shown or str(self.value)


# ------------------------------------------------------------ normalizing

def _norm(s: str) -> str:
    """Lowercase words; a '.' survives only as a decimal point (12.4), not as punctuation."""
    s = re.sub(r"(?<!\d)\.|\.(?!\d)", " ", s.lower())
    return re.sub(r"[^a-z0-9.%$]+", " ", s).strip()


_HYPHENATED_DIGITS = re.compile(r"\d+(?:-\d+)+")      # 2026-09-16, 555-0142
_NUM = re.compile(r"(?<![\w.])-?\d[\d,]*(?:\.\d+)?")


def _numbers_in(text: str) -> list[float]:
    out = []
    for m in _NUM.findall(_HYPHENATED_DIGITS.sub(" ", text)):
        try:
            out.append(float(m.replace(",", "")))
        except ValueError:
            pass
    return out


def _as_number(v) -> tuple[float, int] | None:
    """(value, stated decimal places) for numeric leaves like 13.8, "$4,286.50", "122%"."""
    if isinstance(v, bool):
        return None
    if isinstance(v, int):
        return float(v), 0
    if isinstance(v, float):
        text = repr(v)
        return v, len(text.split(".")[1]) if "." in text and "e" not in text else 0
    if isinstance(v, str):
        m = re.fullmatch(r"\s*[$]?\s*(-?[\d,]+)(\.\d+)?\s*([%MK])?\s*", v)
        if m:
            frac = m.group(2) or ""
            return float(m.group(1).replace(",", "") + frac), max(len(frac) - 1, 0)
    return None


def _is_leaf(v) -> bool:
    return isinstance(v, (str, int, float)) and not isinstance(v, bool)


# ------------------------------------------------------- Ground Truth facts

def _leaf_fact(node, page, channel, spans, visual) -> Fact | None:
    num = _as_number(node)
    if num is not None:
        value, decimals = num
        # Single digits match almost any text; they carry no signal.
        if value.is_integer() and 0 <= value <= 9:
            return None
        return Fact(page, channel, "number", value, decimals=decimals, spans=spans, visual=visual)
    if isinstance(node, str) and len(_norm(node)) >= 2:
        return Fact(page, channel, "text", _norm(node), spans=spans, visual=visual, shown=node.strip())
    return None


def facts_for_visual(vis: dict, index: int = -1) -> list[Fact]:
    page, channel = vis.get("page", 0), vis.get("channel", "image")
    spans = tuple(p for p in vis.get("spans_pages", []) if p != page)
    facts: list[Fact] = []

    def relation(item) -> None:
        if isinstance(item, dict):
            members = [item[k] for k in item if k not in NON_CONTENT_KEYS and _is_leaf(item[k])]
        elif isinstance(item, list):
            members = [m for m in item if _is_leaf(m)]
        else:
            return
        parts = tuple(f for f in (_leaf_fact(m, page, channel, spans, index) for m in members) if f)
        if len(parts) >= 2:
            facts.append(Fact(page, channel, "relation", parts, spans=spans, visual=index))

    def walk(node, key=None):
        if key in NON_CONTENT_KEYS:
            return
        if isinstance(node, dict):
            if "checked" in node and "label" in node:
                facts.append(Fact(page, channel, "checkbox", bool(node["checked"]), node["label"],
                                  spans=spans, visual=index))
                return
            for k, v in node.items():
                walk(v, k)
        elif isinstance(node, list):
            for v in node:
                if key in RELATION_LIST_KEYS:
                    relation(v)
                walk(v, key)
        elif _is_leaf(node):
            f = _leaf_fact(node, page, channel, spans, index)
            if f:
                facts.append(f)

    walk(vis)
    return list(dict.fromkeys(facts))


def facts_from_truth(truth: dict) -> list[Fact]:
    facts = [f for i, v in enumerate(truth.get("visuals", [])) for f in facts_for_visual(v, i)]
    # The same value drawn twice on a page is one fact.
    return list(dict.fromkeys(facts))


# ------------------------------------------------------------ mode output

def _values(node, skip_prose=False) -> list[str]:
    """Leaf values of a Visual's results, never key names."""
    if isinstance(node, dict):
        return [s for k, v in node.items() if not (skip_prose and k in PROSE_KEYS)
                for s in _values(v, skip_prose)]
    if isinstance(node, list):
        return [s for v in node for s in _values(v, skip_prose)]
    return [str(node)] if _is_leaf(node) else []


def _resolve_ids(results: dict) -> dict:
    """AGENTIC diagram connections cite component ids; substitute the component labels."""
    results = json.loads(json.dumps(results))
    details = results.get("details") if isinstance(results, dict) else None
    comps = details.get("components") if isinstance(details, dict) else None
    if isinstance(comps, list):
        labels = {c.get("id"): c.get("label") for c in comps if isinstance(c, dict) and c.get("id")}
        for conn in details.get("connections") or []:
            if isinstance(conn, dict):
                for end in ("from", "to"):
                    if conn.get(end) in labels:
                        conn[end] = labels[conn[end]]
    return results


def _object_records(node, out: list) -> None:
    """Small objects and lists in structured results: (values, leaf count)."""
    if isinstance(node, dict):
        leaves = [str(v) for k, v in node.items() if _is_leaf(v) and k not in PROSE_KEYS]
        if len(leaves) >= 2:
            out.append((" ; ".join(leaves), len(leaves)))
        for k, v in node.items():
            if k not in PROSE_KEYS:
                _object_records(v, out)
    elif isinstance(node, list):
        if len(node) >= 2 and all(_is_leaf(v) for v in node):
            out.append((" ; ".join(str(v) for v in node), len(node)))
        for v in node:
            _object_records(v, out)


@dataclass
class Haystack:
    """Everything one Parse Mode produced for one page, prepared for matching."""
    raw: str
    norm: str
    numbers: list[float]
    lines: list[str]                       # text lines, and key_values-style strings
    table_rows: list[str]                  # markdown table rows
    objects: list[tuple[str, int]]         # (values, leaf count) from structured results

    @classmethod
    def build(cls, text: str, visual_results: list[dict]) -> "Haystack":
        resolved = [_resolve_ids(r) for r in visual_results]
        values = [s for r in resolved for s in _values(r)]
        raw = "\n".join([text] + values)
        lines, rows = [], []
        for line in text.splitlines():
            line = line.strip()
            if line.startswith("|") and not re.fullmatch(r"\|[\s|:-]+\|?", line):
                rows.append(line)
            elif line:
                lines.append(line)
        objects: list[tuple[str, int]] = []
        for r in resolved:
            _object_records(r.get("details", r) if isinstance(r, dict) else r, objects)
            kv = (r.get("details") or {}).get("key_values") if isinstance(r, dict) else None
            lines.extend(s for s in kv or [] if isinstance(s, str))
        return cls(raw, _norm(raw), _numbers_in(raw), lines, rows, objects)


# --------------------------------------------------------------- matching

_CHECKED_MARKS = set("☑☒✓✔✗xXvV")
_UNCHECKED_MARKS = set("☐□")


def _mark_before(prefix: str) -> bool | None:
    if prefix.endswith(("[x]", "[X]")):
        return True
    if prefix.endswith("[ ]"):
        return False
    if prefix and prefix[-1] in _CHECKED_MARKS and (len(prefix) == 1 or not prefix[-2].isalnum()):
        return True
    if prefix and prefix[-1] in _UNCHECKED_MARKS:
        return False
    return None


def _checkbox_found(fact: Fact, raw: str) -> bool:
    """The marker immediately before the label must agree with Ground Truth.

    Each box owns only the mark directly in front of its label, so a two-column
    checklist ("| ☐ Gasket intact | ☑ Labels legible |") is read box by box.
    A label with no mark in front of it is unknown, never assumed unchecked.
    """
    low, label = raw.lower(), fact.label.lower()
    start = 0
    while (i := low.find(label, start)) >= 0:
        start = i + 1
        # A label used by several boxes ("Yes", "No") counts if any of its boxes agrees.
        if _mark_before(raw[max(0, i - 8):i].rstrip(" \t|*-:")) is fact.value:
            return True
    return False


def _number_found(fact: Fact, numbers: list[float]) -> bool:
    if fact.decimals == 0:
        return any(n == fact.value for n in numbers)
    tol = 0.5 * 10 ** -fact.decimals + 1e-9
    return any(abs(n - fact.value) <= tol for n in numbers)


def _in(fact: Fact, norm: str, numbers: list[float]) -> bool:
    if fact.kind == "number":
        return _number_found(fact, numbers)
    return f" {fact.value} " in f" {norm} "


def _token_positions(fact: Fact, tokens: list[str]) -> list[tuple[int, int]]:
    """(start, end) token spans where a member value appears in a tokenized line."""
    if fact.kind == "number":
        hits = []
        for i, t in enumerate(tokens):
            nums = _numbers_in(t)
            if nums and _number_found(fact, nums):
                hits.append((i, i + 1))
        return hits
    want = str(fact.value).split()
    n = len(want)
    return [(i, i + n) for i in range(len(tokens) - n + 1) if tokens[i:i + n] == want]


def _paired_on_line(rel: Fact, line: str) -> bool:
    tokens = _norm(_HYPHENATED_DIGITS.sub(lambda m: m.group(0).replace("-", " "), line)).split()
    spans = [_token_positions(m, tokens) for m in rel.value]
    if not all(spans):
        return False
    # Width counts normalized tokens (the matching form), not the display string from describe().
    width = (sum(len((str(m.value) if m.kind == "text" else m.describe()).split()) for m in rel.value)
             + PAIR_SLACK_TOKENS * (len(rel.value) - 1))

    def best(i, lo, hi):
        if i == len(spans):
            return hi - lo <= width
        return any(best(i + 1, min(lo, s), max(hi, e)) for s, e in spans[i])

    return any(best(1, s, e) for s, e in spans[0])


def _relation_found(rel: Fact, hay: Haystack) -> bool:
    for text, leaves in hay.objects:
        if leaves <= len(rel.value) + EXTRA_LEAVES_ALLOWED and all(
                _in(m, _norm(text), _numbers_in(text)) for m in rel.value):
            return True
    for row in hay.table_rows:
        if all(_in(m, _norm(row), _numbers_in(row)) for m in rel.value):
            return True
    return any(_paired_on_line(rel, line) for line in hay.lines)


def recovered(fact: Fact, hay: Haystack) -> bool:
    if fact.kind == "checkbox":
        return _checkbox_found(fact, hay.raw)
    if fact.kind == "relation":
        return _relation_found(fact, hay)
    return _in(fact, hay.norm, hay.numbers)


# --------------------------------------------------------- Visual detection

def _iou(a: dict, b: dict) -> float:
    x0, y0 = max(a["x0"], b["x0"]), max(a["y0"], b["y0"])
    x1, y1 = min(a["x1"], b["x1"]), min(a["y1"], b["y1"])
    inter = max(0.0, x1 - x0) * max(0.0, y1 - y0)
    area = lambda r: max(0.0, r["x1"] - r["x0"]) * max(0.0, r["y1"] - r["y0"])
    union = area(a) + area(b) - inter
    return inter / union if union else 0.0


def _truth_box(b: dict) -> dict:
    return {"x0": b["top_left_x"], "y0": b["top_left_y"], "x1": b["bottom_right_x"], "y1": b["bottom_right_y"]}


def _visual_label(t: dict) -> str:
    return t.get("title") or t.get("role") or t["image_type"]


def match_visuals(truth: dict, visuals: list[dict], is_image_file: bool) -> list[tuple[int, int | None]]:
    """Pair each detectable Ground Truth Visual with at most one reported Visual.

    visuals: dicts with page, image_type, x0..y1 (normalized, or None for image files).
    A whole-page scan or photo is read as the page itself, not as a Visual on it,
    so it is not expected here; its content is still scored as facts.
    """
    pairs, used = [], set()
    for ti, t in enumerate(truth.get("visuals", [])):
        if t.get("channel") != "image" or t.get("image_type") == "document_page":
            continue
        ok_types = set(t.get("accept_types") or [t["image_type"]])
        hit = None
        for i, v in enumerate(visuals):
            if i in used or v["page"] != t.get("page", 0) or v["image_type"] not in ok_types:
                continue
            if is_image_file or v.get("x0") is None or _iou(_truth_box(t["bbox"]), v) >= IOU_MATCH:
                hit = i  # a whole-file image has one region; no box to compare
                break
        if hit is not None:
            used.add(hit)
        pairs.append((ti, hit))
    return pairs


# ------------------------------------------------------------------ entry

def _markdown_tables(text: str) -> int:
    return len(re.findall(r"^\s*\|?\s*:?-{3,}", text, re.M))


def score_mode(truth: dict, pages: dict[int, str], visuals: list[dict], is_image_file: bool) -> dict:
    """Score one Parse Mode.

    pages:   page index -> page text the mode returned.
    visuals: AGENTIC Visuals: page, visual_id, image_type, results, x0..y1. Empty for OCR/LAYOUT.
    """
    by_page: dict[int, list[dict]] = {}
    for v in visuals:
        by_page.setdefault(v["page"], []).append(v.get("results") or {})
    hay = {p: Haystack.build(pages.get(p, ""), by_page.get(p, [])) for p in set(pages) | set(by_page)}
    empty = Haystack.build("", [])

    result = {"IMAGE_FACTS": 0, "IMAGE_FACTS_FOUND": 0, "TEXT_FACTS": 0, "TEXT_FACTS_FOUND": 0,
              "RELATIONS": 0, "RELATIONS_FOUND": 0}
    missed = []
    for f in facts_from_truth(truth):
        found = any(recovered(f, hay.get(p, empty)) for p in (f.page, *f.spans))
        bucket = "RELATIONS" if f.kind == "relation" else (
            "IMAGE_FACTS" if f.channel == "image" else "TEXT_FACTS")
        result[bucket] += 1
        result[bucket + "_FOUND"] += found
        if not found:
            missed.append({"page": f.page, "channel": f.channel, "fact": f.describe()})

    matches, missed_visuals = [], []
    truth_visuals = truth.get("visuals", [])
    for ti, vi in match_visuals(truth, visuals, is_image_file):
        t = truth_visuals[ti]
        if vi is None:
            missed_visuals.append(_visual_label(t))
            continue
        # Per-Visual accuracy: the Ground Truth Visual's facts against that Visual's results only.
        own = Haystack.build("", [visuals[vi].get("results") or {}])
        facts = facts_for_visual(t, ti)
        missed_here = [f.describe() for f in facts if not recovered(f, own)]
        matches.append({"truth_index": ti, "title": _visual_label(t), "page": t.get("page", 0),
                        "visual_id": visuals[vi].get("visual_id"), "image_type": visuals[vi]["image_type"],
                        "facts": len(facts), "facts_found": len(facts) - len(missed_here),
                        "missed": missed_here})

    text = "\n".join(pages.values())
    result.update(VISUALS_EXPECTED=len(matches) + len(missed_visuals), VISUALS_DETECTED=len(matches),
                  CHARS=len(text), TABLES=_markdown_tables(text), MATCHES=matches,
                  MISSED={"facts": missed, "visuals": missed_visuals})
    return result
