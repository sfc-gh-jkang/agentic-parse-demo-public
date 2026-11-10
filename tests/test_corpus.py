"""Generator seam: build_corpus(outdir, seed) -> manifest of Documents + Ground Truth.

Expected values below are literals from the Corpus definition in docs/SPEC.md,
not recomputed from generator code.
"""
import hashlib
import json
from pathlib import Path

import pytest
from pypdf import PdfReader

from generator.corpus import build_corpus


def _digest(path):
    return hashlib.sha256(path.read_bytes()).hexdigest()


@pytest.fixture(scope="module")
def corpus(tmp_path_factory):
    out = tmp_path_factory.mktemp("corpus")
    return out, build_corpus(out, seed=42)


def test_same_seed_is_byte_identical(corpus, tmp_path):
    out, manifest = corpus
    again = build_corpus(tmp_path, seed=42)
    for doc in manifest:
        twin = next(d for d in again if d["doc_id"] == doc["doc_id"])
        assert _digest(out / doc["file"]) == _digest(tmp_path / twin["file"])
        assert _digest(out / doc["truth_file"]) == _digest(tmp_path / twin["truth_file"])


def test_tracer_documents_exist(corpus):
    _, manifest = corpus
    assert {d["doc_id"] for d in manifest} >= {
        "quarterly_report", "stamped_invoice", "control_contract"}


def _truth(corpus, doc_id):
    out, manifest = corpus
    doc = next(d for d in manifest if d["doc_id"] == doc_id)
    return out, doc, json.loads((out / doc["truth_file"]).read_text())


def test_quarterly_report_charts_carry_known_values(corpus):
    _, _, truth = _truth(corpus, "quarterly_report")
    charts = {v["title"]: v for v in truth["visuals"] if v["image_type"] == "chart"}
    rev = charts["Quarterly Revenue (USD millions)"]
    assert rev["chart_type"] == "bar"
    assert rev["series"][0]["points"] == [
        {"x": "Q1", "y": 12.4}, {"x": "Q2", "y": 15.1},
        {"x": "Q3", "y": 13.8}, {"x": "Q4", "y": 17.2}]
    assert charts["Active Customers"]["chart_type"] == "line"
    mix = charts["Revenue Mix by Region"]
    assert mix["chart_type"] == "pie"
    assert {p["x"]: p["y"] for p in mix["series"][0]["points"]} == {
        "North America": 46, "EMEA": 31, "APAC": 23}


def test_quarterly_report_embeds_one_image_per_chart(corpus):
    out, doc, truth = _truth(corpus, "quarterly_report")
    reader = PdfReader(out / doc["file"])
    images = sum(len(p.images) for p in reader.pages)
    assert images == len([v for v in truth["visuals"] if v["image_type"] == "chart"]) == 3
    assert len(reader.pages) == truth["pages"] == 2


def test_stamped_invoice_truth(corpus):
    out, doc, truth = _truth(corpus, "stamped_invoice")
    assert {v.get("role") for v in truth["visuals"]} >= {"logo", "stamp", "signature"}
    stamp = next(v for v in truth["visuals"] if v.get("role") == "stamp")
    assert stamp["date"] == "2026-09-14"
    assert set(stamp["accept_types"]) == {"other", "photo_with_text"}
    assert stamp["visible_text"] == "PAID"
    table = next(v for v in truth["visuals"] if v["image_type"] == "table")
    assert table["headers"] == ["Item", "Qty", "Unit Price", "Amount"]
    assert table["total"] == 4286.50
    assert len(PdfReader(out / doc["file"]).pages) == 1


def test_control_contract_has_no_image_visuals(corpus):
    out, doc, truth = _truth(corpus, "control_contract")
    assert [v for v in truth["visuals"] if v["channel"] == "image"] == []
    body = truth["visuals"][0]
    assert body["governing_law"] == "State of Delaware"
    assert body["parties"] == ["Northwind Analytics, Inc.", "Contoso Retail Group"]
    reader = PdfReader(out / doc["file"])
    assert sum(len(p.images) for p in reader.pages) == 0
    assert "MASTER SERVICES AGREEMENT" in reader.pages[0].extract_text()


