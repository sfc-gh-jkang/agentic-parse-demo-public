"""Synthetic Corpus generator.

build_corpus(outdir, seed) writes each Document plus a <doc_id>.truth.json
holding its Ground Truth, and returns a manifest.

Ground Truth conventions: `page` is 0-based. `channel` is "image" for an
embedded raster (what AGENTIC reports in images[], with `bbox` normalized 0-1,
top-left origin) or "text" for vector content scored from each mode's text.
`context` holds informational values not visible inside the Visual; never scored. Output is byte-identical
for a given seed (reportlab invariant mode, fixed PNG metadata).
"""
from __future__ import annotations

import io
import json
import math
import random
from pathlib import Path

import matplotlib
import numpy as np

matplotlib.use("Agg")
import matplotlib.pyplot as plt  # noqa: E402
from PIL import Image, ImageDraw, ImageFont  # noqa: E402
from reportlab import rl_config  # noqa: E402
from reportlab.lib import colors  # noqa: E402
from PIL import ImageChops, ImageFilter  # noqa: E402
from reportlab.lib.pagesizes import landscape, letter  # noqa: E402
from reportlab.lib.styles import ParagraphStyle, getSampleStyleSheet  # noqa: E402
from reportlab.lib.units import inch  # noqa: E402
from reportlab.lib.utils import ImageReader  # noqa: E402
from reportlab.pdfgen import canvas  # noqa: E402
from reportlab.platypus import Paragraph, Table, TableStyle  # noqa: E402

rl_config.invariant = 1
plt.rcParams.update({"font.family": "DejaVu Sans", "svg.hashsalt": "corpus"})

W, H = letter
COMPANY = "Northwind Analytics, Inc."


# ---------------------------------------------------------------- helpers

def _png(fig) -> ImageReader:
    buf = io.BytesIO()
    fig.tight_layout()
    fig.savefig(buf, format="png", dpi=150, metadata={"Software": None})
    plt.close(fig)
    buf.seek(0)
    return ImageReader(buf)


def _pil(img: Image.Image) -> ImageReader:
    buf = io.BytesIO()
    img.save(buf, format="PNG", optimize=False)
    buf.seek(0)
    return ImageReader(buf)


def _font(size: int) -> ImageFont.FreeTypeFont:
    path = Path(matplotlib.get_data_path()) / "fonts/ttf/DejaVuSans-Bold.ttf"
    return ImageFont.truetype(str(path), size)


def _canvas(path: Path, title: str, pagesize=letter) -> canvas.Canvas:
    c = canvas.Canvas(str(path), pagesize=pagesize, invariant=1)
    c.setTitle(title)
    c.setAuthor(COMPANY)
    return c


def _place(c, img: ImageReader, x, y, w, h, page=(W, H), **kw) -> dict:
    """Draw an embedded image and return its bbox, normalized 0-1, top-left origin."""
    pw, ph = page
    c.drawImage(img, x, y, width=w, height=h, **kw)
    return {"top_left_x": round(x / pw, 4), "top_left_y": round((ph - y - h) / ph, 4),
            "bottom_right_x": round((x + w) / pw, 4), "bottom_right_y": round((ph - y) / ph, 4)}


def _paragraphs(c, texts, x, y, width, style="BodyText"):
    st = getSampleStyleSheet()[style]
    for t in texts:
        p = Paragraph(t, st)
        _, h = p.wrap(width, H)
        p.drawOn(c, x, y - h)
        y -= h + 6
    return y


# ------------------------------------------------------- quarterly report

def _quarterly_report(out: Path, rng: random.Random) -> dict:
    revenue = [("Q1", 12.4), ("Q2", 15.1), ("Q3", 13.8), ("Q4", 17.2)]
    customers = [("Jan", 1820), ("Feb", 1905), ("Mar", 1990), ("Apr", 2140),
                 ("May", 2210), ("Jun", 2385)]
    mix = [("North America", 46), ("EMEA", 31), ("APAC", 23)]

    fig, ax = plt.subplots(figsize=(4, 3))
    ax.bar([q for q, _ in revenue], [v for _, v in revenue], color="#29B5E8")
    for q, v in revenue:
        ax.text(q, v + 0.3, f"{v}", ha="center", fontsize=8)
    ax.set_title("Quarterly Revenue (USD millions)", fontsize=10)
    ax.set_ylabel("USD millions")
    bar = _png(fig)

    fig, ax = plt.subplots(figsize=(4, 3))
    ax.plot([m for m, _ in customers], [v for _, v in customers], marker="o", color="#11567F")
    ax.set_title("Active Customers", fontsize=10)
    ax.set_ylabel("Customers")
    line = _png(fig)

    fig, ax = plt.subplots(figsize=(4, 3))
    ax.pie([v for _, v in mix], labels=[r for r, _ in mix], autopct="%d%%",
           colors=["#29B5E8", "#71D3DC", "#FF9F36"], startangle=90)
    ax.set_title("Revenue Mix by Region", fontsize=10)
    pie = _png(fig)

    path = out / "quarterly_report.pdf"
    c = _canvas(path, "FY26 Quarterly Business Review")
    c.setFont("Helvetica-Bold", 18)
    c.drawString(0.75 * inch, H - 0.9 * inch, f"{COMPANY} - FY26 Business Review")
    col = (W - 2 * 0.75 * inch - 0.3 * inch) / 2
    left = [
        "<b>Executive summary.</b> Revenue grew in three of four quarters, finishing "
        "the year at a Q4 high. Q3 softness reflects a delayed EMEA renewal cycle.",
        "<b>Customers.</b> Active customers rose every month of the first half.",
    ]
    right = [
        "<b>Regional mix.</b> North America remains the largest region; APAC is the "
        "fastest growing from a smaller base.",
        "<b>Outlook.</b> Management expects continued growth driven by expansion "
        "within existing accounts.",
    ]
    top = H - 1.3 * inch
    _paragraphs(c, left, 0.75 * inch, top, col)
    _paragraphs(c, right, 0.75 * inch + col + 0.3 * inch, top, col)
    bar_box = _place(c, bar, 0.75 * inch, H - 5.6 * inch, col, col * 0.75)
    line_box = _place(c, line, 0.75 * inch + col + 0.3 * inch, H - 5.6 * inch, col, col * 0.75)
    _paragraphs(c, ["<b>Notes.</b> Revenue is recognized ratably. Customer counts are month-end "
                    "active paying accounts. Figures are unaudited."],
                0.75 * inch, H - 5.9 * inch, W - 1.5 * inch)
    c.showPage()
    c.setFont("Helvetica-Bold", 14)
    c.drawString(0.75 * inch, H - 0.9 * inch, "Regional performance")
    pie_box = _place(c, pie, 1.5 * inch, H - 6 * inch, 4.5 * inch, 4.5 * 0.75 * inch)
    _paragraphs(c, ["Regional percentages are share of FY26 total revenue."],
                0.75 * inch, H - 6.3 * inch, W - 1.5 * inch)
    c.showPage()
    c.save()

    def pts(rows):
        return [{"x": x, "y": y} for x, y in rows]

    return path, {"pages": 2, "visuals": [
        {"page": 0, "channel": "image", "bbox": bar_box, "image_type": "chart", "chart_type": "bar",
         "title": "Quarterly Revenue (USD millions)", "y_axis": {"label": "USD millions"},
         "series": [{"points": pts(revenue)}], "context": {"series_name": "Revenue"}},
        {"page": 0, "channel": "image", "bbox": line_box, "image_type": "chart", "chart_type": "line",
         "title": "Active Customers", "y_axis": {"label": "Customers"},
         "series": [{"points": pts(customers)}], "context": {"series_name": "Customers"}},
        {"page": 1, "channel": "image", "bbox": pie_box, "image_type": "chart", "chart_type": "pie",
         "title": "Revenue Mix by Region", "series": [{"points": pts(mix)}],
         "context": {"series_name": "Share %"}},
    ]}


# --------------------------------------------------------- stamped invoice

STAMP_TEXT, STAMP_DATE = "PAID", "2026-09-14"
LOGO_TEXT = "NORTHWIND"
SIGNER = "Dana Whitfield"


def _stamp(text: str, date: str, rng: random.Random, size: int = 120,
           color=(200, 30, 40, 210)) -> Image.Image:
    img = Image.new("RGBA", (520, 240), (0, 0, 0, 0))
    d = ImageDraw.Draw(img)
    red = color
    d.rounded_rectangle((10, 10, 510, 230), radius=24, outline=red, width=12)
    d.text((260, 95), text, fill=red, font=_font(size), anchor="mm")
    d.text((260, 190), date, fill=red, font=_font(34), anchor="mm")
    for _ in range(900):  # ink wear
        x, y = rng.randrange(520), rng.randrange(240)
        d.point((x, y), fill=(0, 0, 0, 0))
    return img.rotate(-14, expand=True, resample=Image.BICUBIC)


def _signature(rng: random.Random) -> Image.Image:
    """Cursive-looking pen stroke: loops along a baseline, plus an underline flourish."""
    import math

    img = Image.new("RGBA", (640, 180), (0, 0, 0, 0))
    d = ImageDraw.Draw(img)
    ink = (20, 40, 120, 255)
    pts, x = [], 30.0
    for i in range(9):  # one loop per letter
        h = rng.uniform(35, 75) if i in (0, 5) else rng.uniform(18, 34)
        w = rng.uniform(34, 50)
        for k in range(24):
            t = k / 23 * 2 * math.pi
            pts.append((x + w * k / 23 + 10 * math.sin(t), 110 - h * (1 - math.cos(t)) / 2))
        x += w
    d.line(pts, fill=ink, width=5, joint="curve")
    d.line([(40, 135), (x * 0.55, 128), (x + 10, 140)], fill=ink, width=4, joint="curve")
    return img.rotate(4, expand=True, resample=Image.BICUBIC)


def _place_logo(c, x, y) -> dict:
    logo = _logo()
    h = 0.7 * inch
    return _place(c, _pil(logo), x, y, h * logo.width / logo.height, h)


def _logo() -> Image.Image:
    font = _font(56)
    text_w = int(font.getlength(LOGO_TEXT))
    img = Image.new("RGB", (140 + text_w + 30, 140), (17, 86, 127))
    d = ImageDraw.Draw(img)
    d.ellipse((20, 20, 120, 120), fill=(41, 181, 232))
    d.text((140, 70), LOGO_TEXT, fill="white", font=font, anchor="lm")
    return img


def _stamped_invoice(out: Path, rng: random.Random) -> dict:
    lines = [("Data platform subscription (annual)", 1, 3200.00),
             ("Onboarding workshop", 2, 425.00),
             ("Premium support add-on", 1, 236.50)]
    headers = ["Item", "Qty", "Unit Price", "Amount"]
    rows = [[i, str(q), f"${p:,.2f}", f"${q * p:,.2f}"] for i, q, p in lines]
    total = round(sum(q * p for _, q, p in lines), 2)

    path = out / "stamped_invoice.pdf"
    c = _canvas(path, "Invoice INV-2026-0917")
    logo_box = _place_logo(c, 0.75 * inch, H - 1.45 * inch)
    c.setFont("Helvetica-Bold", 22)
    c.drawRightString(W - 0.75 * inch, H - 1.0 * inch, "INVOICE")
    c.setFont("Helvetica", 10)
    for i, t in enumerate(["Invoice #: INV-2026-0917", "Date: 2026-09-01",
                           "Due: 2026-10-01", "Bill to: Contoso Retail Group"]):
        c.drawRightString(W - 0.75 * inch, H - 1.3 * inch - i * 14, t)
    t = Table([headers] + rows + [["", "", "Total", f"${total:,.2f}"]],
              colWidths=[3.4 * inch, 0.6 * inch, 1.3 * inch, 1.4 * inch])
    t.setStyle(TableStyle([
        ("BACKGROUND", (0, 0), (-1, 0), colors.HexColor("#11567F")),
        ("TEXTCOLOR", (0, 0), (-1, 0), colors.white),
        ("GRID", (0, 0), (-1, -2), 0.5, colors.grey),
        ("FONTNAME", (2, -1), (-1, -1), "Helvetica-Bold"),
        ("ALIGN", (1, 0), (-1, -1), "RIGHT"),
    ]))
    _, th = t.wrap(W, H)
    t.drawOn(c, 0.75 * inch, H - 2.6 * inch - th)
    stamp_box = _place(c, _pil(_stamp(STAMP_TEXT, STAMP_DATE, rng)), 4.3 * inch, 3.2 * inch,
                       2.6 * inch, 1.6 * inch, mask="auto")
    sig_box = _place(c, _pil(_signature(rng)), 0.75 * inch, 1.6 * inch, 2.6 * inch, 0.7 * inch,
                     mask="auto")
    c.line(0.75 * inch, 1.55 * inch, 3.4 * inch, 1.55 * inch)
    c.setFont("Helvetica", 9)
    c.drawString(0.75 * inch, 1.38 * inch, f"Authorized signature - {SIGNER}, Controller")
    c.showPage()
    c.save()

    return path, {"pages": 1, "visuals": [
        {"page": 0, "channel": "image", "bbox": logo_box, "image_type": "other", "role": "logo",
         "visible_text": LOGO_TEXT},
        {"page": 0, "channel": "text", "image_type": "table", "headers": headers, "rows": rows,
         "total": total},
        {"page": 0, "channel": "image", "bbox": stamp_box, "image_type": "other",
         "accept_types": ["other", "photo_with_text"], "role": "stamp",
         "visible_text": STAMP_TEXT, "date": STAMP_DATE},
        {"page": 0, "channel": "image", "bbox": sig_box, "image_type": "other", "role": "signature",
         "context": {"caption_signer": SIGNER}},
    ]}


# --------------------------------------------------------- control contract

