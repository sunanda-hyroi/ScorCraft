"""
PDF Generator for ScorCraft.

Three outputs:
  1. generate_resume_pdf()    — formatted resume only
  2. generate_scorecard_pdf() — ScorQ scorecard (matches the UI design)
  3. generate_combined_pdf()  — resume pages + scorecard as last page

Action items are NEVER included — they're internal-only.

All tables wrap their cell content in Paragraph()/flowables with fixed,
proportioned column widths so nothing overflows. Every page carries a branded
footer with "Page X of Y" via NumberedCanvas.
"""
import io
import os
from datetime import datetime

from reportlab.lib import colors
from reportlab.lib.pagesizes import A4
from reportlab.lib.units import cm
from reportlab.lib.utils import ImageReader
from reportlab.lib.styles import getSampleStyleSheet, ParagraphStyle
from reportlab.lib.enums import TA_LEFT, TA_CENTER, TA_RIGHT
from reportlab.pdfgen import canvas
from reportlab.graphics.shapes import Drawing, Rect, Circle
from reportlab.platypus import (
    SimpleDocTemplate, Paragraph, Spacer, Table, TableStyle,
    HRFlowable, PageBreak, Image as RLImage,
)


# ── Brand colors ─────────────────────────────────────────────
NAVY = colors.HexColor("#1A2744")
GOLD = colors.HexColor("#C8963E")
LIGHT_NAVY = colors.HexColor("#2D4A6F")
DARK = colors.HexColor("#1F2937")
GRAY = colors.HexColor("#6B7280")
LIGHT_BG = colors.HexColor("#F5F7FA")
CARD_BG = colors.HexColor("#F8FAFC")
BORDER = colors.HexColor("#E5E7EB")
TRACK = colors.HexColor("#E5E7EB")
WHITE = colors.white
GREEN = colors.HexColor("#059669")
RED = colors.HexColor("#DC2626")
AMBER = colors.HexColor("#D97706")
BLUE = colors.HexColor("#2563EB")
PURPLE = colors.HexColor("#7C3AED")
ORANGE = colors.HexColor("#EA580C")
TEAL = colors.HexColor("#0891B2")

# ── Original ScorQ scorecard palette (from the UI Scorecard component) ──
SC_BAND_BG = colors.HexColor("#F8FAFC")     # candidate-info band
SC_BOX_BG = colors.white                    # score boxes (top-right of band)
SC_CARD_BG = colors.HexColor("#F9FAFB")     # breakdown / highlights cards
SC_BORDER = colors.HexColor("#E5E7EB")      # all card/box borders + bar track
SC_TRACK = colors.HexColor("#E5E7EB")       # progress-bar track
SC_SECTION = colors.HexColor("#6B7280")     # uppercase section labels
SC_CAT_NAME = colors.HexColor("#1F2937")    # breakdown card category name
SC_REASON = colors.HexColor("#4B5563")      # breakdown reasoning text
SC_HILITE = colors.HexColor("#374151")      # highlight bullet text
SC_MUTED = colors.HexColor("#D1D5DB")       # null score "—"
SC_CHIP_BG = colors.HexColor("#EEF2FF")     # matched-skill chip bg
SC_CHIP_FG = colors.HexColor("#4338CA")     # matched-skill chip text (indigo)
SC_AI_BG = colors.HexColor("#FFF7ED")       # AI assessment box bg
SC_AI_BORDER = colors.HexColor("#FED7AA")   # AI assessment box border
SC_AI_LABEL = colors.HexColor("#C2410C")    # AI assessment label
SC_AI_TEXT = colors.HexColor("#9A3412")     # AI assessment text

# Usable content width (A4 minus 1.5cm margins each side).
CONTENT_W = A4[0] - 3 * cm

# Page geometry shared by every document.
_DOC_KW = dict(
    pagesize=A4,
    leftMargin=1.5 * cm, rightMargin=1.5 * cm,
    topMargin=1.2 * cm, bottomMargin=2.2 * cm,
)


def _hex(c):
    """'#RRGGBB' for use inside Paragraph <font color="..."> tags."""
    return "#%02X%02X%02X" % (int(c.red * 255), int(c.green * 255), int(c.blue * 255))