def test_invoice_table_is_text_channel_and_in_text_layer(corpus):
    out, doc, truth = _truth(corpus, "stamped_invoice")
    table = next(v for v in truth["visuals"] if v["image_type"] == "table")
    assert table["channel"] == "text"
    text = PdfReader(out / doc["file"]).pages[0].extract_text()
    for cell in ["Onboarding workshop", "$850.00", "$4,286.50"]:
        assert cell in text


def test_image_visual_count_matches_embedded_images(corpus):
    out, manifest = corpus
    for doc in manifest:
        if not doc["file"].endswith(".pdf"):
            continue
        truth = json.loads((out / doc["truth_file"]).read_text())
        reader = PdfReader(out / doc["file"])
        for i, page in enumerate(reader.pages):
            expected = [v for v in truth["visuals"] if v["page"] == i and v["channel"] == "image"]
            assert len(page.images) == len(expected), (doc["doc_id"], i)


def test_bboxes_locate_the_images(corpus):
    # The bar chart sits in the left column, the line chart in the right, same row.
    _, _, truth = _truth(corpus, "quarterly_report")
    bar, line = (v["bbox"] for v in truth["visuals"][:2])
    assert bar["bottom_right_x"] < 0.5 < line["top_left_x"]
    assert bar["top_left_y"] == line["top_left_y"]
    assert all(0 <= v <= 1 for b in (bar, line) for v in b.values())


# ------------------------------------------------------------------ T2

def _pdf(corpus, doc_id):
    out, doc, truth = _truth(corpus, doc_id)
    return PdfReader(out / doc["file"]), truth


def _images(truth):
    return [v for v in truth["visuals"] if v["channel"] == "image"]


def test_full_corpus_document_ids(corpus):
    _, manifest = corpus
    assert {d["doc_id"] for d in manifest} >= {
        "inspection_form", "floor_plan_diagram", "scanned_contract", "multipage_rate_table",
        "pitch_deck", "receipt_photo", "whiteboard_photo", "claim_packet"}
    assert len(manifest) == 11


def test_inspection_form(corpus):
    reader, truth = _pdf(corpus, "inspection_form")
    assert len(reader.pages) == truth["pages"] == 2
    assert [len(p.images) for p in reader.pages] == [2, 1]
    assert len(_images(truth)) == 3
    form = next(v for v in truth["visuals"] if v.get("role") == "checklist")
    assert len(form["checkboxes"]) == 8
    states = {c["label"]: c["checked"] for c in form["checkboxes"]}
    assert states["Gasket intact"] is False
    assert states["Weld seams sound"] is True
    assert sum(states.values()) == 6
    notes = next(v for v in truth["visuals"] if v.get("role") == "handwriting")
    assert notes["text"][0] == "Hairline crack at weld, east flange."
    photo = next(v for v in truth["visuals"] if v.get("role") == "defect_photo")
    assert photo["image_type"] == "photo_with_text" and photo["visible_text"] == "D-0417"
    assert photo["page"] == 1
    assert "Equipment Inspection Form" in reader.pages[0].extract_text()


def test_defect_photo_is_large_and_legible(corpus):
    reader, truth = _pdf(corpus, "inspection_form")
    photo = next(v for v in truth["visuals"] if v.get("role") == "defect_photo")
    b = photo["bbox"]
    assert b["bottom_right_x"] - b["top_left_x"] >= 0.6
    img = reader.pages[1].images[0].image.convert("RGB")
    assert img.size[0] >= 1600
    import numpy as np
    a = np.asarray(img).astype(int)
    yellow = int(((a[..., 0] > 200) & (a[..., 1] > 170) & (a[..., 2] < 90)).sum())
    assert yellow > 6000                      # chalk arrow (upper left, brightest)
    soft = (a[..., 0] > 140) & (a[..., 1] > 110) & (a[..., 2] < 90) & (a[..., 0] - a[..., 2] > 90)
    assert soft[780:, 1100:].sum() > 50000    # the yellow tag, lower right
    assert photo["crack"]["location"] == "weld seam at the pipe-to-flange joint"
    cb = photo["crack"]["bbox"]
    assert 0.40 < cb["top_left_x"] < cb["bottom_right_x"] < 0.52
    assert photo["crack"]["location"] in reader.pages[1].extract_text().replace("\n", " ")