def _control_contract(out: Path, rng: random.Random) -> dict:
    path = out / "control_contract.pdf"
    c = _canvas(path, "Master Services Agreement")
    c.setFont("Helvetica-Bold", 16)
    c.drawCentredString(W / 2, H - 1 * inch, "MASTER SERVICES AGREEMENT")
    effective, customer, law = "2026-08-03", "Contoso Retail Group", "State of Delaware"
    clauses = [
        f"This Master Services Agreement is entered into on {effective} between {COMPANY} "
        f"(\"Provider\") and {customer} (\"Customer\").",
        "<b>1. Services.</b> Provider will deliver the services described in each "
        "Statement of Work executed under this Agreement.",
        "<b>2. Fees.</b> Customer will pay fees within thirty (30) days of invoice.",
        "<b>3. Term.</b> This Agreement begins on the Effective Date and continues for "
        "twenty-four (24) months unless terminated earlier under Section 7.",
        "<b>4. Confidentiality.</b> Each party will protect the other's Confidential "
        "Information with at least reasonable care.",
        "<b>5. Limitation of liability.</b> Neither party's aggregate liability will "
        "exceed the fees paid in the twelve (12) months before the claim.",
        f"<b>6. Governing law.</b> This Agreement is governed by the laws of the {law}.",
        "<b>7. Termination.</b> Either party may terminate on sixty (60) days written notice.",
    ]
    _paragraphs(c, clauses, 0.9 * inch, H - 1.4 * inch, W - 1.8 * inch)
    c.showPage()
    c.save()
    # Text-channel facts only: every Parse Mode should recover all of them.
    return path, {"pages": 1, "visuals": [
        {"page": 0, "channel": "text", "image_type": "document_page", "role": "body",
         "title": "MASTER SERVICES AGREEMENT", "effective_date": effective,
         "parties": [COMPANY, customer], "governing_law": law,
         "clauses": ["Services", "Fees", "Term", "Confidentiality", "Limitation of liability",
                     "Governing law", "Termination"]}]}



# ============================================================== T2 helpers

FULL_BBOX = {"top_left_x": 0, "top_left_y": 0, "bottom_right_x": 1, "bottom_right_y": 1}
INK = (24, 48, 130)


def _ttf(name: str, size: int) -> ImageFont.FreeTypeFont:
    return ImageFont.truetype(str(Path(matplotlib.get_data_path()) / "fonts/ttf" / name), size)


def _nprng(rng: random.Random) -> np.random.Generator:
    return np.random.default_rng(rng.randrange(2**32))


def _jpeg(img: Image.Image, quality: int = 78) -> ImageReader:
    buf = io.BytesIO()
    img.convert("RGB").save(buf, format="JPEG", quality=quality)
    buf.seek(0)
    return ImageReader(buf)


def _wobble(img: Image.Image, nrng: np.random.Generator, amp: float, wl: float) -> Image.Image:
    """Smooth sinusoidal displacement: straight strokes become hand-wavy."""
    a = np.asarray(img)
    h, w = a.shape[:2]
    ys, xs = np.mgrid[0:h, 0:w].astype(np.float32)
    p = nrng.uniform(0, 6.28, 4)
    dx = amp * (np.sin(ys / wl + p[0]) + 0.5 * np.sin(xs / (wl * 0.7) + p[1]))
    dy = amp * (np.sin(xs / wl + p[2]) + 0.5 * np.sin(ys / (wl * 0.7) + p[3]))
    sx = np.clip((xs + dx).round().astype(int), 0, w - 1)
    sy = np.clip((ys + dy).round().astype(int), 0, h - 1)
    return Image.fromarray(a[sy, sx])


