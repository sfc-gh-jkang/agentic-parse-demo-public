"""Industry packs (generator/packs.py): neutral is the committed Corpus byte for byte; every other pack
keeps the structures and Ground Truth single-sourced, and carries no product words."""
import hashlib
import json
from pathlib import Path

import pytest
from pypdf import PdfReader

from generator.packs import PACKS, build_pack
from scoring.score import facts_from_truth
from tests.test_corpus import FORBIDDEN

ROOT = Path(__file__).resolve().parent.parent
CORPUS = ROOT / "corpus"
THEMED = [p for p in PACKS if p != "neutral"]


def _digest(p):
    return hashlib.sha256(p.read_bytes()).hexdigest()


def _pdf_text(path):
    return " ".join(p.extract_text() for p in PdfReader(path).pages)


@pytest.fixture(scope="module")
def built(tmp_path_factory):
    out = {}
    for pack in PACKS:
        d = tmp_path_factory.mktemp(pack)
        out[pack] = (d, build_pack(pack, d))
    return out


def test_neutral_pack_is_the_committed_corpus_byte_for_byte(built):
    d, manifest = built["neutral"]
    for m in manifest:
        for f in (m["file"], m["truth_file"]):
            assert _digest(d / f) == _digest(CORPUS / f), f
    assert _digest(d / "manifest.json") == _digest(CORPUS / "manifest.json")


@pytest.mark.parametrize("pack", THEMED)
def test_pack_keeps_structure_and_values(built, pack):
    d, manifest = built[pack]
    n_dir, n_manifest = built["neutral"]
    assert manifest == n_manifest  # same Documents, same files
    for m in manifest:
        t, n = json.loads((d / m["truth_file"]).read_text()), json.loads((n_dir / m["truth_file"]).read_text())
        assert len(t["visuals"]) == len(n["visuals"])
        # Same Visual structure (type, channel, keys, page). Random values can differ where a renamed name is
        # drawn in handwriting (its length shifts the seeded RNG, e.g. claim_packet moisture readings);
        # truth and document are generated together from the same literals, so they still agree.
        shape = lambda tr: [(v.get("image_type"), v.get("channel"), v.get("page"), sorted(v)) for v in tr["visuals"]]
        assert shape(t) == shape(n), m["doc_id"]
        assert t["pages"] == n["pages"]


@pytest.mark.parametrize("pack", THEMED)
def test_pack_truth_text_appears_in_its_documents(built, pack):
    """Ground Truth is single-sourced: each text-channel text fact of a PDF is in that PDF's text layer
    exactly when the neutral one is in the neutral PDF (same check, both sides)."""
    d, manifest = built[pack]
    n_dir, _ = built["neutral"]
    norm = lambda s: " ".join(str(s).lower().split())
    for m in manifest:
        if not m["file"].endswith(".pdf"):
            continue
        texts = {}
        for side, base in (("pack", d), ("neutral", n_dir)):
            tr = json.loads((base / m["truth_file"]).read_text())
            body = norm(_pdf_text(base / m["file"]))
            texts[side] = [norm(f.value) in body for f in facts_from_truth(tr) if f.channel == "text" and f.kind == "text"]
        assert texts["pack"] == texts["neutral"], m["doc_id"]


@pytest.mark.parametrize("pack", THEMED)
def test_pack_rethemes_and_leaks_no_neutral_names(built, pack):
    d, manifest = built[pack]
    blob = " ".join((d / m["truth_file"]).read_text() for m in manifest)
    blob += " ".join(_pdf_text(d / m["file"]) for m in manifest if m["file"].endswith(".pdf"))
    flat = " ".join(blob.split())
    n_dir, _ = built["neutral"]
    neutral = " ".join((n_dir / m["truth_file"]).read_text() for m in manifest)
    neutral += " ".join(_pdf_text(n_dir / m["file"]) for m in manifest if m["file"].endswith(".pdf"))
    neutral = " ".join(neutral.split())
    for src, dst in PACKS[pack].items():
        if src in neutral:  # visible in text or truth (some keys only reach PDF metadata or images)
            assert dst in flat or dst.upper() in flat, (pack, dst)
    for name in ("Northwind", "NORTHWIND"):
        assert name not in flat, (pack, name)
    assert [w for w in FORBIDDEN if w in flat.lower()] == []