def test_floor_plan_diagram(corpus):
    reader, truth = _pdf(corpus, "floor_plan_diagram")
    assert len(reader.pages) == 1
    assert sum(len(p.images) for p in reader.pages) == 1
    d = truth["visuals"][0]
    assert d["image_type"] == "diagram" and d["channel"] == "image"
    assert {r["label"] for r in d["rooms"]} == {
        "Lobby", "Office A", "Office B", "Break Room", "Server Room", "Storage"}
    assert {"label": "Server Room", "width_m": 5.0, "depth_m": 5.0} in [
        {k: r[k] for k in ("label", "width_m", "depth_m")} for r in d["rooms"]]
    assert "16.0 m" in [x["text"] for x in d["dimensions"]]
    assert ["AHU-1", "Server Room"] in [[e["from"], e["to"]] for e in d["connections"]]
    assert ["Rack R1", "Switch SW1"] in [[e["from"], e["to"]] for e in d["connections"]]
    assert d["title_block"] == {"drawing_no": "A-101", "scale": "1:100", "revision": "C",
                                "date": "2026-09-18"}
    assert {l["kind"] for l in d["legend"]} == {"duct", "power", "fiber"}
    assert float(reader.pages[0].mediabox.width) > float(reader.pages[0].mediabox.height)
    assert "A-101" in reader.pages[0].extract_text()


def test_scanned_contract_has_no_text_layer(corpus):
    reader, truth = _pdf(corpus, "scanned_contract")
    assert len(reader.pages) == truth["pages"] == 2
    assert sum(len(p.images) for p in reader.pages) == 2
    assert len("".join(p.extract_text() for p in reader.pages).strip()) < 5
    p0 = next(v for v in truth["visuals"] if v["page"] == 0)
    assert p0["image_type"] == "document_page"
    assert set(p0["accept_types"]) == {"document_page", "other"}
    assert p0["parties"] == ["Northwind Analytics, Inc.", "Fabrikam Logistics Ltd."]
    assert p0["term_months"] == 36
    assert p0["fee_terms"] == "$18,500 per month, payable within 45 days of invoice"
    assert 1.5 <= p0["skew_degrees"] <= 3.0


def test_multipage_rate_table(corpus):
    reader, truth = _pdf(corpus, "multipage_rate_table")
    assert len(reader.pages) == truth["pages"] == 3
    assert [len(p.images) for p in reader.pages] == [0, 0, 1]
    span = next(v for v in truth["visuals"] if v["channel"] == "text")
    assert span["spans_pages"] == [0, 1]
    assert span["headers"] == ["Service Code", "Description", "Unit", "Rate (USD)"]
    assert len(span["rows"]) == 53
    assert span["rows"][0] == ["SVC-100", "Freight, palletized (regional)", "pallet", "$38.50"]
    assert span["rows"][-1] == ["SVC-186", "Mail handling", "month", "$140.00"]
    assert sum(span["rows_per_page"]) == 53 and span["rows_per_page"][0] >= 30
    assert reader.pages[0].extract_text().count("SVC-") == span["rows_per_page"][0]
    assert reader.pages[1].extract_text().count("SVC-") == span["rows_per_page"][1]
    for i in (0, 1):
        text = reader.pages[i].extract_text()
        assert "Service Code" in text and "Rate (USD)" in text
    assert "SVC-100" in reader.pages[0].extract_text()
    assert "SVC-186" in reader.pages[1].extract_text()
    sheet = next(v for v in truth["visuals"] if v["channel"] == "image")
    assert sheet["page"] == 2 and sheet["image_type"] == "table"
    assert sheet["headers"] == ["Region", "Contract Term", "Monthly Volume", "Rate per Pallet"]
    assert {"row": 2, "col": 0, "rowspan": 3, "colspan": 1, "text": "US"} in sheet["merges"]
    assert {"row": 0, "col": 0, "rowspan": 1, "colspan": 4,
            "text": "Service Contract Rate Card 2026"} in sheet["merges"]
    assert sheet["cells"][2] == ["US", "Spot", "100", "$38.50"]