def _get_styles():
    """Shared paragraph styles for resume and scorecard."""
    styles = getSampleStyleSheet()

    def define(name, **kw):
        # Overwrite instead of .add(): reportlab's sample stylesheet already
        # ships some of these names (e.g. "Bullet"), and .add() raises
        # KeyError("Style '...' already defined") on a collision.
        if name in styles.byName:
            del styles.byName[name]
        styles.add(ParagraphStyle(name, **kw))

    define("SectionHeading", fontName="Helvetica-Bold", fontSize=11,
        textColor=NAVY, spaceBefore=10, spaceAfter=4)
    define("Body", fontName="Helvetica", fontSize=9,
        textColor=DARK, leading=13, spaceAfter=2)
    define("Bullet", fontName="Helvetica", fontSize=9,
        textColor=DARK, leading=13, leftIndent=12, spaceAfter=1)
    define("CompanyHeader", fontName="Helvetica-Bold", fontSize=10,
        textColor=DARK, spaceBefore=6, spaceAfter=1)
    define("ProjectHeader", fontName="Helvetica-Bold", fontSize=9,
        textColor=LIGHT_NAVY, leftIndent=12, spaceBefore=3, spaceAfter=1)
    define("SmallGray", fontName="Helvetica", fontSize=8, textColor=GRAY)
    define("NameStyle", fontName="Helvetica-Bold", fontSize=16,
        textColor=WHITE, leading=20)
    define("ContactStyle", fontName="Helvetica", fontSize=9,
        textColor=colors.HexColor("#B0C4DE"))
    define("Reasoning", fontName="Helvetica", fontSize=8,
        textColor=DARK, leading=11, spaceAfter=2)

    # Compact scorecard styles (the whole scorecard must fit one A4 page).
    define("ScSection", fontName="Helvetica-Bold", fontSize=10,
        textColor=NAVY, spaceBefore=6, spaceAfter=2)
    define("ScBullet", fontName="Helvetica", fontSize=8,
        textColor=DARK, leading=11, leftIndent=10, spaceAfter=0)

    # Table cell styles (wrap → no overflow).
    define("TblHead", fontName="Helvetica-Bold", fontSize=9,
        textColor=WHITE, leading=11)
    define("TblCell", fontName="Helvetica", fontSize=9,
        textColor=DARK, leading=12)

    # Scorecard styles.
    define("CardHead", fontName="Helvetica-Bold", fontSize=9,
        textColor=NAVY, leading=11)
    define("CardBody", fontName="Helvetica", fontSize=8,
        textColor=DARK, leading=10.5)
    define("BoxLabel", fontName="Helvetica-Bold", fontSize=8,
        alignment=TA_CENTER, leading=10)
    define("BoxPct", fontName="Helvetica-Bold", fontSize=16,
        alignment=TA_CENTER, leading=18)

    return styles


def _score_color(score):
    if score is None:
        return GRAY
    if score >= 75:
        return GREEN
    if score >= 55:
        return AMBER
    return RED


def _pct(score):
    """'85%' or '—' for a possibly-missing score."""
    if score is None or score == "":
        return "—"
    try:
        return f"{int(round(float(score)))}%"
    except (TypeError, ValueError):
        return str(score)


def _score_and_reason(category_scores, key):
    val = (category_scores or {}).get(key, {})
    if isinstance(val, dict):
        sc = val.get("score")
        return sc, (val.get("reasoning") or "")
    return val, ""


# ── Drawing primitives ───────────────────────────────────────

def _bar(score, width, color, height=5):
    """Horizontal progress bar (centered) showing `score`%."""
    try:
        pct = max(0.0, min(100.0, float(score)))
    except (TypeError, ValueError):
        pct = 0.0
    d = Drawing(width, height)
    d.add(Rect(0, 0, width, height, fillColor=TRACK, strokeColor=None, rx=2, ry=2))
    fill = width * pct / 100.0
    if fill > 0:
        d.add(Rect(0, 0, fill, height, fillColor=color, strokeColor=None, rx=2, ry=2))
    d.hAlign = "CENTER"
    return d


def _square(color, size=9):
    """Small filled square used as a card 'icon'."""
    d = Drawing(size, size)
    d.add(Rect(0, 0, size, size, fillColor=color, strokeColor=None, rx=2, ry=2))
    return d


def _load_image(logo):
    """ImageReader from bytes or a local file path; None if unavailable."""
    if not logo:
        return None
    try:
        if isinstance(logo, (bytes, bytearray)):
            return ImageReader(io.BytesIO(logo))
        if isinstance(logo, str) and os.path.exists(logo):
            return ImageReader(logo)
    except Exception:
        return None
    return None


def _logo_flowable(logo, max_h=40):
    """A top-of-page logo Image scaled to `max_h` points, aspect preserved.
    Returns None when no/invalid logo so no blank space is left."""
    reader = _load_image(logo)
    if reader is None:
        return None
    try:
        iw, ih = reader.getSize()
    except Exception:
        return None
    if not iw or not ih:
        return None
    h = float(max_h)
    w = iw * (h / ih)
    if w > CONTENT_W:                      # never wider than the page body
        w = CONTENT_W
        h = ih * (w / iw)
    src = io.BytesIO(logo) if isinstance(logo, (bytes, bytearray)) else logo
    try:
        img = RLImage(src, width=w, height=h)
    except Exception:
        return None
    img.hAlign = "LEFT"
    return img


def _truncate(text, max_chars):
    """Trim text to ~max_chars on a word boundary with an ellipsis."""
    text = (text or "").strip()
    if len(text) <= max_chars:
        return text
    return text[:max_chars].rsplit(" ", 1)[0].rstrip(",;:.") + "…"


# ── Chips / badges ───────────────────────────────────────────