def _hand_mask(size, items, rng: random.Random) -> Image.Image:
    """Handwriting ink mask: per-glyph jitter in size, rotation and baseline, then a wobble warp."""
    mask = Image.new("L", size, 0)
    for (x, y), text, px in items:
        for ch in text:
            f = _ttf("DejaVuSans-BoldOblique.ttf", int(px * rng.uniform(0.9, 1.1)))
            g = Image.new("L", (px * 2, px * 2), 0)
            ImageDraw.Draw(g).text((px // 2, px // 2), ch, fill=255, font=f)
            g = g.rotate(rng.uniform(-7, 7), resample=Image.BICUBIC)
            ox, oy = int(x) - px // 2, int(y + rng.uniform(-4, 4)) - px // 2
            region = mask.crop((ox, oy, ox + g.width, oy + g.height))
            mask.paste(ImageChops.lighter(region, g.crop((0, 0, region.width, region.height))), (ox, oy))
            x += f.getlength(ch) * rng.uniform(0.82, 0.95)
    mask = _wobble(mask, _nprng(rng), 1.6, 34).filter(ImageFilter.MinFilter(3))
    return mask.filter(ImageFilter.GaussianBlur(0.7))


def _stroke(d: ImageDraw.ImageDraw, pts, rng: random.Random, fill, width=5, jitter=1.6):
    """Hand-drawn polyline: densified, jittered, with round joins."""
    dense = []
    for (x0, y0), (x1, y1) in zip(pts, pts[1:]):
        n = max(2, int(math.hypot(x1 - x0, y1 - y0) / 14))
        for k in range(n):
            t = k / n
            dense.append((x0 + (x1 - x0) * t + rng.gauss(0, jitter), y0 + (y1 - y0) * t + rng.gauss(0, jitter)))
    dense.append(pts[-1])
    d.line(dense, fill=fill, width=width, joint="curve")
    for x, y in (dense[0], dense[-1]):
        d.ellipse((x - width / 2, y - width / 2, x + width / 2, y + width / 2), fill=fill)


def _arrow(d, p0, p1, rng, fill, width=5):
    _stroke(d, [p0, p1], rng, fill, width)
    ang = math.atan2(p1[1] - p0[1], p1[0] - p0[0])
    for da in (2.6, -2.6):
        _stroke(d, [p1, (p1[0] + 26 * math.cos(ang + da), p1[1] + 26 * math.sin(ang + da))], rng, fill, width, 0.8)


def _coeffs(dst, src):
    a, b = [], []
    for (x, y), (X, Y) in zip(dst, src):
        a += [[x, y, 1, 0, 0, 0, -X * x, -X * y], [0, 0, 0, x, y, 1, -Y * x, -Y * y]]
        b += [X, Y]
    return np.linalg.solve(np.array(a, float), np.array(b, float)).tolist()


def _warp(img: Image.Image, size, quad) -> Image.Image:
    """Map img's corners onto quad (tl, tr, br, bl) inside a canvas of `size`."""
    src = [(0, 0), (img.width, 0), (img.width, img.height), (0, img.height)]
    return img.transform(size, Image.PERSPECTIVE, _coeffs(quad, src), Image.BICUBIC)


def _photo_finish(img: Image.Image, nrng: np.random.Generator, light=0.35, noise=5.0, blur=1.0,
                  glare=None) -> Image.Image:
    a = np.asarray(img.convert("RGB")).astype(np.float32)
    h, w = a.shape[:2]
    ys, xs = np.mgrid[0:h, 0:w].astype(np.float32)
    shade = 1 - light * (0.55 * xs / w + 0.45 * ys / h)           # uneven lighting
    vig = 1 - 0.25 * (((xs / w - .5) ** 2 + (ys / h - .5) ** 2) * 2)
    a *= (shade * vig)[..., None]
    if glare:
        gx, gy, gr = glare
        a += 70 * np.exp(-(((xs - gx * w) ** 2 + (ys - gy * h) ** 2) / (2 * (gr * w) ** 2)))[..., None]
    a += nrng.normal(0, noise, a.shape)
    out = Image.fromarray(np.clip(a, 0, 255).astype(np.uint8))
    return out.filter(ImageFilter.GaussianBlur(blur))


def _wrap(text: str, font, width: int) -> list[str]:
    lines, cur = [], ""
    for word in text.split():
        t = f"{cur} {word}".strip()
        if font.getlength(t) <= width:
            cur = t
        else:
            lines.append(cur)
            cur = word
    return lines + [cur]


# ---------------------------------------------------------- inspection form

CHECKLIST = [("Gasket intact", False), ("No visible corrosion", True), ("Weld seams sound", True),
             ("Bolts torqued to spec", True), ("Labels legible", True), ("Guard in place", False),
             ("No leaks observed", True), ("Grounding connected", True)]
NOTES = ["Hairline crack at weld, east flange.", "Recommend replace gasket before Q4.",
         "Re-inspect in 30 days - R. Okafor"]
DEFECT_TAG = "D-0417"


def _checklist_image(rng: random.Random) -> Image.Image:
    w, h = 1400, 700
    img = Image.new("RGB", (w, h), (252, 250, 243))
    d = ImageDraw.Draw(img)
    d.rectangle((6, 6, w - 7, h - 7), outline=(60, 60, 60), width=4)
    d.rectangle((6, 6, w - 7, 84), fill=(228, 232, 238), outline=(60, 60, 60), width=4)
    d.text((30, 45), "SECTION B - VISUAL CHECKS", fill=(30, 30, 30), font=_ttf("DejaVuSans-Bold.ttf", 38), anchor="lm")
    label = _ttf("DejaVuSans.ttf", 36)
    ink = Image.new("RGBA", (w, h), (0, 0, 0, 0))
    idraw = ImageDraw.Draw(ink)
    for i, (name, checked) in enumerate(CHECKLIST):
        col, row = divmod(i, 4)
        x, y = 40 + col * 700, 100 + row * 148
        d.rectangle((x, y + 30, x + 62, y + 92), outline=(30, 30, 30), width=4)
        d.text((x + 90, y + 61), name, fill=(30, 30, 30), font=label, anchor="lm")
        d.line((x, y + 124, x + 640, y + 124), fill=(190, 190, 190), width=2)
        if checked:
            _stroke(idraw, [(x + 10, y + 62), (x + 26, y + 82), (x + 56, y + 30)], rng, INK + (255,), 7)
    img = Image.alpha_composite(img.convert("RGBA"), ink).convert("RGB")
    return img


def _notes_image(rng: random.Random) -> Image.Image:
    w, h = 1400, 360
    img = Image.new("RGB", (w, h), (253, 249, 232))
    d = ImageDraw.Draw(img)
    for y in range(95, h, 100):
        d.line((20, y, w - 20, y), fill=(170, 195, 225), width=2)
    items = [((40, 70 + 100 * i), t, 56) for i, t in enumerate(NOTES)]
    mask = _hand_mask((w, h), items, rng)
    img.paste(Image.new("RGB", (w, h), INK), mask=mask)
    return img


CRACK_LOCATION = "weld seam at the pipe-to-flange joint"
PHOTO_SIZE = (1800, 1350)


def _smooth_noise(nrng, w, h, cell):
    g = nrng.normal(0, 1, (h // cell + 2, w // cell + 2)).astype(np.float32)
    return np.asarray(Image.fromarray(g).resize((w, h), Image.BICUBIC))


def _mask(size, fn) -> np.ndarray:
    m = Image.new("L", size, 0)
    fn(ImageDraw.Draw(m))
    return np.asarray(m).astype(np.float32) / 255


def _crack_points(rng: random.Random):
    pts, x, y = [], 817.0, 470.0
    while y < 890:
        pts.append((x, y))
        x = min(max(x + rng.uniform(-14, 14), 800), 836)
        y += rng.uniform(14, 26)
    return pts


def _defect_photo(rng: random.Random):
    """Synthetic photo of a steel pipe flange with a cracked weld seam, rust, tag and chalk arrow.

    Returns (image, crack_bbox) with the bbox normalized to the image."""
    nrng = _nprng(rng)
    w, h = PHOTO_SIZE
    cy = 675
    ys, xs = np.mgrid[0:h, 0:w].astype(np.float32)
    crack = _crack_points(rng)
    sm = _smooth_noise(nrng, w, h, 60)
    fine = nrng.normal(0, 1, (h, w)).astype(np.float32)

    # painted block wall with mortar joints
    mortar = Image.new("L", (w, h), 0)
    md = ImageDraw.Draw(mortar)
    for r, y0 in enumerate(range(40, h, 190)):
        md.rectangle((0, y0 - 3, w, y0 + 3), fill=255)
        for x0 in range(-(r % 2) * 190, w, 380):
            md.rectangle((x0 - 3, y0, x0 + 3, y0 + 190), fill=255)
    mort = np.asarray(mortar.filter(ImageFilter.GaussianBlur(1.5))).astype(np.float32) / 255
    img = np.array([150, 152, 140], np.float32)[None, None, :] * (1 + 0.06 * sm[..., None])
    img = img * (1 - 0.25 * mort[..., None]) + 3 * fine[..., None]

    pipe_m = _mask((w, h), lambda d: d.rectangle((0, 400, 840, 950), fill=255))
    band_m = _mask((w, h), lambda d: d.rectangle((840, 255, 1010, 1095), fill=255))
    face_m = _mask((w, h), lambda d: d.ellipse((870, 255, 1150, 1095), fill=255))
    obj = np.maximum(np.maximum(pipe_m, band_m), face_m)
    shadow = Image.fromarray((obj * 255).astype(np.uint8))
    shadow = np.asarray(ImageChops.offset(shadow, 40, 80).filter(ImageFilter.GaussianBlur(30))).astype(np.float32) / 255
    img = img * (1 - 0.5 * shadow[..., None])

    steel = np.array([128, 134, 142], np.float32)

    def cyl(radius):
        t = np.clip((ys - cy) / radius, -1, 1)
        nz = np.sqrt(1 - t * t)
        return 0.30 + 0.70 * np.clip(0.85 * nz - 0.5 * t, 0, 1) + 0.35 * np.exp(-(((t + 0.45) / 0.09) ** 2))

    streak = np.repeat(np.convolve(nrng.normal(0, 1, h), np.ones(5) / 5, "same")[:, None], w, 1).astype(np.float32)
    pipe_col = steel * (cyl(275) * (1 + 0.04 * streak))[..., None]
    img = img * (1 - pipe_m[..., None]) + pipe_col * pipe_m[..., None]
    img = img * (1 - band_m[..., None]) + (steel * 0.95 * cyl(420)[..., None]) * band_m[..., None]
    xn, yn = (xs - 1010) / 140, (ys - 675) / 420
    r = np.sqrt(xn * xn + yn * yn)
    fi = 0.78 + 0.22 * np.clip((1150 - xs) / 280, 0, 1)
    fi = np.where(r > 0.93, fi * 1.18, fi)
    fi = np.where((r > 0.60) & (r < 0.64), fi * 0.78, fi)
    face_col = steel * fi[..., None] + 3 * fine[..., None]
    bore = r < 0.50
    face_col = np.where(bore[..., None], (28 + 30 * (r / 0.5))[..., None] * np.array([1, 1.02, 1.06], np.float32), face_col)
    img = img * (1 - face_m[..., None]) + face_col * face_m[..., None]

    weld_m = _mask((w, h), lambda d: d.rectangle((790, 400, 848, 950), fill=255))
    weld_m = np.asarray(Image.fromarray((weld_m * 255).astype(np.uint8)).filter(ImageFilter.GaussianBlur(2))).astype(np.float32) / 255
    ripple = 0.86 + 0.14 * np.sin(ys / 6.5 + (xs - 790) / 10)
    weld_col = np.array([112, 108, 100], np.float32) * (cyl(275) * ripple)[..., None]
    img = img * (1 - weld_m[..., None]) + weld_col * weld_m[..., None]

    # light rust staining near and below the crack, plus a few drips
    rust = np.zeros((h, w), np.float32)
    for px, py in crack[::2]:
        rust += np.exp(-(((xs - px) / 34) ** 2 + ((ys - py - 35) / 70) ** 2))
    for px, py in crack[1::3]:
        ln = rng.randrange(110, 260)
        wd = rng.uniform(3, 6)
        drip = np.exp(-(((xs - px - rng.uniform(-8, 8)) / wd) ** 2)) * np.clip(1 - (ys - py) / ln, 0, 1) * (ys > py)
        rust = np.maximum(rust, 0.9 * drip)
    rust = np.clip(rust, 0, 1) * np.clip(0.65 + 0.5 * sm, 0.2, 1.2) * obj
    a = np.clip(rust * 0.62, 0, 0.62)[..., None]
    tint = img * np.array([1.05, 0.60, 0.36], np.float32) + np.array([20, 6, 0], np.float32)
    img = img * (1 - a) + tint * a

    pil = Image.fromarray(np.clip(img, 0, 255).astype(np.uint8))
    d = ImageDraw.Draw(pil)
    # bolts: 8 on the bolt circle of the flange face
    for k in range(8):
        th = math.radians(22.5 + 45 * k)
        bx, by = 1010 + 140 * 0.78 * math.cos(th), 675 + 420 * 0.78 * math.sin(th)
        d.ellipse((bx - 30, by - 44, bx + 50, by + 60), fill=(70, 72, 76))
        d.ellipse((bx - 36, by - 52, bx + 36, by + 52), fill=(172, 176, 182), outline=(90, 92, 96), width=3)
        hexa = [(bx + 30 * math.cos(math.radians(a0)), by + 44 * math.sin(math.radians(a0))) for a0 in range(30, 390, 60)]
        d.polygon(hexa, fill=(96, 100, 106), outline=(58, 58, 62))
        d.ellipse((bx - 14, by - 22, bx + 14, by + 22), fill=(124, 128, 134))
        d.arc((bx - 22, by - 34, bx + 22, by + 34), 200, 290, fill=(190, 194, 200), width=4)
    # the crack along the weld seam
    d.line([(x + 6, y) for x, y in crack], fill=(176, 172, 166), width=3, joint="curve")
    d.line(crack, fill=(14, 10, 8), width=12, joint="curve")
    d.line(crack, fill=(0, 0, 0), width=5, joint="curve")
    for bxp, byp in crack[1::2]:
        d.line([(bxp, byp), (bxp + rng.uniform(-45, 45), byp + rng.uniform(8, 34))], fill=(20, 14, 12), width=3)
    # zip tie and tag
    bx, by = 1010 + 140 * 0.78 * math.cos(math.radians(22.5)), 675 + 420 * 0.78 * math.sin(math.radians(22.5))
    d.ellipse((bx - 46, by - 60, bx + 46, by + 60), outline=(236, 240, 242), width=9)
    tag = Image.new("RGBA", (480, 270), (0, 0, 0, 0))
    td = ImageDraw.Draw(tag)
    td.rounded_rectangle((0, 0, 479, 269), radius=22, fill=(240, 205, 52, 255), outline=(120, 95, 10, 255), width=5)
    td.ellipse((26, 26, 68, 68), fill=(200, 165, 30, 255), outline=(120, 95, 10, 255), width=4)
    td.ellipse((38, 38, 56, 56), fill=(255, 0, 255, 255))
    td.text((250, 150), DEFECT_TAG, fill=(30, 25, 10, 255), font=_ttf("DejaVuSansMono-Bold.ttf", 112), anchor="mm")
    tag = tag.rotate(-7, resample=Image.NEAREST, expand=True)
    ta = np.asarray(tag)
    hy, hx = np.where((ta[..., 0] == 255) & (ta[..., 1] == 0) & (ta[..., 2] == 255))
    hole = (hx.mean(), hy.mean())
    for yy, xx in zip(hy, hx):
        tag.putpixel((int(xx), int(yy)), (30, 28, 20, 255))
    tx0, ty0 = 1170, 860
    d.line([(bx + 28, by + 40), ((bx + tx0 + hole[0]) / 2 + 10, (by + ty0 + hole[1]) / 2 - 6), (tx0 + hole[0], ty0 + hole[1])],
           fill=(236, 240, 242), width=9, joint="curve")
    pil.paste(tag, (tx0, ty0), tag)
    # yellow paint-marker arrow pointing at the crack
    ink = Image.new("RGBA", (w, h), (0, 0, 0, 0))
    idr = ImageDraw.Draw(ink)
    tip = (790, 450)
    _stroke(idr, [(430, 190), tip], rng, (252, 224, 40, 255), 16, 1.2)
    ang = math.atan2(tip[1] - 190, tip[0] - 430)
    for da in (2.55, -2.55):
        _stroke(idr, [tip, (tip[0] + 70 * math.cos(ang + da), tip[1] + 70 * math.sin(ang + da))], rng,
                (252, 224, 40, 255), 16, 1.2)
    pil.paste(ink, (0, 0), ink)
    out = _photo_finish(pil, nrng, light=0.22, noise=5.0, blur=1.0)
    xs_c, ys_c = [p[0] for p in crack], [p[1] for p in crack]
    bbox = {"top_left_x": round((min(xs_c) - 12) / w, 4), "top_left_y": round((min(ys_c) - 6) / h, 4),
            "bottom_right_x": round((max(xs_c) + 12) / w, 4), "bottom_right_y": round((max(ys_c) + 6) / h, 4)}
    return out, bbox


def _inspection_form(out: Path, rng: random.Random) -> dict:
    path = out / "inspection_form.pdf"
    c = _canvas(path, "Equipment Inspection Form")
    c.setFont("Helvetica-Bold", 18)
    c.drawString(0.75 * inch, H - 0.85 * inch, "Equipment Inspection Form")
    c.setFont("Helvetica", 10)
    c.drawRightString(W - 0.75 * inch, H - 0.85 * inch, COMPANY)
    for i, t in enumerate(["Asset: Cooling loop flange FL-204", "Site: Plant 3, Bay C",
                           "Inspection date: 2026-09-18", "Inspector: R. Okafor"]):
        c.drawString(0.75 * inch + (i % 2) * 3.5 * inch, H - 1.2 * inch - (i // 2) * 14, t)
    form_box = _place(c, _pil(_checklist_image(rng)), 0.75 * inch, H - 5.15 * inch, 7.0 * inch, 3.5 * inch)
    c.setFont("Helvetica-Bold", 11)
    c.drawString(0.75 * inch, H - 5.45 * inch, "Inspector notes")
    notes_box = _place(c, _pil(_notes_image(rng)), 0.75 * inch, H - 7.3 * inch, 7.0 * inch, 1.8 * inch)
    c.setFont("Helvetica-Bold", 11)
    c.drawString(0.75 * inch, H - 7.75 * inch, "Findings summary")
    _paragraphs(c, [f"<b>1.</b> Visual checks: {sum(ch for _, ch in CHECKLIST)} of {len(CHECKLIST)} items passed; "
                    "gasket and guard require action.",
                    f"<b>2.</b> A crack was found at the {CRACK_LOCATION}; see the defect photo on page 2.",
                    "<b>3.</b> Asset tagged and removed from the active inspection schedule pending repair."],
                0.75 * inch, H - 7.95 * inch, 7.0 * inch)
    c.setFont("Helvetica", 10)
    c.line(0.75 * inch, 1.1 * inch, 3.5 * inch, 1.1 * inch)
    c.drawString(0.75 * inch, 0.93 * inch, "Inspector signature - R. Okafor")
    c.showPage()
    c.setFont("Helvetica-Bold", 18)
    c.drawString(0.75 * inch, H - 0.85 * inch, "Equipment Inspection Form (continued)")
    c.setFont("Helvetica-Bold", 11)
    c.drawString(0.75 * inch, H - 1.25 * inch, "Defect photo")
    photo, crack_bbox = _defect_photo(rng)
    pw = 7.0 * inch
    ph = pw * photo.height / photo.width
    photo_box = _place(c, _jpeg(photo, 80), 0.75 * inch, H - 1.4 * inch - ph, pw, ph)
    _paragraphs(c, [f"<b>Photo ref {DEFECT_TAG}:</b> crack at the {CRACK_LOCATION}, east flange FL-204. "
                    "The yellow arrow marks the crack; light rust staining is visible below it.",
                    "<b>Disposition:</b> Open - replace gasket, repair weld and re-inspect in 30 days."],
                0.75 * inch, H - 1.6 * inch - ph, 7.0 * inch)
    c.showPage()
    c.save()
    return path, {"pages": 2, "visuals": [
        {"page": 0, "channel": "image", "bbox": form_box, "image_type": "other",
         "accept_types": ["other", "table", "document_page"], "role": "checklist",
         "title": "SECTION B - VISUAL CHECKS",
         "checkboxes": [{"label": n, "checked": ch} for n, ch in CHECKLIST]},
        {"page": 0, "channel": "image", "bbox": notes_box, "image_type": "other", "role": "handwriting",
         "text": NOTES},
        {"page": 1, "channel": "image", "bbox": photo_box, "image_type": "photo_with_text",
         "accept_types": ["photo_with_text", "other"], "role": "defect_photo",
         "visible_text": DEFECT_TAG,
         "crack": {"location": CRACK_LOCATION, "bbox": crack_bbox}},
    ]}


# ------------------------------------------------------------ floor plan

SCALE = 100         # px per metre
OX, OY = 110, 170
FP_SIZE = (2000, 1520)
ROOMS = [("Lobby", 0, 0, 6, 5), ("Office A", 6, 0, 5, 5), ("Office B", 11, 0, 5, 5),
         ("Break Room", 0, 5, 6, 5), ("Server Room", 6, 5, 5, 5), ("Storage", 11, 5, 5, 5)]
# component label -> (room, x_m, y_m)
COMPONENTS = {"Switch SW1": ("Lobby", 4.4, 3.6), "Rack R1": ("Server Room", 9.5, 7.0),
              "Panel P1": ("Server Room", 7.6, 9.0), "AHU-1": ("Storage", 13.6, 8.6)}
COMP_HALF = (1.0, 0.3)       # metres
DUCT_END_X = 10.4
CONNECTIONS = [("AHU-1", "Server Room", "duct"), ("Panel P1", "Rack R1", "power"),
               ("Rack R1", "Switch SW1", "fiber")]
LEGEND = [("duct", "Ventilation duct"), ("power", "Power feed"), ("fiber", "Fiber link")]
TITLE_BLOCK = [("Drawing No.", "A-101"), ("Scale", "1:100"), ("Revision", "C"), ("Date", "2026-09-18")]
PALETTE = {"duct": (40, 140, 60), "power": (200, 40, 40), "fiber": (120, 40, 170)}
# (axis, from_m, to_m, side)
DIM_SPECS = [("h", 0, 16, "top"), ("h", 0, 6, "bottom"), ("h", 6, 11, "bottom"),
             ("h", 11, 16, "bottom"), ("v", 0, 10, "right")]
DIMENSIONS = [{"axis": a, "from": f, "to": t, "side": sd, "text": f"{t - f:.1f} m"}
              for a, f, t, sd in DIM_SPECS]


def _routes() -> dict:
    """Orthogonal connection paths in metres, plus the label anchor beside each."""
    def c(n):
        return COMPONENTS[n][1:]
    hx, hy = COMP_HALF
    (ax, ay), (px, py), (rx, ry), (sx, sy) = c("AHU-1"), c("Panel P1"), c("Rack R1"), c("Switch SW1")
    return {
        "duct": ([(ax - hx, ay), (DUCT_END_X, ay)], ((ax - hx + 11) / 2, ay - 0.35), "mm"),
        "power": ([(px + hx, py), (rx, py), (rx, ry + hy)], (rx + 0.15, (py + ry) / 2 + 0.15), "lm"),
        "fiber": ([(rx - hx, ry), (sx, ry), (sx, sy + hy)], (((rx - hx) + 6) / 2, ry - 0.35), "mm"),
    }


def _floor_plan_image(rng: random.Random) -> Image.Image:
    img = Image.new("RGB", FP_SIZE, "white")
    d = ImageDraw.Draw(img)
    f_room, f_dim = _ttf("DejaVuSans-Bold.ttf", 40), _ttf("DejaVuSans.ttf", 34)
    f_comp, f_small = _ttf("DejaVuSans.ttf", 30), _ttf("DejaVuSans.ttf", 30)

    def P(x, y):
        return OX + x * SCALE, OY + y * SCALE

    scale_txt = dict(TITLE_BLOCK)["Scale"]
    d.text((OX, 45), f"GROUND FLOOR PLAN - SCALE {scale_txt}", fill=(17, 86, 127),
           font=_ttf("DejaVuSans-Bold.ttf", 44), anchor="lm")
    for name, x, y, w, h in ROOMS:
        d.rectangle((*P(x, y), *P(x + w, y + h)), fill=(244, 248, 251), outline=(30, 30, 30), width=8)
        d.text(P(x + 0.2, y + 0.4), name, fill=(17, 86, 127), font=f_room, anchor="lm")
    for _, x, y, w, h in ROOMS:                                   # door gaps on shared walls
        if x:
            d.line((*P(x, y + 1.6), *P(x, y + 2.6)), fill=(244, 248, 251), width=10)
    d.line((*P(7.0, 5.0), *P(8.0, 5.0)), fill=(244, 248, 251), width=10)
    hx, hy = COMP_HALF
    for label, (_, mx, my) in COMPONENTS.items():
        d.rectangle((*P(mx - hx, my - hy), *P(mx + hx, my + hy)), fill=(255, 241, 214),
                    outline=(180, 110, 20), width=4)
        d.text(P(mx, my), label, fill=(90, 50, 0), font=f_comp, anchor="mm")
    routes = _routes()
    kind_of = {(a, b): k for a, b, k in CONNECTIONS}
    for (a, b), kind in kind_of.items():
        pts, lab, anchor = routes[kind]
        px = [P(*p) for p in pts]
        d.line(px, fill=PALETTE[kind], width=7, joint="curve")
        (x0, y0), (x1, y1) = px[-2], px[-1]
        ang = math.atan2(y1 - y0, x1 - x0)
        d.polygon([(x1, y1), (x1 - 34 * math.cos(ang) + 16 * math.sin(ang), y1 - 34 * math.sin(ang) - 16 * math.cos(ang)),
                   (x1 - 34 * math.cos(ang) - 16 * math.sin(ang), y1 - 34 * math.sin(ang) + 16 * math.cos(ang))],
                  fill=PALETTE[kind])
        d.text(P(*lab), kind, fill=PALETTE[kind], font=f_small, anchor=anchor, stroke_width=4, stroke_fill="white")
    # dimension callouts
    for t in DIMENSIONS:
        f, to = t["from"], t["to"]
        if t["axis"] == "h":
            y = OY - 40 if t["side"] == "top" else OY + 10 * SCALE + 50
            d.line((*P(f, 0)[:1], y, P(to, 0)[0], y), fill=(30, 30, 30), width=4)
            for m in (f, to):
                d.line((P(m, 0)[0], y - 14, P(m, 0)[0], y + 14), fill=(30, 30, 30), width=4)
            ty = y - 26 if t["side"] == "top" else y - 26
            d.text(((P(f, 0)[0] + P(to, 0)[0]) / 2, ty), t["text"], fill=(30, 30, 30), font=f_dim, anchor="mm")
        else:
            x = OX + 16 * SCALE + 60
            d.line((x, P(0, f)[1], x, P(0, to)[1]), fill=(30, 30, 30), width=4)
            for m in (f, to):
                d.line((x - 14, P(0, m)[1], x + 14, P(0, m)[1]), fill=(30, 30, 30), width=4)
            d.text((x + 22, (P(0, f)[1] + P(0, to)[1]) / 2), t["text"], fill=(30, 30, 30), font=f_dim, anchor="lm")
    # legend (left) and title block (right), same row geometry
    top, row = 1290, 46
    d.rectangle((OX, top, OX + 760, top + row * 4), outline=(30, 30, 30), width=3)
    d.rectangle((OX, top, OX + 760, top + row), fill=(214, 232, 242), outline=(30, 30, 30), width=3)
    d.text((OX + 16, top + row / 2), "LEGEND", fill=(30, 30, 30), font=_ttf("DejaVuSans-Bold.ttf", 28), anchor="lm")
    for i, (kind, meaning) in enumerate(LEGEND):
        y = top + row * (i + 1)
        d.line((OX, y, OX + 760, y), fill=(30, 30, 30), width=2)
        d.line((OX + 20, y + row / 2, OX + 150, y + row / 2), fill=PALETTE[kind], width=7)
        d.text((OX + 175, y + row / 2), f"{kind} - {meaning}", fill=(30, 30, 30), font=_ttf("DejaVuSans.ttf", 28), anchor="lm")
    tx = FP_SIZE[0] - 110 - 760
    d.rectangle((tx, top, tx + 760, top + row * 4), outline=(30, 30, 30), width=3)
    d.line((tx + 280, top, tx + 280, top + row * 4), fill=(30, 30, 30), width=3)
    for i, (k, v) in enumerate(TITLE_BLOCK):
        y = top + row * i
        if i:
            d.line((tx, y, tx + 760, y), fill=(30, 30, 30), width=2)
        d.text((tx + 16, y + row / 2), k, fill=(90, 90, 90), font=_ttf("DejaVuSans.ttf", 28), anchor="lm")
        d.text((tx + 296, y + row / 2), v, fill=(30, 30, 30), font=_ttf("DejaVuSans-Bold.ttf", 28), anchor="lm")
    return img


def _floor_plan(out: Path, rng: random.Random) -> dict:
    img = _floor_plan_image(rng)
    tb = dict(TITLE_BLOCK)
    path = out / "floor_plan_diagram.pdf"
    c = _canvas(path, "Ground Floor Plan", DECK_PAGE)
    PW, PH = DECK_PAGE
    c.setFont("Helvetica-Bold", 14)
    c.drawString(0.6 * inch, PH - 0.45 * inch, f"Facilities Drawing {tb['Drawing No.']}: Ground Floor")
    c.setFont("Helvetica", 9)
    c.drawRightString(PW - 0.6 * inch, PH - 0.45 * inch, f"{COMPANY} - Plant 3 - Rev {tb['Revision']}")
    h = PH - 0.7 * inch - 0.3 * inch
    w = h * img.width / img.height
    box = _place(c, _pil(img), (PW - w) / 2, 0.3 * inch, w, h, page=DECK_PAGE)
    c.showPage()
    c.save()
    return path, {"pages": 1, "visuals": [{
        "page": 0, "channel": "image", "bbox": box, "image_type": "diagram",
        "rooms": [{"label": n, "width_m": float(w), "depth_m": float(h)} for n, _, _, w, h in ROOMS],
        "dimensions": [{"text": t["text"]} for t in DIMENSIONS],
        "components": [{"label": k, "room": v[0]} for k, v in COMPONENTS.items()],
        "connections": [{"from": a, "to": b, "kind": k} for a, b, k in CONNECTIONS],
        "legend": [{"kind": k, "meaning": m} for k, m in LEGEND],
        "title_block": {"drawing_no": tb["Drawing No."], "scale": tb["Scale"],
                        "revision": tb["Revision"], "date": tb["Date"]}}]}


# ---------------------------------------------------------- scanned contract

CONTRACT = {
    "parties": ["Northwind Analytics, Inc.", "Fabrikam Logistics Ltd."],
    "term_months": 36,
    "fee_terms": "$18,500 per month, payable within 45 days of invoice",
    "governing_law": "State of New York", "notice_days": 90,
}


def _contract_page(title: str, paras: list[str], footer: str) -> Image.Image:
    img = Image.new("L", (1020, 1320), 252)
    d = ImageDraw.Draw(img)
    body, head = _ttf("DejaVuSerif.ttf", 21), _ttf("DejaVuSerif-Bold.ttf", 30)
    d.text((510, 100), title, fill=20, font=head, anchor="mm")
    y = 170
    for p in paras:
        for line in _wrap(p, body, 840):
            d.text((90, y), line, fill=25, font=body)
            y += 32
        y += 20
    d.text((510, 1240), footer, fill=60, font=_ttf("DejaVuSerif.ttf", 17), anchor="mm")
    return img


def _scan(img: Image.Image, nrng: np.random.Generator, angle: float) -> Image.Image:
    rot = img.rotate(angle, resample=Image.BICUBIC, expand=False, fillcolor=205)
    a = np.asarray(rot.filter(ImageFilter.GaussianBlur(0.8))).astype(np.float32)
    h, w = a.shape
    a += nrng.normal(0, 7, a.shape)
    mask = nrng.random(a.shape) < 0.0025                      # speckle
    a[mask] = nrng.integers(0, 120, mask.sum())
    a[:, : int(w * 0.03)] -= 18                               # shadow along the scanner edge
    return Image.fromarray(np.clip(a, 0, 255).astype(np.uint8))


def _scanned_contract(out: Path, rng: random.Random) -> dict:
    nrng = _nprng(rng)
    a, b = CONTRACT["parties"]
    p0 = [f"This Services Agreement is made between {a} (\"Provider\") and {b} (\"Customer\").",
          "1. Services. Provider will deliver the data platform services described in each order form.",
          f"2. Term. This Agreement continues for {CONTRACT['term_months']} months from the Effective Date.",
          f"3. Fees. Customer will pay {CONTRACT['fee_terms']}.",
          "4. Confidentiality. Each party will protect the other's confidential information."]
    p1 = [f"5. Governing law. This Agreement is governed by the laws of the {CONTRACT['governing_law']}.",
          f"6. Termination. Either party may terminate on {CONTRACT['notice_days']} days written notice.",
          "7. Entire agreement. This Agreement supersedes all prior understandings.",
          f"Signed for {a}: ______________________    Date: __________",
          f"Signed for {b}: ______________________    Date: __________"]
    angles = [round(rng.uniform(1.5, 3.0), 2), round(rng.uniform(1.5, 3.0), 2)]
    pages = [_scan(_contract_page("SERVICES AGREEMENT", p0, "Page 1 of 2"), nrng, -angles[0]),
             _scan(_contract_page("SERVICES AGREEMENT (continued)", p1, "Page 2 of 2"), nrng, angles[1])]
    path = out / "scanned_contract.pdf"
    c = _canvas(path, "Scanned Services Agreement")
    boxes = []
    for pg in pages:
        boxes.append(_place(c, _jpeg(pg, 70), 0, 0, W, H))
        c.showPage()
    c.save()
    common = {"channel": "image", "image_type": "document_page", "accept_types": ["document_page", "other"]}
    return path, {"pages": 2, "visuals": [
        {**common, "page": 0, "bbox": boxes[0], "parties": CONTRACT["parties"],
         "term_months": CONTRACT["term_months"], "fee_terms": CONTRACT["fee_terms"],
         "skew_degrees": angles[0]},
        {**common, "page": 1, "bbox": boxes[1], "governing_law": CONTRACT["governing_law"],
         "notice_days": CONTRACT["notice_days"], "skew_degrees": angles[1]}]}


# ------------------------------------------------------- multipage rate table

RATE_HEADERS = ["Service Code", "Description", "Unit", "Rate (USD)"]
RATE_ROWS = [
    ("SVC-100", "Freight, palletized (regional)", "pallet", 38.50), ("SVC-101", "Freight, palletized (national)", "pallet", 74.00),
    ("SVC-102", "Freight, full truckload", "mile", 3.15), ("SVC-103", "Freight, less-than-truckload", "100 lb", 28.40),
    ("SVC-104", "Expedited freight surcharge", "shipment", 125.00), ("SVC-105", "Liftgate delivery", "stop", 45.00),
    ("SVC-106", "White-glove delivery", "stop", 180.00), ("SVC-110", "Warehousing, ambient", "sq ft-month", 0.85),
    ("SVC-111", "Warehousing, climate controlled", "sq ft-month", 1.60), ("SVC-112", "Pallet storage", "pallet-month", 14.00),
    ("SVC-113", "Pick and pack", "order", 2.75), ("SVC-114", "Cross-dock handling", "pallet", 6.50),
    ("SVC-115", "Inventory count", "day", 640.00), ("SVC-120", "Courier, same day", "parcel", 18.00),
    ("SVC-121", "Courier, next day", "parcel", 9.50), ("SVC-122", "Courier, economy", "parcel", 5.25),
    ("SVC-123", "Parcel returns handling", "parcel", 3.40), ("SVC-124", "Oversize parcel surcharge", "parcel", 12.00),
    ("SVC-130", "Consulting, analyst", "hour", 145.00), ("SVC-131", "Consulting, senior consultant", "hour", 210.00),
    ("SVC-132", "Consulting, engagement manager", "hour", 285.00), ("SVC-133", "Workshop facilitation", "day", 2400.00),
    ("SVC-134", "Written report", "report", 3800.00), ("SVC-140", "On-site technician visit", "visit", 310.00),
    ("SVC-141", "After-hours technician visit", "visit", 465.00), ("SVC-142", "Emergency call-out", "visit", 620.00),
    ("SVC-143", "Preventive maintenance", "visit", 380.00), ("SVC-144", "Technician travel", "mile", 1.10),
    ("SVC-150", "Forklift rental", "day", 185.00), ("SVC-151", "Scissor lift rental", "day", 240.00),
    ("SVC-152", "Pallet jack rental", "day", 35.00), ("SVC-153", "Generator rental", "day", 290.00),
    ("SVC-154", "Portable storage container", "month", 195.00), ("SVC-155", "Dehumidifier rental", "day", 48.00),
    ("SVC-160", "Janitorial service", "visit", 220.00), ("SVC-161", "Deep cleaning", "sq ft", 0.32),
    ("SVC-162", "Waste removal", "pickup", 135.00), ("SVC-163", "Pest control", "visit", 95.00),
    ("SVC-164", "Security patrol", "hour", 52.00), ("SVC-165", "Reception staffing", "day", 410.00),
    ("SVC-170", "Project coordination", "hour", 118.00), ("SVC-171", "Site survey", "day", 1350.00),
    ("SVC-172", "Safety audit", "audit", 2750.00), ("SVC-173", "Staff training session", "session", 1600.00),
    ("SVC-174", "Compliance filing", "filing", 450.00), ("SVC-175", "Insurance certificate processing", "certificate", 60.00),
    ("SVC-180", "Packaging materials, standard", "box", 4.20), ("SVC-181", "Packaging materials, custom crate", "crate", 85.00),
    ("SVC-182", "Labeling and relabeling", "label", 0.45), ("SVC-183", "Shrink wrap", "pallet", 7.50),
    ("SVC-184", "Document archiving", "box-month", 3.25), ("SVC-185", "Document shredding", "box", 6.00),
    ("SVC-186", "Mail handling", "month", 140.00),
]
SHEET_TITLE = "Service Contract Rate Card 2026"
SHEET_HEADERS = ["Region", "Contract Term", "Monthly Volume", "Rate per Pallet"]
SHEET_BODY = [("US", "Spot", 100, 38.50), ("US", "6-month", 500, 35.25), ("US", "12-month", 2000, 31.90),
              ("EU", "Spot", 100, 42.00), ("EU", "6-month", 500, 38.75), ("EU", "12-month", 2000, 34.60)]


def _money(v: float, cents=True) -> str:
    return f"${v:,.2f}" if cents else f"${v:,.0f}"


def _rate_sheet_image() -> tuple[Image.Image, list, list]:
    colw, rowh = [200, 300, 340, 340], 84
    rows_total = 2 + len(SHEET_BODY)
    img = Image.new("RGB", (sum(colw) + 40, rows_total * rowh + 40), "white")
    d = ImageDraw.Draw(img)
    f, fb = _ttf("DejaVuSans.ttf", 32), _ttf("DejaVuSans-Bold.ttf", 32)
    xs = [20]
    for cw in colw:
        xs.append(xs[-1] + cw)

    def cell(r, c, rs, cs, text, fill, font):
        box = (xs[c], 20 + r * rowh, xs[c + cs], 20 + (r + rs) * rowh)
        d.rectangle(box, fill=fill, outline=(60, 60, 60), width=3)
        d.text(((box[0] + box[2]) / 2, (box[1] + box[3]) / 2), text, fill=(20, 20, 20) if fill != (17, 86, 127) else "white", font=font, anchor="mm")

    merges = [{"row": 0, "col": 0, "rowspan": 1, "colspan": 4, "text": SHEET_TITLE}]
    cell(0, 0, 1, 4, SHEET_TITLE, (17, 86, 127), fb)
    grid = [[SHEET_TITLE, "", "", ""], SHEET_HEADERS]
    for c, h in enumerate(SHEET_HEADERS):
        cell(1, c, 1, 1, h, (214, 232, 242), fb)
    for i, (reg, tier, commit, rate) in enumerate(SHEET_BODY):
        r = 2 + i
        grid.append([reg, tier, f"{commit:,}", _money(rate)])
        if i % 3 == 0:
            cell(r, 0, 3, 1, reg, (240, 244, 247), fb)
            merges.append({"row": r, "col": 0, "rowspan": 3, "colspan": 1, "text": reg})
        cell(r, 1, 1, 1, tier, "white", f)
        cell(r, 2, 1, 1, f"{commit:,}", "white", f)
        cell(r, 3, 1, 1, _money(rate), "white", f)
    return img, grid, merges


def _multipage_rate_table(out: Path, rng: random.Random) -> dict:
    rows = [[code, desc, unit, _money(rate)] for code, desc, unit, rate in RATE_ROWS]
    path = out / "multipage_rate_table.pdf"
    c = _canvas(path, "Service Rate Schedule")
    colw = [1.2 * inch, 3.2 * inch, 1.1 * inch, 1.5 * inch]
    style = TableStyle([
        ("BACKGROUND", (0, 0), (-1, 0), colors.HexColor("#11567F")),
        ("TEXTCOLOR", (0, 0), (-1, 0), colors.white), ("GRID", (0, 0), (-1, -1), 0.5, colors.grey),
        ("ALIGN", (2, 0), (-1, -1), "RIGHT"),
        ("ROWBACKGROUNDS", (0, 1), (-1, -1), [colors.white, colors.HexColor("#EEF5F9")])])

    def table(chunk):
        t = Table([RATE_HEADERS] + chunk, colWidths=colw)
        t.setStyle(style)
        return t, t.wrap(W, H)[1]

    avail = H - 1.3 * inch - 0.9 * inch
    n1 = 1
    while n1 < len(rows) and table(rows[:n1 + 1])[1] <= avail:
        n1 += 1
    assert table(rows[n1:])[1] <= avail, "second page overflows"
    chunks = [rows[:n1], rows[n1:]]
    for n, chunk in enumerate(chunks):
        c.setFont("Helvetica-Bold", 16)
        c.drawString(0.75 * inch, H - 0.9 * inch, "Service Rate Schedule" + (" (continued)" if n else ""))
        t, th = table(chunk)
        t.drawOn(c, 0.75 * inch, H - 1.3 * inch - th)
        c.setFont("Helvetica", 9)
        c.drawString(0.75 * inch, 0.6 * inch, f"Page {n + 1} of 3 - rates in USD, exclusive of tax.")
        c.showPage()
    img, grid, merges = _rate_sheet_image()
    c.setFont("Helvetica-Bold", 16)
    c.drawString(0.75 * inch, H - 0.9 * inch, "Service Contract Pricing Sheet")
    w = W - 1.5 * inch
    box = _place(c, _pil(img), 0.75 * inch, H - 1.3 * inch - w * img.height / img.width, w, w * img.height / img.width)
    c.setFont("Helvetica", 9)
    c.drawString(0.75 * inch, 0.6 * inch, "Page 3 of 3 - volumes are monthly, billed in arrears.")
    c.showPage()
    c.save()
    return path, {"pages": 3, "visuals": [
        {"page": 0, "channel": "text", "image_type": "table", "spans_pages": [0, 1],
         "headers": RATE_HEADERS, "rows": rows, "rows_per_page": [n1, len(rows) - n1]},
        {"page": 2, "channel": "image", "bbox": box, "image_type": "table",
         "headers": SHEET_HEADERS, "cells": grid, "merges": merges}]}


# ---------------------------------------------------------------- pitch deck

DECK_PAGE = landscape(letter)
KPIS = [("ARR", "$48.2M"), ("Net revenue retention", "122%"), ("Customers", "2,140"), ("Gross margin", "78%")]
SEGMENTS = {"Platform": [14.0, 19.5, 26.0], "AI": [2.0, 6.5, 14.2], "Services": [4.0, 5.5, 8.0]}
YEARS = ["FY24", "FY25", "FY26"]
ARCH_NODES = ["Stage", "Parse", "Store", "Search", "Agent"]


def _kpi_image() -> Image.Image:
    img = Image.new("RGB", (1800, 1000), (245, 249, 252))
    d = ImageDraw.Draw(img)
    cw, chh = 840, 440
    for i, (label, value) in enumerate(KPIS):
        x0, y0 = 40 + (i % 2) * (cw + 40), 40 + (i // 2) * (chh + 40)
        d.rounded_rectangle((x0, y0, x0 + cw, y0 + chh), radius=30, fill="white", outline=(41, 181, 232), width=7)
        d.ellipse((x0 + 50, y0 + 145, x0 + 200, y0 + 295), fill=(41, 181, 232))
        d.text((x0 + 125, y0 + 220), ["$", "%", "#", "%"][i], fill="white", font=_ttf("DejaVuSans-Bold.ttf", 80), anchor="mm")
        size = 120
        while _ttf("DejaVuSans-Bold.ttf", size).getlength(value) > 540:
            size -= 4
        d.text((x0 + 250, y0 + 175), value, fill=(17, 86, 127), font=_ttf("DejaVuSans-Bold.ttf", size), anchor="lm")
        lf = _ttf("DejaVuSans.ttf", 46)
        for j, line in enumerate(_wrap(label, lf, 540)):
            d.text((x0 + 250, y0 + 280 + j * 56), line, fill=(70, 70, 70), font=lf, anchor="lm")
    return img


def _stacked_chart() -> ImageReader:
    fig, ax = plt.subplots(figsize=(6, 5.2))
    bottom = np.zeros(len(YEARS))
    for (name, vals), col in zip(SEGMENTS.items(), ["#11567F", "#29B5E8", "#FF9F36"]):
        ax.bar(YEARS, vals, bottom=bottom, label=name, color=col)
        for i, v in enumerate(vals):
            ax.text(i, bottom[i] + v / 2, f"{v}", ha="center", va="center", color="white", fontsize=10)
        bottom += vals
    ax.set_title("Revenue by Segment (USD millions)", fontsize=12)
    ax.set_ylabel("USD millions")
    ax.legend(loc="upper left")
    return _png(fig)


def _arch_image() -> Image.Image:
    img = Image.new("RGB", (1500, 700), "white")
    d = ImageDraw.Draw(img)
    f = _ttf("DejaVuSans-Bold.ttf", 44)
    d.text((750, 90), "Document intelligence pipeline", fill=(40, 40, 40), font=_ttf("DejaVuSans.ttf", 44), anchor="mm")
    for i, n in enumerate(ARCH_NODES):
        x = 15 + i * 310
        d.rounded_rectangle((x, 230, x + 230, 470), radius=24, fill=(17, 86, 127) if i % 2 == 0 else (41, 181, 232))
        d.text((x + 115, 350), n, fill="white", font=f, anchor="mm")
        if i:
            d.line((x - 74, 350, x - 8, 350), fill=(60, 60, 60), width=8)
            d.polygon([(x - 4, 350), (x - 34, 330), (x - 34, 370)], fill=(60, 60, 60))
    return img


def _pitch_deck(out: Path, rng: random.Random) -> dict:
    PW, PH = DECK_PAGE
    path = out / "pitch_deck.pdf"
    c = _canvas(path, "Northwind Analytics Investor Pitch", DECK_PAGE)
    body_top, body_bot = PH - 1.15 * inch, 0.75 * inch
    body_h, mid = body_top - body_bot, (body_top + body_bot) / 2
    cw = PW - 1.4 * inch

    def footer(n, dark=False):
        c.setFillColor(colors.HexColor("#BFD9E8") if dark else colors.HexColor("#6B7280"))
        c.setStrokeColor(colors.HexColor("#BFD9E8") if dark else colors.HexColor("#D1D5DB"))
        c.line(0.7 * inch, 0.5 * inch, PW - 0.7 * inch, 0.5 * inch)
        c.setFont("Helvetica", 9)
        c.drawString(0.7 * inch, 0.3 * inch, COMPANY)
        c.drawRightString(PW - 0.7 * inch, 0.3 * inch, str(n))
        c.setFillColor(colors.black)

    def slide(title):
        c.setFillColor(colors.HexColor("#11567F"))
        c.setFont("Helvetica-Bold", 26)
        c.drawString(0.7 * inch, PH - 0.8 * inch, title)
        c.setFillColor(colors.HexColor("#29B5E8"))
        c.rect(0.7 * inch, PH - 0.95 * inch, 1.2 * inch, 4, fill=1, stroke=0)
        c.setFillColor(colors.black)

    def stacked(img_h, text, size=13, font="Helvetica"):
        """Centre an image + one text line vertically; return (image_y, text_y)."""
        group = img_h + 16 + size
        top = mid + group / 2
        return top - img_h, top - img_h - 16 - size * 0.8

    c.setFillColor(colors.HexColor("#11567F"))
    c.rect(0, 0, PW, PH, fill=1, stroke=0)
    c.setFillColor(colors.HexColor("#29B5E8"))
    c.rect(0, PH * 0.38, PW, 6, fill=1, stroke=0)
    c.setFillColor(colors.white)
    c.setFont("Helvetica-Bold", 40)
    c.drawString(0.8 * inch, PH * 0.5, "Northwind Analytics")
    c.setFont("Helvetica", 22)
    c.drawString(0.8 * inch, PH * 0.38 - 40, "Investor Pitch - FY26 Update")
    footer(1, dark=True)
    c.showPage()

    slide("FY26 at a glance")
    kpi = _kpi_image()
    kh = cw * kpi.height / kpi.width
    iy, ty = stacked(kh, "")
    kpi_box = _place(c, _pil(kpi), 0.7 * inch, iy, cw, kh, page=DECK_PAGE)
    kd = dict(KPIS)
    c.setFont("Helvetica-Oblique", 13)
    c.drawCentredString(PW / 2, ty, f"ARR reached {kd['ARR']} with {kd['Net revenue retention']} net revenue retention.")
    footer(2)
    c.showPage()

    slide("Growth is broad-based")
    chw = 0.6 * cw
    chh = chw * 5.2 / 6
    chart_box = _place(c, _stacked_chart(), 0.7 * inch, mid - chh / 2, chw, chh, page=DECK_PAGE)
    st = ParagraphStyle("b", fontName="Helvetica", fontSize=15, leading=21)
    paras = [Paragraph(t, st) for t in ["<b>Platform</b> remains the core of revenue.",
                                        "<b>AI</b> is the fastest growing segment.",
                                        "<b>Services</b> attach to most new deals."]]
    bx = 0.7 * inch + chw + 0.4 * inch
    bw = PW - 0.7 * inch - bx
    hs = [p.wrap(bw, PH)[1] for p in paras]
    y = mid + (sum(hs) + 18 * (len(hs) - 1)) / 2
    for p, h in zip(paras, hs):
        p.drawOn(c, bx, y - h)
        y -= h + 18
    footer(3)
    c.showPage()

    slide("How it fits together")
    arch = _arch_image()
    ah = cw * arch.height / arch.width
    iy, ty = stacked(ah, "")
    arch_box = _place(c, _pil(arch), 0.7 * inch, iy, cw, ah, page=DECK_PAGE)
    c.setFont("Helvetica-Oblique", 13)
    c.drawCentredString(PW / 2, ty, "Documents flow from stage through parse and storage to search and the agent.")
    footer(4)
    c.showPage()
    c.save()
    return path, {"pages": 4, "visuals": [
        {"page": 1, "channel": "image", "bbox": kpi_box, "image_type": "infographic",
         "kpis": [{"label": k, "value": v} for k, v in KPIS]},
        {"page": 2, "channel": "image", "bbox": chart_box, "image_type": "chart", "chart_type": "stacked_bar",
         "title": "Revenue by Segment (USD millions)", "y_axis": {"label": "USD millions"},
         "series": [{"name": n, "points": [{"x": y, "y": v} for y, v in zip(YEARS, vals)]} for n, vals in SEGMENTS.items()]},
        {"page": 3, "channel": "image", "bbox": arch_box, "image_type": "diagram",
         "nodes": ARCH_NODES, "edges": [[a, b] for a, b in zip(ARCH_NODES, ARCH_NODES[1:])]}]}


# ------------------------------------------------------------- receipt photo

MERCHANT, RECEIPT_DATE = "Harbor Street Market", "2026-09-21"
RECEIPT_LINES = [("Organic bananas 1.2 lb", 1.79), ("Sourdough loaf", 5.50), ("Oat milk x2", 6.50),
                 ("Cold brew 4-pack", 9.99), ("Dish soap", 3.49)]


def _receipt_paper() -> Image.Image:
    img = Image.new("RGB", (560, 900), (250, 248, 240))
    d = ImageDraw.Draw(img)
    mono, monob = _ttf("DejaVuSansMono.ttf", 24), _ttf("DejaVuSansMono-Bold.ttf", 24)
    subtotal = round(sum(a for _, a in RECEIPT_LINES), 2)
    tax = round(subtotal * 0.08, 2)
    total = round(subtotal + tax, 2)
    y = 50
    d.text((280, y), MERCHANT.upper(), fill=20, font=_ttf("DejaVuSansMono-Bold.ttf", 28), anchor="mm")
    for t in ["214 Harbor Street", "Tel 555-0142", f"Date: {RECEIPT_DATE}  Time: 14:32"]:
        y += 38
        d.text((280, y), t, fill=40, font=mono, anchor="mm")
    y += 30
    d.text((30, y), "-" * 36, fill=40, font=mono)
    for desc, amt in RECEIPT_LINES:
        y += 44
        d.text((30, y), desc, fill=25, font=mono)
        d.text((530, y), f"{amt:.2f}", fill=25, font=mono, anchor="ra")
    y += 36
    d.text((30, y), "-" * 36, fill=40, font=mono)
    for lab, v, font in [("SUBTOTAL", subtotal, mono), ("TAX 8%", tax, mono), ("TOTAL", total, monob)]:
        y += 44
        d.text((30, y), lab, fill=20, font=font)
        d.text((530, y), f"{v:.2f}", fill=20, font=font, anchor="ra")
    y += 70
    d.text((280, y), "THANK YOU - VISIT AGAIN", fill=40, font=mono, anchor="mm")
    return img, subtotal, tax, total


def _receipt_photo(out: Path, rng: random.Random) -> dict:
    nrng = _nprng(rng)
    paper, subtotal, tax, total = _receipt_paper()
    size = (1000, 1300)
    bg = nrng.normal(70, 14, (size[1], size[0])).astype(np.float32)          # wood-ish desk texture
    ys = np.arange(size[1])[:, None]
    bg = bg + 18 * np.sin(ys / 9.0 + nrng.uniform(0, 6)) 
    bgi = Image.fromarray(np.clip(np.stack([bg * 1.15, bg * 0.9, bg * 0.7], -1), 0, 255).astype(np.uint8)).filter(ImageFilter.GaussianBlur(1.5)).convert("RGBA")
    j = lambda: rng.uniform(-18, 18)  # noqa: E731
    quad = [(190 + j(), 130 + j()), (830 + j(), 190 + j()), (790 + j(), 1180 + j()), (150 + j(), 1110 + j())]
    rgba = paper.convert("RGBA")
    warped = _warp(rgba, size, quad)
    shadow = Image.new("RGBA", size, (0, 0, 0, 0))
    shadow.putalpha(warped.getchannel("A").filter(ImageFilter.GaussianBlur(18)).point(lambda v: int(v * 0.55)))
    shadow = ImageChops.offset(shadow, 14, 18)
    comp = Image.alpha_composite(Image.alpha_composite(bgi, shadow), warped)
    photo = _photo_finish(comp, nrng, light=0.4, noise=5.0, blur=1.1, glare=(0.7, 0.25, 0.18))
    path = out / "receipt_photo.jpg"
    photo.save(path, format="JPEG", quality=85)
    return path, {"pages": 1, "visuals": [{
        "page": 0, "channel": "image", "bbox": FULL_BBOX, "image_type": "document_page",
        "accept_types": ["document_page", "photo_with_text"], "merchant": MERCHANT, "date": RECEIPT_DATE,
        "line_items": [{"description": d, "amount": a} for d, a in RECEIPT_LINES],
        "subtotal": subtotal, "tax": tax, "total": total}]}


# ---------------------------------------------------------- whiteboard photo

FLOW = ["Ingest", "Parse", "Search", "Agent"]
BULLETS = {"Ingest": ["PDFs", "scans"], "Parse": ["charts", "stamps"], "Search": ["pages"], "Agent": ["answers"]}


def _whiteboard_photo(out: Path, rng: random.Random) -> dict:
    nrng = _nprng(rng)
    w, h = 1400, 900
    img = Image.new("RGB", (w, h), (238, 240, 238))
    d = ImageDraw.Draw(img)
    d.rectangle((0, 0, w - 1, h - 1), outline=(150, 152, 156), width=14)       # aluminium frame
    ghost = Image.new("L", (w, h), 0)                                          # half-erased old marker
    ImageDraw.Draw(ghost).line([(100, 760), (500, 700), (900, 780)], fill=60, width=26)
    img.paste(Image.new("RGB", (w, h), (205, 208, 205)), mask=ghost.filter(ImageFilter.GaussianBlur(10)))
    pen = Image.new("L", (w, h), 0)
    pd = ImageDraw.Draw(pen)
    colors_ = [(20, 60, 160), (190, 40, 40), (30, 120, 60), (30, 30, 30)]
    xs = [90 + i * 330 for i in range(4)]
    boxes = {}
    label_items = []
    for i, name in enumerate(FLOW):
        x0, y0, x1, y1 = xs[i], 230, xs[i] + 230, 360
        boxes[name] = (x0, y0, x1, y1)
        col = colors_[i]
        layer = Image.new("RGBA", (w, h), (0, 0, 0, 0))
        _stroke(ImageDraw.Draw(layer), [(x0, y0), (x1, y0 + 4), (x1 - 3, y1), (x0 + 2, y1 - 2), (x0, y0 - 4)], rng, col + (255,), 7, 2.2)
        img.paste(layer, mask=layer.getchannel("A"))
        label_items.append(((x0 + 30, y0 + 82), name, 62, col))
    for a, b in zip(FLOW, FLOW[1:]):
        layer = Image.new("RGBA", (w, h), (0, 0, 0, 0))
        _arrow(ImageDraw.Draw(layer), (boxes[a][2] + 8, 295), (boxes[b][0] - 8, 298), rng, (30, 30, 30, 255), 7)
        img.paste(layer, mask=layer.getchannel("A"))
    for name in FLOW:
        x0 = boxes[name][0]
        for k, word in enumerate(BULLETS[name]):
            label_items.append(((x0 + 20, 450 + k * 80), "- " + word, 46, colors_[FLOW.index(name)]))
    for pos, text, px, col in label_items:
        m = _hand_mask((w, h), [(pos, text, px)], rng)
        img.paste(Image.new("RGB", (w, h), col), mask=m)
    quad = [(40 + rng.uniform(-10, 10), 30), (w - 30, 0 + rng.uniform(0, 14)), (w - 12, h - 20), (10, h - 50 + rng.uniform(0, 14))]
    warped = _warp(img.convert("RGBA"), (w, h), quad)
    base = Image.new("RGBA", (w, h), (60, 52, 46, 255))
    photo = _photo_finish(Image.alpha_composite(base, warped), nrng, light=0.3, noise=4.0, blur=0.9, glare=(0.25, 0.3, 0.2))
    path = out / "whiteboard_photo.png"
    photo.save(path, format="PNG")
    return path, {"pages": 1, "visuals": [{
        "page": 0, "channel": "image", "bbox": FULL_BBOX, "image_type": "photo_with_text",
        "accept_types": ["photo_with_text", "diagram"], "nodes": FLOW,
        "edges": [[a, b] for a, b in zip(FLOW, FLOW[1:])],
        "bullets": [b for n in FLOW for b in BULLETS[n]]}]}


# ------------------------------------------------------------- claim packet

CLAIM = {"claimant": COMPANY, "policy": "PL-2026-44718", "claim_no": "CLM-2026-0912",
         "loss_date": "2026-09-12", "cause": "burst pipe", "site": "Plant 3",
         "insurer": "Tallowmere Mutual Insurance Co.", "letter_date": "2026-09-15",
         "received": "2026-09-16", "moisture_date": "2026-09-13"}
ESTIMATE = [("Water extraction and drying", "Mitigation", 1, "lot", 4250.00),
            ("Ceiling tile and grid replacement", "Structure", 340, "sq ft", 14.50),
            ("Drywall repair", "Structure", 220, "sq ft", 9.25),
            ("Flooring replacement", "Flooring", 480, "sq ft", 18.00),
            ("Pipe and flange repair", "Plumbing", 1, "lot", 6300.00),
            ("Electrical inspection and rewire", "Electrical", 1, "lot", 3150.00),
            ("Equipment relocation and storage", "Contents", 1, "lot", 5800.00),
            ("Interior repainting", "Finishes", 600, "sq ft", 2.40)]
ESTIMATE_HEADERS = ["Item", "Category", "Qty", "Unit", "Unit Price", "Amount"]
UNCOVERED = {"Contents", "Finishes"}
DEDUCTIBLE = 2500.00
ADJUSTER = "Priya Natarajan"
TIMELINE = [("Date of loss", CLAIM["loss_date"]), ("Claim reported", CLAIM["received"]),
            ("Site inspection", "2026-09-19"), ("Claim approved", "2026-09-26")]
PHOTO_TIMES = ["2026-09-13 08:42", "2026-09-13 08:47"]
LEAK_ROOM, LEAK_AT, LEAK_TEXT = "Server Room", (8.0, 7.2), "LEAK"
CHECK_GROUPS = [("Type of loss", [("Fire", False), ("Water", True), ("Wind", False), ("Theft", False)]),
                ("Photos attached", [("Yes", True), ("No", False)]),
                ("Report filed", [("Yes", False), ("No", True)])]
STICKY = ["Call before", "site visit - ask", "for Bay C access"]
HM_ROWS, HM_COLS = list("ABCDEF"), [str(i) for i in range(1, 9)]


def _estimate():
    rows, by_cat = [], {}
    for item, cat, qty, unit, price in ESTIMATE:
        amt = round(qty * price, 2)
        rows.append([item, cat, f"{qty:,}", unit, _money(price), _money(amt)])
        by_cat[cat] = round(by_cat.get(cat, 0) + amt, 2)
    total = round(sum(by_cat.values()), 2)
    unc = round(sum(v for k, v in by_cat.items() if k in UNCOVERED), 2)
    return rows, by_cat, total, round(total - unc, 2), unc


def _fig_pil(fig, dpi=150) -> Image.Image:
    buf = io.BytesIO()
    fig.tight_layout()
    fig.savefig(buf, format="png", dpi=dpi, metadata={"Software": None})
    plt.close(fig)
    buf.seek(0)
    return Image.open(buf).convert("RGB")


def _scan_color(img, nrng, angle):
    rot = img.rotate(angle, resample=Image.BICUBIC, fillcolor=(205, 205, 205))
    a = np.asarray(rot.filter(ImageFilter.GaussianBlur(0.8))).astype(np.float32)
    h, w = a.shape[:2]
    a += nrng.normal(0, 7, a.shape)
    m = nrng.random((h, w)) < 0.0025
    a[m] = nrng.integers(0, 120, (int(m.sum()), 1))
    a[:, : int(w * 0.03)] -= 18
    return Image.fromarray(np.clip(a, 0, 255).astype(np.uint8))


def _claim_form_page(rng, total):
    img = Image.new("L", (1020, 1320), 250)
    d = ImageDraw.Draw(img)
    fl = _ttf("DejaVuSans.ttf", 24)
    d.rectangle((40, 40, 979, 1279), outline=40, width=4)
    d.text((510, 85), "PROPERTY DAMAGE CLAIM FORM", fill=20, font=_ttf("DejaVuSans-Bold.ttf", 34), anchor="mm")
    d.text((510, 130), f"{CLAIM['insurer']} - Form PD-1", fill=70, font=_ttf("DejaVuSans.ttf", 20), anchor="mm")
    fields = [("Claimant name", "claimant", CLAIM["claimant"]), ("Policy number", "policy_number", CLAIM["policy"]),
              ("Date of loss", "date_of_loss", CLAIM["loss_date"]), ("Cause of loss", "cause_of_loss", CLAIM["cause"]),
              ("Estimated loss amount", "estimated_loss", _money(total))]
    items = []
    for i, (lab, _, val) in enumerate(fields):
        y = 180 + i * 110
        d.text((70, y), lab, fill=40, font=fl)
        d.line((70, y + 78, 950, y + 78), fill=60, width=2)
        items.append(((90, y + 22), val, 44))
    strokes = Image.new("L", img.size, 0)
    sd = ImageDraw.Draw(strokes)
    checks = []
    for gi, (group, opts) in enumerate(CHECK_GROUPS):
        y = 760 + gi * 105
        d.text((70, y), f"{group}:", fill=40, font=fl)
        for k, (label, on) in enumerate(opts):
            bx = 300 + k * 165
            d.rectangle((bx, y - 2, bx + 34, y + 32), outline=50, width=3)
            d.text((bx + 46, y + 15), label, fill=40, font=fl, anchor="lm")
            if on:
                _stroke(sd, [(bx + 6, y + 4), (bx + 30, y + 28)], rng, 255, 5, 1.0)
                _stroke(sd, [(bx + 30, y + 4), (bx + 6, y + 28)], rng, 255, 5, 1.0)
            checks.append({"group": group, "label": label, "checked": on})
    d.text((70, 1090), "Claimant signature:", fill=40, font=fl)
    d.line((70, 1170, 560, 1170), fill=60, width=2)
    sig = _signature(rng)
    sig = sig.resize((380, int(380 * sig.height / sig.width)))
    img.paste(35, (110, 1050), mask=sig.getchannel("A"))
    ink = ImageChops.lighter(_hand_mask(img.size, items, rng), strokes.filter(ImageFilter.GaussianBlur(0.6)))
    img.paste(30, mask=ink)
    return img, {k: v for _, k, v in fields}, checks


def _sticky_note(rng):
    s = 420
    note = Image.new("RGB", (s, s), (255, 236, 92))
    nd = ImageDraw.Draw(note)
    for yy in range(s):
        nd.line((0, yy, s, yy), fill=(255 - int(18 * yy / s), 236 - int(22 * yy / s), 92 - int(10 * yy / s)))
    nd.rectangle((0, 0, s, 34), fill=(246, 222, 70))
    m = _hand_mask((s, s), [((30, 80 + i * 95), t, 40) for i, t in enumerate(STICKY)], rng)
    note.paste(Image.new("RGB", (s, s), INK), mask=m)
    canvas = Image.new("RGBA", (s + 50, s + 50), (0, 0, 0, 0))
    sh = Image.new("L", canvas.size, 0)
    ImageDraw.Draw(sh).rectangle((24, 28, 24 + s, 28 + s), fill=90)
    canvas.paste((0, 0, 0, 255), mask=sh.filter(ImageFilter.GaussianBlur(8)))
    canvas.paste(note, (14, 14))
    return canvas.rotate(-5, resample=Image.BICUBIC, expand=True)


def _timestamp(img, text):
    ImageDraw.Draw(img).text((img.width - 30, img.height - 26), text, fill=(255, 170, 40),
                             font=_ttf("DejaVuSansMono-Bold.ttf", 40), anchor="rd", stroke_width=3,
                             stroke_fill=(30, 20, 0))
    return img


def _ceiling_photo(rng, stamp):
    nrng = _nprng(rng)
    w0, h0 = 1600, 1200
    ys, xs = np.mgrid[0:h0, 0:w0].astype(np.float32)
    sm = _smooth_noise(nrng, w0, h0, 40)
    fine = nrng.normal(0, 1, (h0, w0)).astype(np.float32)
    img = np.array([228, 226, 218], np.float32)[None, None] * (1 + 0.02 * sm[..., None]) + 4 * fine[..., None]
    seam = Image.new("L", (w0, h0), 0)
    sd = ImageDraw.Draw(seam)
    for k in range(0, w0 + 1, 200):
        sd.line((k, 0, k, h0), fill=255, width=7)
    for k in range(0, h0 + 1, 200):
        sd.line((0, k, w0, k), fill=255, width=7)
    seam = np.asarray(seam.filter(ImageFilter.GaussianBlur(1.2))).astype(np.float32) / 255
    img = img * (1 - 0.35 * seam[..., None]) - 28 * (nrng.random((h0, w0)) < 0.01)[..., None]
    ph = [rng.uniform(0, 6.28) for _ in range(3)]
    th = np.arctan2(ys - 560, xs - 560)
    rad = 250 + 40 * np.sin(3 * th + ph[0]) + 25 * np.sin(5 * th + ph[1]) + 12 * np.sin(7 * th + ph[2])
    dd = np.sqrt((xs - 560) ** 2 + (ys - 560) ** 2) / rad
    a = np.clip(np.clip((1.0 - dd) / 0.4, 0, 1) * 0.55 + np.exp(-((dd - 0.96) / 0.03) ** 2) * 0.55
                + np.exp(-((dd - 0.72) / 0.025) ** 2) * 0.28, 0, 0.85)
    a = (a * np.clip(0.8 + 0.3 * sm, 0.5, 1.2))[..., None]
    img = img * (1 - a) + np.array([142, 102, 52], np.float32) * a
    img -= 45 * ((dd < 0.55) & (nrng.random((h0, w0)) < 0.004))[..., None]
    pil = Image.fromarray(np.clip(img, 0, 255).astype(np.uint8))
    pd = ImageDraw.Draw(pil)
    pd.rectangle((1000, 210, 1400, 390), fill=(248, 250, 252), outline=(150, 150, 150), width=8)
    pd.rectangle((1020, 230, 1380, 370), fill=(255, 255, 255))
    wall = Image.new("RGBA", (1200, 900), (190, 184, 170, 255))
    warped = _warp(pil.convert("RGBA"), (1200, 900), [(60, 0), (1140, 0), (1000, 900), (200, 900)])
    out = _photo_finish(Image.alpha_composite(wall, warped), nrng, light=0.3, noise=4.0, blur=0.8)
    return _timestamp(out, stamp)


def _floor_photo(rng, stamp):
    nrng = _nprng(rng)
    w0, h0 = 1600, 1200
    img = Image.new("RGB", (w0, h0))
    d = ImageDraw.Draw(img)
    for r in range(0, h0, 100):
        x = -rng.randrange(0, 400)
        while x < w0:
            ln = rng.randrange(500, 900)
            t = rng.randrange(-14, 14)
            d.rectangle((x, r, x + ln, r + 98), fill=(176 + t, 128 + t, 82 + t))
            d.line((x, r, x + ln, r), fill=(90, 60, 36), width=3)
            d.line((x + ln, r, x + ln, r + 99), fill=(90, 60, 36), width=3)
            x += ln
    a = np.asarray(img).astype(np.float32)
    streak = np.repeat(np.convolve(nrng.normal(0, 1, h0), np.ones(3) / 3, "same")[:, None], w0, 1)
    a *= (1 + 0.05 * streak)[..., None]
    a += nrng.normal(0, 4, a.shape)
    ys, xs = np.mgrid[0:h0, 0:w0]
    g = np.exp(-((((xs - 900) / 380.0) ** 2) + (((ys - 600) / 300.0) ** 2)))
    disp = 34 * g * np.sin(xs / 55.0)
    sy = np.clip((ys - disp).round().astype(int), 0, h0 - 1)
    a = a[sy, xs]
    a = a * (1 + 0.22 * g * np.cos(xs / 55.0))[..., None] * (1 - 0.30 * g)[..., None] * np.array([1, 0.98, 0.94])
    pil = Image.fromarray(np.clip(a, 0, 255).astype(np.uint8))
    wall = Image.new("RGBA", (1200, 900), (200, 194, 180, 255))
    ImageDraw.Draw(wall).rectangle((0, 0, 1200, 40), fill=(236, 232, 224, 255))
    warped = _warp(pil.convert("RGBA"), (1200, 900), [(200, 40), (1000, 40), (1200, 900), (0, 900)])
    out = _photo_finish(Image.alpha_composite(wall, warped), nrng, light=0.3, noise=4.0, blur=0.8)
    return _timestamp(out, stamp)


def _leak_sketch(rng):
    bg = (250, 248, 235)
    img = Image.new("RGB", (1000, 640), bg)
    d = ImageDraw.Draw(img)
    sc, ox, oy = 55, 60, 70
    f = _ttf("DejaVuSans.ttf", 24)
    d.text((ox, 30), "SKETCH - NOT TO SCALE", fill=(90, 90, 90), font=f, anchor="lm")
    for name, x, y, w, h in ROOMS:
        pts = [(ox + x * sc, oy + y * sc), (ox + (x + w) * sc, oy + y * sc), (ox + (x + w) * sc, oy + (y + h) * sc),
               (ox + x * sc, oy + (y + h) * sc), (ox + x * sc, oy + y * sc)]
        _stroke(d, pts, rng, (60, 60, 60), 5, 1.6)
        d.text((ox + (x + 0.15) * sc, oy + (y + 0.45) * sc), name, fill=(70, 70, 70), font=f, anchor="lm")
    lx, ly = ox + LEAK_AT[0] * sc, oy + LEAK_AT[1] * sc
    red = (200, 30, 30)
    d.ellipse((lx - 34, ly - 34, lx + 34, ly + 34), outline=red, width=6)
    _stroke(d, [(lx - 22, ly - 22), (lx + 22, ly + 22)], rng, red, 6, 1)
    _stroke(d, [(lx + 22, ly - 22), (lx - 22, ly + 22)], rng, red, 6, 1)
    d.text((lx + 48, ly), LEAK_TEXT, fill=red, font=_ttf("DejaVuSans-Bold.ttf", 34), anchor="lm",
           stroke_width=3, stroke_fill=bg)
    return img


def _moisture_values(rng):
    vals = []
    for r in range(len(HM_ROWS)):
        vals.append([round(min(11.0 + 27.0 * math.exp(-((r - 2) ** 2 / 2.2 + (c - 4) ** 2 / 3.0))
                               + rng.uniform(-1.2, 1.2), 34.0), 1) for c in range(len(HM_COLS))])
    vals[2][4] = 38.5
    return vals


def _heatmap_image(vals):
    fig, ax = plt.subplots(figsize=(11, 8.5))
    im = ax.imshow(vals, cmap="RdYlGn_r", vmin=8, vmax=40)
    ax.set_xticks(range(len(HM_COLS)), HM_COLS)
    ax.set_yticks(range(len(HM_ROWS)), HM_ROWS)
    ax.set_xlabel("Grid column")
    ax.set_ylabel("Grid row")
    for r, row in enumerate(vals):
        for c, v in enumerate(row):
            ax.text(c, r, f"{v}", ha="center", va="center", fontsize=13, color="black")
    ax.set_title(f"Moisture Readings - {LEAK_ROOM} floor grid, {CLAIM['moisture_date']}", fontsize=15)
    fig.colorbar(im, ax=ax, label="Moisture content (%)")
    return _fig_pil(fig)


def _timeline_image():
    img = Image.new("RGB", (1800, 600), (245, 249, 252))
    d = ImageDraw.Draw(img)
    d.line((120, 300, 1680, 300), fill=(17, 86, 127), width=10)
    fb, fm = _ttf("DejaVuSans-Bold.ttf", 42), _ttf("DejaVuSansMono-Bold.ttf", 38)
    for i, (label, date) in enumerate(TIMELINE):
        x = 300 + i * 400
        d.ellipse((x - 30, 270, x + 30, 330), fill=(41, 181, 232), outline=(17, 86, 127), width=8)
        up = i % 2 == 0
        d.line((x, 270 if up else 330, x, 215 if up else 385), fill=(17, 86, 127), width=5)
        d.text((x, 150 if up else 440), label, fill=(17, 86, 127), font=fb, anchor="mm")
        d.text((x, 190 if up else 490), date, fill=(60, 60, 60), font=fm, anchor="mm")
    return img


def _claim_packet(out: Path, rng: random.Random) -> dict:
    rows, by_cat, total, covered, uncovered = _estimate()
    payable = round(covered - DEDUCTIBLE, 2)
    nrng = _nprng(rng)
    visuals = []
    path = out / "claim_packet.pdf"
    c = _canvas(path, "Property Damage Claim Packet")
    L = 0.75 * inch

    # ---- page 1: cover letter
    logo_box = _place_logo(c, L, H - 1.45 * inch)
    c.setFont("Helvetica", 10)
    for i, t in enumerate([COMPANY, f"{CLAIM['site']}, Bay C", f"Date: {CLAIM['letter_date']}"]):
        c.drawRightString(W - L, H - 0.85 * inch - i * 14, t)
    for i, t in enumerate([CLAIM["insurer"], "Property Claims Department", "400 Harbor Plaza", "Portland, OR 97201"]):
        c.drawString(L, H - 2.1 * inch - i * 14, t)
    c.setFont("Helvetica-Bold", 10)
    c.drawString(L, H - 3.1 * inch, f"RE: Claim {CLAIM['claim_no']} - Policy {CLAIM['policy']} - "
                 f"Date of loss {CLAIM['loss_date']}")
    y = _paragraphs(c, [
        "Dear Claims Department,",
        f"{COMPANY} submits the enclosed claim under policy {CLAIM['policy']} for water damage at "
        f"{CLAIM['site']} on {CLAIM['loss_date']}. A {CLAIM['cause']} released water into the second-floor "
        "equipment bay, damaging the ceiling, drywall, flooring and electrical systems below.",
        f"The enclosed packet includes the completed claim form, photographs of the damage with a sketch marking "
        f"the leak location, our repair estimate of {_money(total)} ({len(ESTIMATE)} line items), and moisture "
        f"readings taken on {CLAIM['moisture_date']}. We request that an adjuster inspect the site at the "
        "earliest opportunity.",
        "Please direct any questions to the undersigned."], L, H - 3.4 * inch, W - 2 * L)
    stamp_img = _stamp("RECEIVED", CLAIM["received"], rng, size=70, color=(30, 60, 170, 210))
    sw = 2.6 * inch
    sh_ = sw * stamp_img.height / stamp_img.width
    stamp_box = _place(c, _pil(stamp_img), 4.6 * inch, y - 0.1 * inch, sw, sh_, mask="auto")
    c.setFont("Helvetica", 10)
    c.drawString(L, y - 14, "Sincerely,")
    sig_img = _signature(rng)
    gw = 2.2 * inch
    gh = gw * sig_img.height / sig_img.width
    sig_box = _place(c, _pil(sig_img), L, y - 22 - gh, gw, gh, mask="auto")
    c.drawString(L, y - 30 - gh, f"{SIGNER}, Controller")
    c.setFont("Helvetica-Oblique", 9)
    c.drawString(L, y - 56 - gh, "Enclosures: claim form (1), photographs and leak sketch (1), repair estimate (1), "
                 "moisture readings (1), adjuster summary (1)")
    c.showPage()
    visuals += [
        {"page": 0, "channel": "image", "bbox": logo_box, "image_type": "other", "role": "logo",
         "visible_text": LOGO_TEXT},
        {"page": 0, "channel": "image", "bbox": stamp_box, "image_type": "other",
         "accept_types": ["other", "photo_with_text"], "role": "stamp", "visible_text": "RECEIVED",
         "date": CLAIM["received"]},
        {"page": 0, "channel": "image", "bbox": sig_box, "image_type": "other", "role": "signature",
         "context": {"caption_signer": SIGNER}}]

    # ---- page 2: scanned claim form + sticky note
    form, fields, checks = _claim_form_page(rng, total)
    angle = round(rng.uniform(1.5, 3.0), 2)
    scan = _scan(form, nrng, angle)
    scan_box = _place(c, _jpeg(scan, 72), 0, 0, W, H)
    sticky = _sticky_note(rng)
    kw = 2.1 * inch
    sticky_box = _place(c, _pil(sticky), 5.9 * inch, H - 3.4 * inch, kw, kw * sticky.height / sticky.width, mask="auto")
    c.showPage()
    visuals += [
        {"page": 1, "channel": "image", "bbox": scan_box, "image_type": "document_page",
         "accept_types": ["document_page", "other"], "fields": fields, "checkboxes": checks,
         "context": {"skew_degrees": angle}},
        {"page": 1, "channel": "image", "bbox": sticky_box, "image_type": "other", "role": "sticky_note",
         "text": STICKY}]

    # ---- page 3: photo collage + leak sketch
    c.setFont("Helvetica-Bold", 16)
    c.drawString(L, H - 0.85 * inch, "Damage Photographs and Leak Location")
    pw_, ph_ = 3.4 * inch, 2.55 * inch
    p1_box = _place(c, _jpeg(_ceiling_photo(rng, PHOTO_TIMES[0]), 82), L, H - 1.2 * inch - ph_, pw_, ph_)
    p2_box = _place(c, _jpeg(_floor_photo(rng, PHOTO_TIMES[1]), 82), L + 3.6 * inch, H - 1.2 * inch - ph_, pw_, ph_)
    _paragraphs(c, [f"<b>Photo 1.</b> Water-stained ceiling tiles above the {LEAK_ROOM}, taken {PHOTO_TIMES[0]}."],
                L, H - 3.9 * inch, 3.4 * inch)
    _paragraphs(c, [f"<b>Photo 2.</b> Warped floor boards below the leak, taken {PHOTO_TIMES[1]}."],
                L + 3.6 * inch, H - 3.9 * inch, 3.4 * inch)
    c.setFont("Helvetica-Bold", 11)
    c.drawString(L, H - 4.75 * inch, "Leak location sketch")
    sk = _leak_sketch(rng)
    skw = 5.6 * inch
    skh = skw * sk.height / sk.width
    sk_box = _place(c, _pil(sk), L, H - 4.9 * inch - skh, skw, skh)
    _paragraphs(c, [f"Sketch (not to scale): the leak originated in the {LEAK_ROOM}, marked in red."],
                L, H - 5.05 * inch - skh, 7.0 * inch)
    c.showPage()
    visuals += [
        {"page": 2, "channel": "image", "bbox": p1_box, "image_type": "photo_with_text",
         "accept_types": ["photo_with_text", "other"], "subject": "water-stained ceiling tiles",
         "visible_text": PHOTO_TIMES[0]},
        {"page": 2, "channel": "image", "bbox": p2_box, "image_type": "photo_with_text",
         "accept_types": ["photo_with_text", "other"], "subject": "warped floor boards",
         "visible_text": PHOTO_TIMES[1]},
        {"page": 2, "channel": "image", "bbox": sk_box, "image_type": "diagram",
         "rooms": [{"label": n} for n, *_ in ROOMS],
         "leak": {"room": LEAK_ROOM, "marker_text": LEAK_TEXT}}]

    # ---- page 4: repair estimate (text table + two charts)
    c.setFont("Helvetica-Bold", 16)
    c.drawString(L, H - 0.85 * inch, "Repair Estimate")
    t = Table([ESTIMATE_HEADERS] + rows + [["", "", "", "", "Total", _money(total)]],
              colWidths=[2.7 * inch, 0.95 * inch, 0.55 * inch, 0.6 * inch, 0.95 * inch, 1.25 * inch])
    t.setStyle(TableStyle([
        ("BACKGROUND", (0, 0), (-1, 0), colors.HexColor("#11567F")), ("TEXTCOLOR", (0, 0), (-1, 0), colors.white),
        ("GRID", (0, 0), (-1, -2), 0.5, colors.grey), ("ALIGN", (2, 0), (-1, -1), "RIGHT"),
        ("FONTNAME", (4, -1), (-1, -1), "Helvetica-Bold")]))
    _, th = t.wrap(W, H)
    t.drawOn(c, L, H - 1.2 * inch - th)
    fig, ax = plt.subplots(figsize=(4.2, 3.8))
    cats, vals = list(by_cat), list(by_cat.values())
    ax.bar(cats, vals, color="#29B5E8")
    for i, v in enumerate(vals):
        ax.text(i, v + 120, f"{v:,.0f}", ha="center", fontsize=7)
    ax.set_title("Estimate by Category (USD)", fontsize=10)
    ax.set_ylabel("USD")
    ax.tick_params(axis="x", rotation=35, labelsize=8)
    bar_img = _fig_pil(fig)
    fig, ax = plt.subplots(figsize=(4.2, 3.8))
    ax.pie([covered, uncovered], labels=["Covered", "Uncovered"], colors=["#11567F", "#FF9F36"], startangle=90,
           autopct=lambda p: f"{p:.0f}%\n${p * total / 100:,.0f}")
    ax.set_title("Covered vs Uncovered (USD)", fontsize=10)
    pie_img = _fig_pil(fig)
    cy_ = H - 1.5 * inch - th - 3.08 * inch
    bar_box = _place(c, _pil(bar_img), L, cy_, 3.4 * inch, 3.08 * inch)
    pie_box = _place(c, _pil(pie_img), L + 3.6 * inch, cy_, 3.4 * inch, 3.08 * inch)
    _paragraphs(c, [f"<b>Basis of estimate.</b> Quantities are from the site measurements taken on "
                    f"{CLAIM['moisture_date']}; unit prices are current contractor rates.",
                    f"<b>Coverage.</b> {' and '.join(sorted(UNCOVERED)).lower()} are excluded under the policy, "
                    f"leaving {_money(covered)} of {_money(total)} covered.",
                    f"<b>Deductible.</b> A deductible of {_money(DEDUCTIBLE)} applies to the covered amount."],
                L, cy_ - 0.25 * inch, 7.0 * inch)
    c.showPage()
    visuals += [
        {"page": 3, "channel": "text", "image_type": "table", "headers": ESTIMATE_HEADERS, "rows": rows,
         "total": total},
        {"page": 3, "channel": "image", "bbox": bar_box, "image_type": "chart", "chart_type": "bar",
         "title": "Estimate by Category (USD)", "y_axis": {"label": "USD"},
         "series": [{"points": [{"x": k, "y": v} for k, v in by_cat.items()]}]},
        {"page": 3, "channel": "image", "bbox": pie_box, "image_type": "chart", "chart_type": "pie",
         "title": "Covered vs Uncovered (USD)",
         "series": [{"points": [{"x": "Covered", "y": covered}, {"x": "Uncovered", "y": uncovered}]}]}]

    # ---- page 5: rotated scan of a moisture heatmap (image-only)
    vals_hm = _moisture_values(rng)
    hm_angle = round(rng.uniform(0.6, 1.2), 2)
    page5 = _scan_color(_heatmap_image(vals_hm), nrng, hm_angle).rotate(90, expand=True)
    hm_box = _place(c, _jpeg(page5, 72), 0, 0, W, H)
    c.showPage()
    mr, mc = max(((r, cc) for r in range(len(HM_ROWS)) for cc in range(len(HM_COLS))), key=lambda rc: vals_hm[rc[0]][rc[1]])
    visuals.append({
        "page": 4, "channel": "image", "bbox": hm_box, "image_type": "chart", "chart_type": "heatmap",
        "accept_types": ["chart", "table"],
        "title": f"Moisture Readings - {LEAK_ROOM} floor grid, {CLAIM['moisture_date']}",
        "row_labels": HM_ROWS, "col_labels": HM_COLS, "values": vals_hm, "unit": "% moisture content",
        "max_cell": {"row": HM_ROWS[mr], "col": HM_COLS[mc], "value": vals_hm[mr][mc]},
        "context": {"content_rotation_degrees_ccw": 90, "skew_degrees": hm_angle}})

    # ---- page 6: adjuster summary
    c.setFont("Helvetica-Bold", 16)
    c.drawString(L, H - 0.85 * inch, "Adjuster Summary")
    c.setFont("Helvetica", 10)
    c.drawString(L, H - 1.1 * inch, f"Claim {CLAIM['claim_no']} - Policy {CLAIM['policy']} - {COMPANY}")
    tl = _timeline_image()
    tl_box = _place(c, _pil(tl), L, H - 1.4 * inch - 7.0 * inch * tl.height / tl.width, 7.0 * inch,
                    7.0 * inch * tl.height / tl.width)
    st = getSampleStyleSheet()["BodyText"]
    colw = 3.35 * inch
    top = H - 4.2 * inch
    for x0, head, paras in [
        (L, "Findings", [
            f"<b>Cause.</b> A {CLAIM['cause']} at {CLAIM['site']} on {CLAIM['loss_date']} released water through "
            "the second-floor slab.",
            f"<b>Inspection.</b> The site was inspected on {TIMELINE[2][1]}. Moisture mapping confirms a localized "
            f"plume centred on the {LEAK_ROOM}.",
            f"<b>Scope.</b> {len(ESTIMATE)} estimate line items totalling {_money(total)}."]),
        (4.4 * inch, "Determination", [
            f"<b>Covered loss.</b> {_money(covered)}.",
            f"<b>Excluded.</b> {' and '.join(sorted(UNCOVERED)).capitalize()} ({_money(uncovered)}) are excluded "
            "under the policy.",
            f"<b>Deductible.</b> {_money(DEDUCTIBLE)}.",
            f"<b>Payable.</b> {_money(payable)}.",
            f"<b>Status.</b> Approved on {TIMELINE[3][1]}."])]:
        c.setFont("Helvetica-Bold", 12)
        c.drawString(x0, top, head)
        _paragraphs(c, paras, x0, top - 8, colw)
    ap = _stamp("APPROVED", TIMELINE[3][1], rng, size=78, color=(20, 130, 60, 215))
    aw = 2.5 * inch
    ap_box = _place(c, _pil(ap), 4.9 * inch, H - 8.8 * inch, aw, aw * ap.height / ap.width, mask="auto")
    asig = _signature(rng)
    gw = 2.2 * inch
    gh = gw * asig.height / asig.width
    asig_box = _place(c, _pil(asig), L, H - 9.3 * inch, gw, gh, mask="auto")
    c.line(L, H - 9.35 * inch, L + 3.0 * inch, H - 9.35 * inch)
    c.setFont("Helvetica", 9)
    c.drawString(L, H - 9.55 * inch, f"{ADJUSTER}, Senior Adjuster")
    c.showPage()
    c.save()
    visuals += [
        {"page": 5, "channel": "image", "bbox": tl_box, "image_type": "infographic",
         "events": [{"label": a, "date": b} for a, b in TIMELINE]},
        {"page": 5, "channel": "image", "bbox": ap_box, "image_type": "other",
         "accept_types": ["other", "photo_with_text"], "role": "stamp", "visible_text": "APPROVED",
         "date": TIMELINE[3][1]},
        {"page": 5, "channel": "image", "bbox": asig_box, "image_type": "other", "role": "signature",
         "context": {"caption_signer": ADJUSTER}}]
    return path, {"pages": 6, "visuals": visuals}


# ---------------------------------------------------------------- entry

BUILDERS = {
    "quarterly_report": _quarterly_report,
    "stamped_invoice": _stamped_invoice,
    "control_contract": _control_contract,
    "inspection_form": _inspection_form,
    "floor_plan_diagram": _floor_plan,
    "scanned_contract": _scanned_contract,
    "multipage_rate_table": _multipage_rate_table,
    "pitch_deck": _pitch_deck,
    "receipt_photo": _receipt_photo,
    "whiteboard_photo": _whiteboard_photo,
    "claim_packet": _claim_packet,
}


def build_corpus(outdir: Path | str, seed: int = 42) -> list[dict]:
    out = Path(outdir)
    out.mkdir(parents=True, exist_ok=True)
    manifest = []
    for doc_id, build in BUILDERS.items():
        rng = random.Random(f"{seed}:{doc_id}")
        path, truth = build(out, rng)
        file = path.name
        truth_file = f"{doc_id}.truth.json"
        (out / truth_file).write_text(json.dumps({"doc_id": doc_id, **truth}, indent=2, sort_keys=True) + "\n")
        manifest.append({"doc_id": doc_id, "file": file, "truth_file": truth_file})
    (out / "manifest.json").write_text(json.dumps(manifest, indent=2) + "\n")
    return manifest


if __name__ == "__main__":
    import argparse

    ap = argparse.ArgumentParser()
    ap.add_argument("outdir", nargs="?")
    ap.add_argument("--pack", default="neutral", help="neutral | insurance | manufacturing | finance (generator/packs.py)")
    a = ap.parse_args()
    root = Path(__file__).parent.parent
    target = Path(a.outdir) if a.outdir else root / ("corpus" if a.pack == "neutral" else f"corpus_packs/{a.pack}")
    if a.pack == "neutral":
        manifest = build_corpus(target)
    else:
        from generator.packs import build_pack
        manifest = build_pack(a.pack, target)
    for d in manifest:
        print(d["file"])