def test_pitch_deck(corpus):
    reader, truth = _pdf(corpus, "pitch_deck")
    assert len(reader.pages) == truth["pages"] == 4
    assert all(float(p.mediabox.width) > float(p.mediabox.height) for p in reader.pages)
    assert [len(p.images) for p in reader.pages] == [0, 1, 1, 1]
    kpi = next(v for v in truth["visuals"] if v["image_type"] == "infographic")
    assert {k["label"]: k["value"] for k in kpi["kpis"]} == {
        "ARR": "$48.2M", "Net revenue retention": "122%",
        "Customers": "2,140", "Gross margin": "78%"}
    chart = next(v for v in truth["visuals"] if v["image_type"] == "chart")
    assert chart["chart_type"] == "stacked_bar"
    plat = next(s for s in chart["series"] if s["name"] == "Platform")
    assert plat["points"][0] == {"x": "FY24", "y": 14.0}
    diagram = next(v for v in truth["visuals"] if v["image_type"] == "diagram")
    assert ["Parse", "Store"] in diagram["edges"]
    assert "Pitch" in reader.pages[0].extract_text() or "Northwind" in reader.pages[0].extract_text()


def _image_file(corpus, doc_id, suffix):
    out, doc, truth = _truth(corpus, doc_id)
    assert doc["file"].endswith(suffix)
    assert truth["pages"] == 1
    from PIL import Image
    img = Image.open(out / doc["file"])
    return img, truth


def test_receipt_photo(corpus):
    img, truth = _image_file(corpus, "receipt_photo", ".jpg")
    assert img.format == "JPEG" and not img.getexif()
    (v,) = truth["visuals"]
    assert v["page"] == 0 and v["channel"] == "image"
    assert v["bbox"] == {"top_left_x": 0, "top_left_y": 0, "bottom_right_x": 1, "bottom_right_y": 1}
    assert v["image_type"] == "document_page"
    assert set(v["accept_types"]) == {"document_page", "photo_with_text"}
    assert v["merchant"] == "Harbor Street Market" and v["date"] == "2026-09-21"
    assert v["total"] == 29.45 and v["subtotal"] == 27.27 and v["tax"] == 2.18
    assert len(v["line_items"]) == 5
    assert {"description": "Oat milk x2", "amount": 6.50} in v["line_items"]


def test_whiteboard_photo(corpus):
    img, truth = _image_file(corpus, "whiteboard_photo", ".png")
    assert img.format == "PNG"
    (v,) = truth["visuals"]
    assert v["bbox"] == {"top_left_x": 0, "top_left_y": 0, "bottom_right_x": 1, "bottom_right_y": 1}
    assert v["image_type"] == "photo_with_text" and set(v["accept_types"]) == {"photo_with_text", "diagram"}
    assert v["nodes"] == ["Ingest", "Parse", "Search", "Agent"]
    assert v["edges"] == [["Ingest", "Parse"], ["Parse", "Search"], ["Search", "Agent"]]
    assert "charts" in v["bullets"]


# ------------------------------------------------- Check 1 feedback

FORBIDDEN = ["snowflake", "snowpipe", "snowpark", "credit", "cortex", "dynamic table",
             "warehouse credit"]