def _chips(items, bg_hex, fg_hex, max_width=CONTENT_W, font_size=8):
    """Lay out items as horizontal rounded badges, wrapping onto new rows.
    Returns a list of flowables (one Table per row)."""
    chip_style = ParagraphStyle(
        "Chip", fontName="Helvetica", fontSize=font_size,
        textColor=colors.HexColor(fg_hex), alignment=TA_CENTER, leading=font_size + 2,
    )
    bg = colors.HexColor(bg_hex)
    gap = 5
    rows, cur, cur_w = [], [], 0.0
    char_w = font_size * 0.62
    for it in items:
        text = str(it).strip()
        if not text:
            continue
        # Estimate chip width: padding + per-char width, with a floor so short
        # tokens (e.g. "AWS", "Go") never wrap inside the chip. Capped to line.
        w = min(max(34, 16 + len(text) * char_w), max_width)
        if cur and cur_w + w + gap > max_width:
            rows.append(cur)
            cur, cur_w = [], 0.0
        chip = Table([[Paragraph(text, chip_style)]], colWidths=[w])
        chip.setStyle(TableStyle([
            ("BACKGROUND", (0, 0), (-1, -1), bg),
            ("ROUNDEDCORNERS", [5, 5, 5, 5]),
            ("TOPPADDING", (0, 0), (-1, -1), 3),
            ("BOTTOMPADDING", (0, 0), (-1, -1), 3),
            ("LEFTPADDING", (0, 0), (-1, -1), 6),
            ("RIGHTPADDING", (0, 0), (-1, -1), 6),
            ("VALIGN", (0, 0), (-1, -1), "MIDDLE"),
        ]))
        cur.append((chip, w))
        cur_w += w + gap

    if cur:
        rows.append(cur)

    flows = []
    for row in rows:
        cells, widths = [], []
        for chip, w in row:
            cells.append(chip)
            widths.append(w)
            cells.append("")          # gutter
            widths.append(gap)
        cells, widths = cells[:-1], widths[:-1]   # drop trailing gutter
        t = Table([cells], colWidths=widths)
        t.setStyle(TableStyle([
            ("TOPPADDING", (0, 0), (-1, -1), 0),
            ("BOTTOMPADDING", (0, 0), (-1, -1), 3),
            ("LEFTPADDING", (0, 0), (-1, -1), 0),
            ("RIGHTPADDING", (0, 0), (-1, -1), 0),
            ("VALIGN", (0, 0), (-1, -1), "MIDDLE"),
        ]))
        flows.append(t)
    return flows


# ── Footer / page numbering ──────────────────────────────────

class NumberedCanvas(canvas.Canvas):
    """Canvas that draws a branded footer with 'Page X of Y' on every page.
    The total page count is only known at save() time, so each page's footer
    is drawn during the deferred save pass.

    Subclasses set `_footer` (a dict) via _footer_canvas()."""

    _footer = {}

    def __init__(self, *args, **kwargs):
        super().__init__(*args, **kwargs)
        self._saved_states = []

    def showPage(self):
        self._saved_states.append(dict(self.__dict__))
        self._startPage()

    def save(self):
        total = len(self._saved_states)
        for i, state in enumerate(self._saved_states):
            self.__dict__.update(state)
            self._draw_footer(i + 1, total)
            super().showPage()
        super().save()

    def _draw_footer(self, page_num, total):
        f = self._footer or {}
        self.saveState()

        # Gold rule above the footer.
        self.setStrokeColor(GOLD)
        self.setLineWidth(1.5)
        self.line(1.5 * cm, 1.8 * cm, A4[0] - 1.5 * cm, 1.8 * cm)

        left_x = 1.5 * cm
        right_x = A4[0] - 1.5 * cm
        center_x = A4[0] / 2.0

        # Left: title (company name / "Generated by …") + optional tagline.
        title = f.get("left_title") or ""
        sub = f.get("left_sub") or ""
        if title:
            self.setFillColor(NAVY)
            self.setFont("Helvetica-Bold", 8)
            self.drawString(left_x, (1.30 * cm) if sub else (1.15 * cm), title)
        if sub:
            self.setFillColor(GRAY)
            self.setFont("Helvetica", 7)
            self.drawString(left_x, 1.02 * cm, sub[:120])

        # Center: CONFIDENTIAL (resume / combined only).
        center = f.get("center")
        if center:
            self.setFillColor(GRAY)
            self.setFont("Helvetica-Bold", 8)
            self.drawCentredString(center_x, 1.15 * cm, center)

        # Right: date (+ page number when enabled).
        self.setFillColor(GRAY)
        self.setFont("Helvetica", 7)
        date_str = datetime.now().strftime("%d/%m/%Y")
        right_text = date_str
        if f.get("show_page"):
            right_text = f"{date_str}   ·   Page {page_num} of {total}"
        self.drawRightString(right_x, 1.15 * cm, right_text)

        self.restoreState()


def _footer_canvas(footer):
    """A NumberedCanvas subclass with this footer config baked in."""
    return type("FooterCanvas", (NumberedCanvas,), {"_footer": footer})


def _company_footer(company_name, tagline=None):
    """Footer for resume / combined PDFs:
    left = company name + tagline, center = CONFIDENTIAL, right = date + page."""
    return {
        "left_title": company_name or "HYROI Solutions",
        "left_sub": tagline or "",
        "center": "CONFIDENTIAL",
        "show_page": True,
    }