def test_no_product_words_anywhere_in_corpus(corpus):
    out, manifest = corpus
    blobs = [(out / "manifest.json").read_text()]
    for d in manifest:
        blobs.append((out / d["truth_file"]).read_text())
        if d["file"].endswith(".pdf"):
            blobs.append(" ".join(p.extract_text() for p in PdfReader(out / d["file"]).pages))
            blobs.append(str(PdfReader(out / d["file"]).metadata))
    text = " ".join(blobs).lower()
    assert [w for w in FORBIDDEN if w in text] == []


def test_rate_table_uses_generic_services(corpus):
    _, _, truth = _truth(corpus, "multipage_rate_table")
    span = next(v for v in truth["visuals"] if v["channel"] == "text")
    units = {r[2] for r in span["rows"]}
    assert {"hour", "day", "pallet", "parcel", "sq ft-month", "visit"} <= units
    assert "credit" not in units


CATEGORIES = ["Mitigation", "Structure", "Flooring", "Plumbing", "Electrical", "Contents", "Finishes"]


def test_claim_packet_structure(corpus):
    reader, truth = _pdf(corpus, "claim_packet")
    assert len(reader.pages) == truth["pages"] == 6
    assert all(float(p.mediabox.height) > float(p.mediabox.width) for p in reader.pages)
    assert [len(p.images) for p in reader.pages] == [3, 2, 3, 2, 1, 3]
    for i, page in enumerate(reader.pages):
        assert len(page.images) == len([v for v in _images(truth) if v["page"] == i]), i
    assert reader.pages[1].extract_text().strip() == ""
    assert reader.pages[4].extract_text().strip() == ""
    p1 = reader.pages[0].extract_text()
    assert "CLM-2026-0912" in p1 and "2026-09-12" in p1
    assert {v.get("role") for v in truth["visuals"] if v["page"] == 0} == {"logo", "stamp", "signature"}
    stamp = next(v for v in truth["visuals"] if v.get("role") == "stamp" and v["page"] == 0)
    assert stamp["visible_text"] == "RECEIVED" and stamp["date"] == "2026-09-16"


def test_claim_packet_scanned_form(corpus):
    _, truth = _pdf(corpus, "claim_packet")
    form = next(v for v in truth["visuals"] if v["page"] == 1 and v["image_type"] == "document_page")
    assert form["bbox"] == {"top_left_x": 0, "top_left_y": 0, "bottom_right_x": 1, "bottom_right_y": 1}
    assert form["fields"] == {"claimant": "Northwind Analytics, Inc.", "policy_number": "PL-2026-44718",
                              "date_of_loss": "2026-09-12", "cause_of_loss": "burst pipe",
                              "estimated_loss": "$36,545.00"}
    checked = {(c["group"], c["label"]) for c in form["checkboxes"] if c["checked"]}
    assert checked == {("Type of loss", "Water"), ("Photos attached", "Yes"), ("Report filed", "No")}
    assert 1.5 <= form["context"]["skew_degrees"] <= 3.0
    sticky = next(v for v in truth["visuals"] if v.get("role") == "sticky_note")
    assert sticky["page"] == 1 and sticky["text"]
    sb, fb = sticky["bbox"], form["bbox"]
    assert fb["top_left_x"] <= sb["top_left_x"] and sb["bottom_right_x"] <= fb["bottom_right_x"]
    assert fb["top_left_y"] <= sb["top_left_y"] and sb["bottom_right_y"] <= fb["bottom_right_y"]


def test_claim_packet_collage_page(corpus):
    reader, truth = _pdf(corpus, "claim_packet")
    p3 = [v for v in _images(truth) if v["page"] == 2]
    photos = [v for v in p3 if v["image_type"] == "photo_with_text"]
    assert sorted(v["visible_text"] for v in photos) == ["2026-09-13 08:42", "2026-09-13 08:47"]
    sketch = next(v for v in p3 if v["image_type"] == "diagram")
    assert sketch["leak"]["room"] == "Server Room"
    assert "Server Room" in reader.pages[2].extract_text()


def test_claim_packet_estimate_page(corpus):
    reader, truth = _pdf(corpus, "claim_packet")
    table = next(v for v in truth["visuals"] if v["channel"] == "text")
    assert table["page"] == 3 and table["total"] == 36545.0
    assert table["headers"] == ["Item", "Category", "Qty", "Unit", "Unit Price", "Amount"]
    assert ["Flooring replacement", "Flooring", "480", "sq ft", "$18.00", "$8,640.00"] in table["rows"]
    text = reader.pages[3].extract_text()
    assert "$36,545.00" in text and "$8,640.00" in text
    bar = next(v for v in truth["visuals"] if v.get("chart_type") == "bar")
    assert bar["series"][0]["points"] == [
        {"x": "Mitigation", "y": 4250.0}, {"x": "Structure", "y": 6965.0},
        {"x": "Flooring", "y": 8640.0}, {"x": "Plumbing", "y": 6300.0},
        {"x": "Electrical", "y": 3150.0}, {"x": "Contents", "y": 5800.0},
        {"x": "Finishes", "y": 1440.0}]
    pie = next(v for v in truth["visuals"] if v.get("chart_type") == "pie")
    assert pie["series"][0]["points"] == [{"x": "Covered", "y": 29305.0}, {"x": "Uncovered", "y": 7240.0}]


def test_claim_packet_rotated_heatmap_page(corpus):
    _, truth = _pdf(corpus, "claim_packet")
    hm = next(v for v in truth["visuals"] if v["page"] == 4)
    assert hm["image_type"] == "chart" and hm["chart_type"] == "heatmap"
    assert set(hm["accept_types"]) == {"chart", "table"}
    assert hm["row_labels"] == ["A", "B", "C", "D", "E", "F"]
    assert hm["col_labels"] == ["1", "2", "3", "4", "5", "6", "7", "8"]
    assert hm["max_cell"] == {"row": "C", "col": "5", "value": 38.5}
    assert hm["values"][2][4] == 38.5 and max(max(r) for r in hm["values"]) == 38.5
    assert hm["context"]["content_rotation_degrees_ccw"] == 90


def test_claim_packet_summary_page(corpus):
    reader, truth = _pdf(corpus, "claim_packet")
    p6 = [v for v in _images(truth) if v["page"] == 5]
    tl = next(v for v in p6 if v["image_type"] == "infographic")
    assert [(e["label"], e["date"]) for e in tl["events"]] == [
        ("Date of loss", "2026-09-12"), ("Claim reported", "2026-09-16"),
        ("Site inspection", "2026-09-19"), ("Claim approved", "2026-09-26")]
    stamp = next(v for v in p6 if v.get("role") == "stamp")
    assert stamp["visible_text"] == "APPROVED" and stamp["date"] == "2026-09-26"
    text = reader.pages[5].extract_text()
    assert "$26,805.00" in text


AGENTIC_IMAGE_TYPES = {"chart", "table", "diagram", "screenshot", "document_page",
                       "infographic", "photo_with_text", "other"}


def test_truth_image_types_are_valid_agentic_types(corpus):
    # Enum from docs.snowflake.com/en/user-guide/snowflake-cortex/parse-document#agentic-mode
    out, manifest = corpus
    for doc in manifest:
        for v in json.loads((out / doc["truth_file"]).read_text())["visuals"]:
            assert v["image_type"] in AGENTIC_IMAGE_TYPES, (doc["doc_id"], v["image_type"])
            assert set(v.get("accept_types", [])) <= AGENTIC_IMAGE_TYPES, doc["doc_id"]


def test_claim_insurer_is_fictional():
    """The claim packet's insurer must be an invented name, never a real (or former) carrier."""
    from generator import corpus
    assert corpus.CLAIM["insurer"] == "Tallowmere Mutual Insurance Co."
    src = (Path(__file__).resolve().parents[1] / "generator" / "corpus.py").read_text()
    retired = "Meri" + "dian Mutual"  # previous name, kept out of the source as a literal
    assert retired not in src