def _scorq_footer():
    """Footer for the scorecard PDF:
    left = 'Generated by ScorQ · HYROI Solutions', right = date (no page no.)."""
    return {
        "left_title": "Generated by ScorQ · HYROI Solutions",
        "left_sub": "",
        "center": None,
        "show_page": False,
    }


def _render(story, footer):
    buffer = io.BytesIO()
    doc = SimpleDocTemplate(buffer, **_DOC_KW)
    doc.build(story, canvasmaker=_footer_canvas(footer))
    buffer.seek(0)
    return buffer.getvalue()


# ═════════════════════════════════════════════════════════════
# RESUME STORY (shared by resume + combined)
# ═════════════════════════════════════════════════════════════

def _table_from_rows(headers, rows, col_widths, styles, header_font=9, cell_font=9):
    """Build a wrapping table: headers + rows, every cell a Paragraph."""
    head_style = ParagraphStyle(
        "Th", parent=styles["TblHead"], fontSize=header_font, leading=header_font + 2)
    cell_style = ParagraphStyle(
        "Td", parent=styles["TblCell"], fontSize=cell_font, leading=cell_font + 3)

    data = [[Paragraph(str(h), head_style) for h in headers]]
    for row in rows:
        data.append([Paragraph("" if v is None else str(v), cell_style) for v in row])

    t = Table(data, colWidths=col_widths, repeatRows=1)
    t.setStyle(TableStyle([
        ("BACKGROUND", (0, 0), (-1, 0), NAVY),
        ("GRID", (0, 0), (-1, -1), 0.5, BORDER),
        ("ROWBACKGROUNDS", (0, 1), (-1, -1), [WHITE, LIGHT_BG]),
        ("VALIGN", (0, 0), (-1, -1), "TOP"),
        ("TOPPADDING", (0, 0), (-1, -1), 4),
        ("BOTTOMPADDING", (0, 0), (-1, -1), 4),
        ("LEFTPADDING", (0, 0), (-1, -1), 6),
        ("RIGHTPADDING", (0, 0), (-1, -1), 6),
    ]))
    return t


def _build_resume_story(styles, data, mask_contacts, logo=None):
    """Resume flowables. All tables wrap; nothing overflows."""
    story = []
    candidate = data.get("candidate_info", {}) or {}

    # ── Company logo at the very top (above the name header) ──
    logo_flow = _logo_flowable(logo)
    if logo_flow is not None:
        story.append(logo_flow)
        story.append(Spacer(1, 6))

    # ── Header (navy bar) ────────────────────────────────────
    contact_parts = []
    if not mask_contacts:
        if candidate.get("phone"):
            contact_parts.append(candidate["phone"])
        if candidate.get("email"):
            contact_parts.append(candidate["email"])
    if candidate.get("current_location") or candidate.get("location"):
        contact_parts.append(candidate.get("current_location") or candidate.get("location"))

    name_para = Paragraph(candidate.get("full_name", "CANDIDATE").upper(), styles["NameStyle"])
    contact_para = Paragraph(" | ".join(contact_parts), styles["ContactStyle"])
    header_table = Table([[[name_para, contact_para]]], colWidths=[CONTENT_W])
    header_table.setStyle(TableStyle([
        ("BACKGROUND", (0, 0), (-1, -1), NAVY),
        ("TOPPADDING", (0, 0), (-1, -1), 10),
        ("BOTTOMPADDING", (0, 0), (-1, -1), 10),
        ("LEFTPADDING", (0, 0), (-1, -1), 12),
        ("RIGHTPADDING", (0, 0), (-1, -1), 12),
    ]))
    story.append(header_table)
    story.append(Spacer(1, 8))

    def section_heading(text):
        story.append(Paragraph(text, styles["SectionHeading"]))
        story.append(HRFlowable(width="100%", thickness=0.5, color=LIGHT_NAVY, spaceAfter=4))

    # ── Executive Summary ────────────────────────────────────
    summary = data.get("executive_summary", []) or []
    if summary:
        section_heading("EXECUTIVE SUMMARY")
        for point in summary[:12]:
            story.append(Paragraph(f"• {point}", styles["Bullet"]))

    # ── Core Competencies (wrapping table) ───────────────────
    competencies = data.get("core_competencies", []) or []
    if competencies:
        section_heading("CORE COMPETENCIES")
        rows = [[c.get("domain", ""), c.get("skills", ""), c.get("tools", "")]
                for c in competencies]
        story.append(_table_from_rows(
            ["Domain", "Skills", "Tools / Technologies"], rows,
            [4 * cm, 6 * cm, CONTENT_W - 10 * cm], styles))

    # ── Employment History (nested projects) ─────────────────
    employment = data.get("employment_history", []) or []
    if employment:
        section_heading("EMPLOYMENT HISTORY")
        for emp in employment[:6]:
            company_line = f"<b>{emp.get('company', '')}</b> — {emp.get('role', '')}"
            if emp.get("location"):
                company_line += f" | {emp['location']}"
            story.append(Paragraph(company_line, styles["CompanyHeader"]))
            if emp.get("duration"):
                story.append(Paragraph(emp["duration"], styles["SmallGray"]))

            for proj in emp.get("projects", [])[:4]:
                proj_line = f"<b>{proj.get('project_name', '')}</b>"
                if proj.get("client"):
                    proj_line += f" — {proj['client']}"
                if proj.get("duration"):
                    proj_line += f" ({proj['duration']})"
                story.append(Paragraph(proj_line, styles["ProjectHeader"]))
                for resp in proj.get("responsibilities", [])[:7]:
                    story.append(Paragraph(
                        f"• {resp}",
                        ParagraphStyle("ProjBullet", parent=styles["Bullet"], leftIndent=24)))
                if proj.get("technical_skills"):
                    story.append(Paragraph(
                        f"<i>Tech: {proj['technical_skills']}</i>",
                        ParagraphStyle("ProjTech", parent=styles["SmallGray"], leftIndent=24)))
                story.append(Spacer(1, 3))
            story.append(Spacer(1, 4))

    elif data.get("project_experience"):
        section_heading("PROJECT EXPERIENCE")
        for proj in data["project_experience"][:6]:
            details = []
            if proj.get("project_name"):
                details.append(f"<b>{proj['project_name']}</b>")
            if proj.get("client"):
                details.append(f"Client: {proj['client']}")
            if proj.get("role"):
                details.append(f"Role: {proj['role']}")
            if proj.get("duration"):
                details.append(proj["duration"])
            story.append(Paragraph(" | ".join(details), styles["Body"]))
            for resp in proj.get("responsibilities", [])[:7]:
                story.append(Paragraph(f"• {resp}", styles["Bullet"]))
            story.append(Spacer(1, 4))

    # ── Education & Certifications ───────────────────────────
    section_heading("EDUCATION & CERTIFICATIONS")
    for edu in data.get("education", []) or []:
        parts = []
        if edu.get("degree"):
            parts.append(f"<b>{edu['degree']}</b>")
        if edu.get("institution"):
            parts.append(edu["institution"])
        if edu.get("year"):
            parts.append(str(edu["year"]))
        story.append(Paragraph(" — ".join(parts), styles["Body"]))

    certs = data.get("certifications", []) or []
    if certs:
        story.append(Spacer(1, 4))
        rows = []
        for cert in certs:
            if isinstance(cert, str):
                rows.append([cert, "—", "—"])
            else:
                rows.append([
                    cert.get("name", ""),
                    cert.get("issuer", "—"),
                    cert.get("expiry") or "(!) Not specified",
                ])
        story.append(_table_from_rows(
            ["Certification", "Issuer", "Expiry"], rows,
            [CONTENT_W - 9 * cm, 4.5 * cm, 4.5 * cm], styles, header_font=8, cell_font=8))

    # ── Technical Competencies (wrapping table) ──────────────
    tech = data.get("technical_competencies", {}) or {}
    if tech and any(tech.values()):
        section_heading("TECHNICAL COMPETENCIES")
        rows = []
        for label, key in [
            ("Programming Languages", "programming_languages"),
            ("Tools & Technologies", "tools_technologies"),
            ("Platforms", "platforms"),
        ]:
            if tech.get(key):
                rows.append([label, tech[key]])
        if rows:
            story.append(_table_from_rows(
                ["Category", "Details"], rows,
                [5 * cm, CONTENT_W - 5 * cm], styles))

    return story


# ═════════════════════════════════════════════════════════════
# 1. RESUME PDF
# ═════════════════════════════════════════════════════════════

def generate_resume_pdf(
    data: dict,
    company_name: str = "HYROI Solutions",
    mask_contacts: bool = False,
    logo_path=None,
    company_tagline: str = None,
) -> bytes:
    """Generate formatted resume as PDF (logo at top, CONFIDENTIAL footer)."""
    styles = _get_styles()
    story = _build_resume_story(styles, data, mask_contacts, logo=logo_path)
    return _render(story, _company_footer(company_name, company_tagline))


# ═════════════════════════════════════════════════════════════
# 2. SCORECARD PDF (matches the UI scorecard design)
# ═════════════════════════════════════════════════════════════

# Original ScorQ categories (from the UI Scorecard component):
# (full_label, short_label, score_key, accent_color, bar_color)
# Breakdown cards use full_label; the top score boxes use short_label.
_CAT_CONFIG = [
    ("Technical Skills", "Technical", "technical",
     colors.HexColor("#2563EB"), colors.HexColor("#3B82F6")),
    ("Experience", "Experience", "experience",
     colors.HexColor("#059669"), colors.HexColor("#10B981")),
    ("Education", "Education", "education",
     colors.HexColor("#7C3AED"), colors.HexColor("#8B5CF6")),
    ("Stability", "Stability", "stability",
     colors.HexColor("#059669"), colors.HexColor("#10B981")),
]


def generate_scorecard_pdf(
    candidate_name: str,
    candidate_email: str,
    candidate_phone: str,
    overall_score: int,
    category_scores: dict,
    matched_skills: list,
    missing_skills: list,
    highlights: list,
    red_flags: list,
    ai_reasoning: str,
    job_title: str = "",
    logo_path=None,
    certifications: list = None,
) -> bytes:
    """Generate the ScorQ scorecard PDF matching the UI layout."""
    styles = _get_styles()
    story = _build_scorecard_story(
        styles, candidate_name, candidate_email, candidate_phone,
        overall_score, category_scores, matched_skills, missing_skills,
        highlights, red_flags, ai_reasoning, job_title, certifications,
    )
    return _render(story, _scorq_footer())


def _cert_names(certifications):
    """Extract certification display names from mixed str/dict entries."""
    names = []
    for cert in certifications or []:
        if isinstance(cert, str):
            if cert.strip():
                names.append(cert.strip())
        elif isinstance(cert, dict):
            n = cert.get("name")
            if n and str(n).strip():
                names.append(str(n).strip())
    return names


def _sc_section_label(text):
    """Gray uppercase section label, matching the UI scorecard."""
    return Paragraph(
        f'<font color="{_hex(SC_SECTION)}"><b>{text}</b></font>',
        ParagraphStyle("ScLabel", fontName="Helvetica-Bold", fontSize=9,
            textColor=SC_SECTION, leading=12))


def _round_icon(color, d=9):
    """Small filled circle indicator in the category color (stands in for the
    UI's emoji icon, which doesn't render in ReportLab fonts)."""
    dr = Drawing(d, d)
    dr.add(Circle(d / 2.0, d / 2.0, d / 2.0, fillColor=color, strokeColor=None))
    return dr


def _build_scorecard_story(
    styles, candidate_name, candidate_email, candidate_phone,
    overall_score, category_scores, matched_skills, missing_skills,
    highlights, red_flags, ai_reasoning, job_title, certifications=None,
):
    """Scorecard flowables — replicates the original ScorQ UI scorecard
    (exact colors, layout, and section order from the Scorecard component)."""
    category_scores = category_scores or {}
    story = []

    # ── Navy header: ScorQ branding (left) + CANDIDATE SCORECARD (right) ──
    brand_left = Paragraph(
        '<font color="#FFFFFF" size="16"><b>Scor</b></font>'
        '<font color="#C8963E" size="16"><b>Q</b></font>'
        '  <font color="#B9C2CF" size="8">by HYROI Solutions</font>',
        ParagraphStyle("Brand", fontName="Helvetica-Bold", fontSize=16, leading=18))
    brand_sub = Paragraph(
        "AI-powered resume scoring",
        ParagraphStyle("BrandSub", fontName="Helvetica", fontSize=8,
            textColor=colors.HexColor("#B9C2CF"), leading=12))
    date_text = Paragraph(
        '<font color="#B9C2CF" size="8">CANDIDATE SCORECARD</font><br/>'
        f'<font color="#CBD5E1" size="9">{datetime.now().strftime("%d %B %Y")}</font>',
        ParagraphStyle("DateR", fontName="Helvetica", fontSize=9,
            alignment=TA_RIGHT, leading=13))
    header = Table([[[brand_left, brand_sub], date_text]],
                   colWidths=[CONTENT_W - 5 * cm, 5 * cm])
    header.setStyle(TableStyle([
        ("BACKGROUND", (0, 0), (-1, -1), NAVY),
        ("TOPPADDING", (0, 0), (-1, -1), 10),
        ("BOTTOMPADDING", (0, 0), (-1, -1), 10),
        ("LEFTPADDING", (0, 0), (0, 0), 12),
        ("RIGHTPADDING", (-1, -1), (-1, -1), 12),
        ("VALIGN", (0, 0), (-1, -1), "TOP"),
    ]))
    story.append(header)

    # ── Candidate-info band (#F8FAFC): name + contacts (L) | score boxes (R) ──
    info_left = [Paragraph(
        f"<b>{candidate_name or 'Candidate'}</b>",
        ParagraphStyle("CandName", fontName="Helvetica-Bold", fontSize=17,
            textColor=NAVY, leading=20))]
    contact_bits = []
    if candidate_email:
        contact_bits.append(candidate_email)
    if candidate_phone:
        contact_bits.append(candidate_phone)
    if contact_bits:
        info_left.append(Paragraph(
            "&nbsp;&nbsp;&middot;&nbsp;&nbsp;".join(contact_bits),
            ParagraphStyle("Contact", fontName="Helvetica", fontSize=9,
                textColor=SC_SECTION, leading=12, spaceBefore=3)))

    box_w, gutter = 2.55 * cm, 0.18 * cm

    def _score_box(short_label, key, color, bar_color):
        sc, _ = _score_and_reason(category_scores, key)
        val_color = color if sc is not None else SC_MUTED
        cell = [
            Paragraph(f'<font color="{_hex(color)}"><b>{short_label}</b></font>',
                ParagraphStyle("Bx", fontName="Helvetica-Bold", fontSize=8,
                    alignment=TA_CENTER, leading=10)),
            Spacer(1, 1),
            Paragraph(f'<font color="{_hex(val_color)}"><b>{_pct(sc)}</b></font>',
                ParagraphStyle("BxP", fontName="Helvetica-Bold", fontSize=15,
                    alignment=TA_CENTER, leading=17)),
            Spacer(1, 3),
            _bar(sc, 1.9 * cm, bar_color, height=4),
        ]
        box = Table([[cell]], colWidths=[box_w])
        box.setStyle(TableStyle([
            ("BACKGROUND", (0, 0), (-1, -1), SC_BOX_BG),
            ("BOX", (0, 0), (-1, -1), 0.5, SC_BORDER),
            ("ROUNDEDCORNERS", [5, 5, 5, 5]),
            ("TOPPADDING", (0, 0), (-1, -1), 6),
            ("BOTTOMPADDING", (0, 0), (-1, -1), 6),
            ("LEFTPADDING", (0, 0), (-1, -1), 5),
            ("RIGHTPADDING", (0, 0), (-1, -1), 5),
            ("ALIGN", (0, 0), (-1, -1), "CENTER"),
        ]))
        return box

    boxes = [_score_box(short, key, col, bar)
             for (full, short, key, col, bar) in _CAT_CONFIG]
    box_cells, box_widths = [], []
    for i, b in enumerate(boxes):
        box_cells.append(b)
        box_widths.append(box_w)
        if i < len(boxes) - 1:
            box_cells.append("")
            box_widths.append(gutter)
    boxes_row = Table([box_cells], colWidths=box_widths)
    boxes_row.setStyle(TableStyle([
        ("VALIGN", (0, 0), (-1, -1), "MIDDLE"),
        ("TOPPADDING", (0, 0), (-1, -1), 0), ("BOTTOMPADDING", (0, 0), (-1, -1), 0),
        ("LEFTPADDING", (0, 0), (-1, -1), 0), ("RIGHTPADDING", (0, 0), (-1, -1), 0),
    ]))

    boxes_total = 4 * box_w + 3 * gutter
    band = Table([[info_left, boxes_row]],
                 colWidths=[CONTENT_W - boxes_total, boxes_total])
    band.setStyle(TableStyle([
        ("BACKGROUND", (0, 0), (-1, -1), SC_BAND_BG),
        ("LINEBELOW", (0, 0), (-1, -1), 0.5, SC_BORDER),
        ("TOPPADDING", (0, 0), (-1, -1), 12),
        ("BOTTOMPADDING", (0, 0), (-1, -1), 12),
        ("LEFTPADDING", (0, 0), (0, 0), 12),
        ("RIGHTPADDING", (-1, -1), (-1, -1), 12),
        ("VALIGN", (0, 0), (-1, -1), "MIDDLE"),
    ]))
    story.append(band)
    story.append(Spacer(1, 10))

    # ── Score Breakdown: 2×2 cards (#F9FAFB) ─────────────────
    story.append(_sc_section_label("SCORE BREAKDOWN"))
    story.append(Spacer(1, 6))

    def _break_card(full_label, key, color, bar_color):
        sc, reasoning = _score_and_reason(category_scores, key)
        val_color = color if sc is not None else SC_MUTED
        head = Table(
            [[_round_icon(color),
              Paragraph(f'<b>{full_label}</b>',
                  ParagraphStyle("CN", fontName="Helvetica-Bold", fontSize=11,
                      textColor=SC_CAT_NAME, leading=13)),
              Paragraph(f'<font color="{_hex(val_color)}"><b>{_pct(sc)}</b></font>',
                  ParagraphStyle("CV", fontName="Helvetica-Bold", fontSize=13,
                      alignment=TA_RIGHT, leading=15))]],
            colWidths=[0.45 * cm, 5.3 * cm, 2.05 * cm])
        head.setStyle(TableStyle([
            ("VALIGN", (0, 0), (-1, -1), "MIDDLE"),
            ("LEFTPADDING", (0, 0), (0, 0), 0), ("RIGHTPADDING", (0, 0), (0, 0), 4),
            ("LEFTPADDING", (1, 0), (-1, -1), 0), ("RIGHTPADDING", (1, 0), (-1, -1), 0),
            ("TOPPADDING", (0, 0), (-1, -1), 0), ("BOTTOMPADDING", (0, 0), (-1, -1), 0),
        ]))
        inner = [head, Spacer(1, 5), _bar(sc, 7.6 * cm, bar_color, height=5), Spacer(1, 6)]
        inner.append(Paragraph(_truncate(reasoning, 220) or "—",
            ParagraphStyle("RB", fontName="Helvetica", fontSize=8.5,
                textColor=SC_REASON, leading=12)))
        card = Table([[inner]], colWidths=[8.5 * cm])
        card.setStyle(TableStyle([
            ("BACKGROUND", (0, 0), (-1, -1), SC_CARD_BG),
            ("BOX", (0, 0), (-1, -1), 0.5, SC_BORDER),
            ("ROUNDEDCORNERS", [8, 8, 8, 8]),
            ("TOPPADDING", (0, 0), (-1, -1), 10),
            ("BOTTOMPADDING", (0, 0), (-1, -1), 10),
            ("LEFTPADDING", (0, 0), (-1, -1), 10),
            ("RIGHTPADDING", (0, 0), (-1, -1), 10),
            ("VALIGN", (0, 0), (-1, -1), "TOP"),
        ]))
        return card

    cards = [_break_card(full, key, col, bar)
             for (full, short, key, col, bar) in _CAT_CONFIG]
    gw = 0.35 * cm
    grid = Table([[cards[0], "", cards[1]], [cards[2], "", cards[3]]],
                 colWidths=[8.5 * cm, gw, 8.5 * cm])
    grid.setStyle(TableStyle([
        ("VALIGN", (0, 0), (-1, -1), "TOP"),
        ("LEFTPADDING", (0, 0), (-1, -1), 0), ("RIGHTPADDING", (0, 0), (-1, -1), 0),
        ("TOPPADDING", (0, 0), (-1, 0), 0), ("BOTTOMPADDING", (0, 0), (-1, 0), 8),
        ("TOPPADDING", (0, 1), (-1, 1), 0), ("BOTTOMPADDING", (0, 1), (-1, 1), 0),
    ]))
    story.append(grid)
    story.append(Spacer(1, 8))

    # ── Matched Skills (indigo chips) ────────────────────────
    if matched_skills:
        story.append(_sc_section_label("MATCHED SKILLS"))
        story.append(Spacer(1, 4))
        story.extend(_chips(matched_skills[:20], "#EEF2FF", "#4338CA", font_size=9))
        story.append(Spacer(1, 8))

    # ── Highlights (card) ────────────────────────────────────
    if highlights:
        inner = [_sc_section_label("HIGHLIGHTS"), Spacer(1, 4)]
        for h in highlights[:5]:
            inner.append(Paragraph(
                f'•&nbsp;&nbsp;{_truncate(h, 160)}',
                ParagraphStyle("HL", fontName="Helvetica", fontSize=9,
                    textColor=SC_HILITE, leading=13, spaceAfter=2)))
        box = Table([[inner]], colWidths=[CONTENT_W])
        box.setStyle(TableStyle([
            ("BACKGROUND", (0, 0), (-1, -1), SC_CARD_BG),
            ("BOX", (0, 0), (-1, -1), 0.5, SC_BORDER),
            ("ROUNDEDCORNERS", [8, 8, 8, 8]),
            ("TOPPADDING", (0, 0), (-1, -1), 10),
            ("BOTTOMPADDING", (0, 0), (-1, -1), 10),
            ("LEFTPADDING", (0, 0), (-1, -1), 12),
            ("RIGHTPADDING", (0, 0), (-1, -1), 12),
        ]))
        story.append(box)
        story.append(Spacer(1, 8))

    # ── AI Assessment (amber box) ────────────────────────────
    if ai_reasoning:
        inner = [
            Paragraph(f'<font color="{_hex(SC_AI_LABEL)}"><b>AI ASSESSMENT</b></font>',
                ParagraphStyle("AIL", fontName="Helvetica-Bold", fontSize=9,
                    textColor=SC_AI_LABEL, leading=12)),
            Spacer(1, 4),
            Paragraph(_truncate(ai_reasoning, 700),
                ParagraphStyle("AIT", fontName="Helvetica", fontSize=9,
                    textColor=SC_AI_TEXT, leading=13)),
        ]
        box = Table([[inner]], colWidths=[CONTENT_W])
        box.setStyle(TableStyle([
            ("BACKGROUND", (0, 0), (-1, -1), SC_AI_BG),
            ("BOX", (0, 0), (-1, -1), 0.5, SC_AI_BORDER),
            ("ROUNDEDCORNERS", [8, 8, 8, 8]),
            ("TOPPADDING", (0, 0), (-1, -1), 10),
            ("BOTTOMPADDING", (0, 0), (-1, -1), 10),
            ("LEFTPADDING", (0, 0), (-1, -1), 12),
            ("RIGHTPADDING", (0, 0), (-1, -1), 12),
        ]))
        story.append(box)

    return story


# ═════════════════════════════════════════════════════════════
# 3. COMBINED PDF (resume pages + scorecard as last page)
# ═════════════════════════════════════════════════════════════

def generate_combined_pdf(
    # Resume data
    resume_data: dict,
    company_name: str = "HYROI Solutions",
    mask_contacts: bool = False,
    # Scorecard data
    candidate_name: str = "",
    candidate_email: str = None,
    candidate_phone: str = None,
    overall_score: int = 0,
    category_scores: dict = None,
    matched_skills: list = None,
    missing_skills: list = None,
    highlights: list = None,
    red_flags: list = None,
    ai_reasoning: str = "",
    job_title: str = "",
    logo_path=None,
    company_tagline: str = None,
) -> bytes:
    """Combined PDF: crafted resume pages followed by the one-page scorecard."""
    styles = _get_styles()

    story = _build_resume_story(styles, resume_data, mask_contacts, logo=logo_path)
    story.append(PageBreak())
    story.extend(_build_scorecard_story(
        styles, candidate_name, candidate_email, candidate_phone,
        overall_score, category_scores or {}, matched_skills or [],
        missing_skills or [], highlights or [], red_flags or [],
        ai_reasoning, job_title, _cert_names((resume_data or {}).get("certifications")),
    ))

    return _render(story, _company_footer(company_name, company_tagline))
