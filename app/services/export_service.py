"""Branded exports: Excel (openpyxl) and PDF (reportlab) — Arabic aware.

Banks need evidence artefacts: an audit extract for the regulator, a monthly
ROI pack for the steering committee, a run history for an incident review.
Both formats are generated **with the organization branding** (colours, company
name) and, since 4.1, in **both languages**: pass ``locale="ar"`` and the
document is titled, ordered and shaped right-to-left.

The Arabic path is the interesting one.  reportlab has no bidirectional
algorithm and its built-in Helvetica has no Arabic glyphs, which is why an
"Arabic" PDF used to come out as a page of boxes or ``????``:

* every string goes through :func:`app.core.text.shape_arabic`, producing the
  contextual presentation forms in visual order (``arabic-reshaper`` +
  ``python-bidi``);
* the bundled **Amiri** TTF (``app/assets/fonts``, SIL OFL) is registered and
  embedded, so the glyphs exist inside the PDF itself — nothing depends on the
  reader's workstation;
* tables are drawn right-to-left (mirrored column order, right-aligned cells)
  when the content is Arabic.

Excel needs none of that (the XLSX format is UTF-8 XML), but the sheet view is
flipped (``rightToLeft``) and an Arabic-capable font is requested so the file
looks right in Excel on a Windows workstation.
"""

from __future__ import annotations

import io
import logging
from datetime import datetime
from typing import Any, Dict, List, Optional, Sequence

from app.core.text import detect_direction, has_arabic, is_arabic_locale, shape_arabic
from app.services.organization_service import get_branding

logger = logging.getLogger(__name__)

MAX_ROWS = 50_000

#: Bilingual labels for the generated artefacts.  Kept in the service (rather
#: than the HTTP layer) so scheduled reports — nightly audit packs — use the
#: same wording as the on-demand buttons.
COPY: Dict[str, Dict[str, str]] = {
    "en": {
        "generated": "Generated",
        "confidential": "confidential",
        "page": "Page",
        "product": "RPA CoE Control Room",
        "totals": "Totals",
        "scope": "Scope",
        "window": "Window",
        "exported_by": "Exported by",
        "process": "Process",
        "all": "All",
        "days": "days",
        "audit_title": "Audit Trail",
        "runs_title": "Run History",
        "roi_title": "ROI & Value Realisation Report — last {days} days",
        "roi_section": "Per-process realisation",
        "capacity_title": "Capacity & SLA Advisor Report",
        "capacity_utilisation": "Runner utilisation & SLA status",
        "capacity_recommendations": "Open recommendations",
        "total_cost": "Total cost saved: {value:,.2f} EGP",
        "total_hours": "Total hours saved: {value:,.1f} hours",
        "total_transactions": "Processed transactions: {value:,}",
        "scope_line": "Processes in scope: {count} · Scope: {scope} · Requested by: {user}",
        "processes_analysed": "Processes analysed: {count} · Online runners: {runners}",
        "weighted_util": "Weighted runner utilisation: {value}%",
        "queue_line": "Queue depth: {depth:,} items · SLA at risk: {risk}",
        "open_recs": "Open recommendations: {count} (critical: {critical})",
        "file_audit": "audit_trail",
        "file_runs": "runs",
        "file_roi": "roi_report",
        "file_capacity": "capacity_report",
    },
    "ar": {
        "generated": "تاريخ الإصدار",
        "confidential": "سري",
        "page": "صفحة",
        "product": "غرفة تحكم مركز التميز لأتمتة العمليات",
        "totals": "الإجمالي",
        "scope": "النطاق",
        "window": "الفترة",
        "exported_by": "أصدره",
        "process": "العملية",
        "all": "الكل",
        "days": "يوم",
        "audit_title": "سجل التدقيق",
        "runs_title": "سجل التشغيل",
        "roi_title": "تقرير العائد على الاستثمار وتحقيق القيمة — آخر {days} يوم",
        "roi_section": "التحقق لكل عملية",
        "capacity_title": "تقرير السعة ومرشد اتفاقية مستوى الخدمة",
        "capacity_utilisation": "استهلاك الروبوتات وحالة اتفاقية مستوى الخدمة",
        "capacity_recommendations": "التوصيات المفتوحة",
        "total_cost": "إجمالي التوفير: {value:,.2f} جنيه",
        "total_hours": "إجمالي الساعات الموفرة: {value:,.1f} ساعة",
        "total_transactions": "المعاملات المنفذة: {value:,}",
        "scope_line": "العمليات في النطاق: {count} · النطاق: {scope} · طلبها: {user}",
        "processes_analysed": "العمليات المحللة: {count} · الروبوتات المتصلة: {runners}",
        "weighted_util": "متوسط استهلاك الروبوتات المرجح: {value}%",
        "queue_line": "عمق قائمة الانتظار: {depth:,} عنصر · معرضة لخطر الاتفاقية: {risk}",
        "open_recs": "التوصيات المفتوحة: {count} (حرجة: {critical})",
        "file_audit": "سجل_التدقيق",
        "file_runs": "سجل_التشغيل",
        "file_roi": "تقرير_العائد",
        "file_capacity": "تقرير_السعة",
    },
}

#: Font family used inside Excel cells.  Arabic renders in either one on a
#: current Windows build; the second is the fallback for older images.
EXCEL_FONT = "Segoe UI"
EXCEL_FONT_ARABIC = "Cairo"


def report_copy(locale: Optional[str]) -> Dict[str, str]:
    """Bilingual labels (and file-name stems) for the requested locale."""
    return COPY["ar"] if is_arabic_locale(locale) else COPY["en"]


#: Backwards-compatible private alias used inside this module.
_copy = report_copy


def _branding() -> Dict[str, Any]:
    """Fetch branding with a safe fallback (never blocks an export)."""
    try:
        from app.db.session import session_scope

        with session_scope() as session:
            return get_branding(session)
    except Exception as exc:  # pragma: no cover - defensive
        logger.warning("Branding lookup failed: %s", exc)
        return {"company_name": "RPA CoE", "name": "RPA CoE Control Room", "primary_color": "#3F51B5", "accent_color": "#0D9488"}


def build_excel(
    *,
    title: str,
    columns: Sequence[str],
    rows: Sequence[Dict[str, Any]],
    sheet_name: str = "Export",
    metadata: Optional[Dict[str, Any]] = None,
    locale: Optional[str] = None,
) -> bytes:
    """Render a branded multi-section XLSX workbook (Arabic-safe).

    ``locale="ar"`` flips the sheet view to right-to-left and switches the cell
    font to one with Arabic coverage; the values themselves are written as
    UTF-8 by openpyxl either way.
    """
    from openpyxl import Workbook
    from openpyxl.styles import Alignment, Border, Font, PatternFill, Side
    from openpyxl.utils import get_column_letter

    branding = _branding()
    labels = _copy(locale)
    rtl = is_arabic_locale(locale) or detect_direction(title, *columns) == "rtl"
    header_bg = str(branding.get("primary_color") or "#3F51B5").replace("#", "")
    accent = str(branding.get("accent_color") or "#0D9488").replace("#", "")
    cell_font = EXCEL_FONT_ARABIC if rtl else EXCEL_FONT

    workbook = Workbook()
    sheet = workbook.active
    sheet.title = (sheet_name or "Export")[:31]
    if rtl:  # Excel's own RTL view — headers, frozen panes and scrollbars mirror
        sheet.sheet_view.rightToLeft = True

    horizontal = "right" if rtl else "left"

    # Title band
    sheet.merge_cells(start_row=1, start_column=1, end_row=1, end_column=max(1, len(columns)))
    title_cell = sheet.cell(row=1, column=1, value=f"{branding.get('company_name')} — {title}")
    title_cell.font = Font(size=14, bold=True, color="FFFFFF", name=cell_font)
    title_cell.fill = PatternFill("solid", fgColor=header_bg)
    title_cell.alignment = Alignment(horizontal=horizontal, vertical="center")
    sheet.row_dimensions[1].height = 26

    # Metadata band
    meta_parts = [f"{labels['generated']}: {datetime.utcnow():%Y-%m-%d %H:%M} UTC"]
    for key, value in (metadata or {}).items():
        meta_parts.append(f"{key}: {value}")
    sheet.merge_cells(start_row=2, start_column=1, end_row=2, end_column=max(1, len(columns)))
    meta_cell = sheet.cell(row=2, column=1, value=" · ".join(meta_parts))
    meta_cell.font = Font(size=9, italic=True, color="555555", name=cell_font)
    meta_cell.fill = PatternFill("solid", fgColor="F1F5F9")
    meta_cell.alignment = Alignment(horizontal=horizontal)

    header_fill = PatternFill("solid", fgColor=header_bg)
    accent_fill = PatternFill("solid", fgColor=accent)
    thin = Side(style="thin", color="E2E8F0")
    border = Border(left=thin, right=thin, top=thin, bottom=thin)

    header_row = 4
    for index, column in enumerate(columns, start=1):
        cell = sheet.cell(row=header_row, column=index, value=column)
        cell.font = Font(bold=True, color="FFFFFF", size=10, name=cell_font)
        cell.fill = header_fill
        cell.alignment = Alignment(horizontal="center", vertical="center")
        cell.border = border
    sheet.row_dimensions[header_row].height = 20

    for row_index, row in enumerate(list(rows)[:MAX_ROWS], start=header_row + 1):
        for column_index, column in enumerate(columns, start=1):
            value = row.get(column)
            if isinstance(value, datetime):
                value = value.replace(tzinfo=None)
            cell = sheet.cell(row=row_index, column=column_index, value=value if value is not None else "")
            cell.border = border
            cell.font = Font(size=10, name=cell_font)
            cell.alignment = Alignment(horizontal=horizontal)
            if row_index % 2 == 0:
                cell.fill = PatternFill("solid", fgColor="F8FAFC")

    # Totals strip (sums the numeric columns)
    total_row = header_row + min(len(rows), MAX_ROWS) + 1
    for column_index, column in enumerate(columns, start=1):
        values = [row.get(column) for row in rows[:MAX_ROWS]]
        numeric = [float(v) for v in values if isinstance(v, (int, float)) and not isinstance(v, bool)]
        if numeric and len(numeric) == len([v for v in values if v is not None]):
            cell = sheet.cell(row=total_row, column=column_index, value=round(sum(numeric), 2))
            cell.font = Font(bold=True, color="FFFFFF", size=10, name=cell_font)
            cell.fill = accent_fill
            cell.border = border

    # Column widths — Arabic glyphs need a little more room than Latin text.
    padding = 6 if rtl else 4
    for column_index, column in enumerate(columns, start=1):
        width = max(
            len(str(column)) + padding,
            min(48, max((len(str(row.get(column, ""))) for row in rows[:200]), default=8) + padding),
        )
        sheet.column_dimensions[get_column_letter(column_index)].width = width
    sheet.freeze_panes = sheet.cell(row=header_row + 1, column=1)

    buffer = io.BytesIO()
    workbook.save(buffer)
    return buffer.getvalue()


def _register_pdf_fonts() -> Dict[str, Any]:
    """Register the bundled Amiri family for Arabic (and Latin) PDF text.

    Returns the ``fontName`` handles to use (``regular``/``bold``); if the font
    files are missing the caller falls back to reportlab's built-ins (Latin
    text still renders, Arabic would not — hence the log warning).
    """
    from pathlib import Path

    from reportlab.pdfbase import pdfmetrics
    from reportlab.pdfbase.ttfonts import TTFont

    regular = "Helvetica"
    bold = "Helvetica-Bold"
    fonts_dir = Path(__file__).resolve().parents[1] / "assets" / "fonts"
    try:
        if "Amiri" not in pdfmetrics.getRegisteredFontNames() and (fonts_dir / "Amiri-Regular.ttf").exists():
            pdfmetrics.registerFont(TTFont("Amiri", str(fonts_dir / "Amiri-Regular.ttf")))
            pdfmetrics.registerFont(TTFont("Amiri-Bold", str(fonts_dir / "Amiri-Bold.ttf")))
            pdfmetrics.registerFontFamily("Amiri", normal="Amiri", bold="Amiri-Bold", italic="Amiri", boldItalic="Amiri-Bold")
        if "Amiri" in pdfmetrics.getRegisteredFontNames():
            regular, bold = "Amiri", "Amiri-Bold"
    except Exception as exc:  # pragma: no cover - defensive
        logger.warning("Arabic PDF font registration failed: %s", exc)
    return {"regular": regular, "bold": bold, "arabic": regular != "Helvetica"}


def build_pdf(
    *,
    title: str,
    sections: List[Dict[str, Any]],
    summary_lines: Optional[List[str]] = None,
    locale: Optional[str] = None,
) -> bytes:
    """Render a branded PDF report (title band, KPI block, data tables).

    Arabic content is shaped, right-aligned and laid out right-to-left; Latin
    content is unchanged apart from using the same embedded font.
    """
    from reportlab.lib import colors
    from reportlab.lib.pagesizes import A4, landscape
    from reportlab.lib.enums import TA_LEFT, TA_RIGHT
    from reportlab.lib.styles import ParagraphStyle, getSampleStyleSheet
    from reportlab.lib.units import mm
    from reportlab.platypus import Paragraph, SimpleDocTemplate, Spacer, Table, TableStyle
    from xml.sax.saxutils import escape

    branding = _branding()
    fonts = _register_pdf_fonts()
    labels = _copy(locale)
    primary = colors.HexColor(str(branding.get("primary_color") or "#3F51B5"))
    accent = colors.HexColor(str(branding.get("accent_color") or "#0D9488"))

    body_text = " ".join(
        [str(title)]
        + [str(line) for line in (summary_lines or [])]
        + [str(section.get("title") or "") for section in sections]
        + [" ".join(str(column) for column in (section.get("columns") or [])) for section in sections]
    )
    rtl = is_arabic_locale(locale) or detect_direction(body_text) == "rtl"

    def localise(value: Any) -> str:
        """Shape a string for the canvas (no-op for Latin text)."""
        return shape_arabic(value)

    def paragraph(value: Any, style: ParagraphStyle) -> Paragraph:
        """A Paragraph whose text is escaped and shaped for the canvas."""
        return Paragraph(escape(localise(value) if rtl or has_arabic(value) else str(value)), style)

    buffer = io.BytesIO()
    document = SimpleDocTemplate(
        buffer,
        pagesize=landscape(A4),
        leftMargin=14 * mm,
        rightMargin=14 * mm,
        topMargin=14 * mm,
        bottomMargin=14 * mm,
        title=title,
        author=str(branding.get("company_name") or "RPA CoE"),
        subject=f"{labels['product']} · {title}",
        creator=labels["product"],
    )
    styles = getSampleStyleSheet()
    # TA_RIGHT for Arabic documents: even after shaping, reportlab aligns each
    # paragraph to the page margin we tell it about.
    body_alignment = TA_RIGHT if rtl else TA_LEFT
    base = ParagraphStyle(
        "base",
        parent=styles["Normal"],
        fontName=fonts["regular"],
        fontSize=9,
        leading=13,
        alignment=body_alignment,
    )
    heading = ParagraphStyle(
        "brand",
        parent=styles["Heading1"],
        fontName=fonts["bold"],
        textColor=primary,
        fontSize=18,
        spaceAfter=4,
        alignment=body_alignment,
    )
    subtitle = ParagraphStyle(
        "sub",
        parent=base,
        textColor=colors.HexColor("#5A6884"),
        fontSize=9,
    )
    section_style = ParagraphStyle(
        "section",
        parent=styles["Heading2"],
        fontName=fonts["bold"],
        textColor=accent,
        fontSize=12,
        spaceBefore=10,
        alignment=body_alignment,
    )
    cell_style = ParagraphStyle("cell", parent=base, fontSize=8, leading=11, alignment=body_alignment)
    # NOTE: the report sub-title must use the embedded family as well — the
    # sample stylesheet's Heading2 is Helvetica-Bold, which has no Arabic
    # glyphs and (this is the classic "????" artefact) prints a row of boxes.
    title_style = ParagraphStyle(
        "title",
        parent=base,
        fontName=fonts["bold"],
        fontSize=13,
        leading=17,
        spaceAfter=2,
        alignment=body_alignment,
    )

    story: List[Any] = [
        paragraph(str(branding.get("company_name") or "RPA CoE"), heading),
        paragraph(title, title_style),
        paragraph(f"{labels['generated']} {datetime.utcnow():%Y-%m-%d %H:%M} UTC · {labels['product']}", subtitle),
        Spacer(1, 6 * mm),
    ]

    if summary_lines:
        summary_table = Table(
            [[paragraph(line, base)] for line in summary_lines],
            colWidths=[250 * mm],
            style=TableStyle(
                [
                    ("BACKGROUND", (0, 0), (-1, -1), colors.HexColor("#F6F8FC")),
                    ("BOX", (0, 0), (-1, -1), 0.5, colors.HexColor("#E2E8F0")),
                    ("LINEBEFORE", (0, 0), (0, -1), 2, accent) if not rtl else ("LINEAFTER", (0, 0), (0, -1), 2, accent),
                    ("LEFTPADDING", (0, 0), (-1, -1), 8),
                    ("RIGHTPADDING", (0, 0), (-1, -1), 8),
                    ("TOPPADDING", (0, 0), (-1, -1), 6),
                    ("BOTTOMPADDING", (0, 0), (-1, -1), 6),
                ]
            ),
        )
        story.extend([summary_table, Spacer(1, 6 * mm)])

    for section in sections:
        story.append(paragraph(str(section.get("title") or ""), section_style))
        columns = list(section.get("columns") or [])
        rows = list(section.get("rows") or [])[:400]
        if not columns:
            continue
        # RTL documents mirror the table: the first logical column is drawn
        # right-most, exactly as a reader of Arabic expects.
        drawn_columns = list(reversed(columns)) if rtl else columns
        header = [paragraph(column, ParagraphStyle("th", parent=base, fontName=fonts["bold"], textColor=colors.white)) for column in drawn_columns]
        data: List[List[Any]] = [header]
        for row in rows:
            data.append([paragraph(str(row.get(column, ""))[:80], cell_style) for column in drawn_columns])
        table = Table(data, repeatRows=1)
        alignment = "RIGHT" if rtl else "LEFT"
        table.setStyle(
            TableStyle(
                [
                    ("BACKGROUND", (0, 0), (-1, 0), primary),
                    ("TEXTCOLOR", (0, 0), (-1, 0), colors.white),
                    ("FONTNAME", (0, 0), (-1, -1), fonts["regular"]),
                    ("FONTSIZE", (0, 0), (-1, -1), 8),
                    ("GRID", (0, 0), (-1, -1), 0.25, colors.HexColor("#D3DBE8")),
                    ("ROWBACKGROUNDS", (0, 1), (-1, -1), [colors.white, colors.HexColor("#F8FAFD")]),
                    ("VALIGN", (0, 0), (-1, -1), "MIDDLE"),
                    ("ALIGN", (0, 0), (-1, -1), alignment),
                    ("LEFTPADDING", (0, 0), (-1, -1), 4),
                    ("RIGHTPADDING", (0, 0), (-1, -1), 4),
                ]
            )
        )
        story.extend([table, Spacer(1, 5 * mm)])

    def _footer(canvas: Any, doc: Any) -> None:  # pragma: no cover - drawing hook
        canvas.saveState()
        canvas.setFillColor(accent)
        canvas.rect(0, A4[1] - 6 * mm, landscape(A4)[0], 6 * mm, stroke=0, fill=1)
        canvas.setFont(fonts["regular"], 7)
        canvas.setFillColor(colors.HexColor("#5A6884"))
        footer_left = localise(f"{branding.get('name')} · {labels['confidential']}")
        canvas.drawString(14 * mm, 8 * mm, footer_left)
        canvas.drawRightString(landscape(A4)[0] - 14 * mm, 8 * mm, f"{labels['page']} {doc.page}")
        canvas.restoreState()

    document.build(story, onFirstPage=_footer, onLaterPages=_footer)
    return buffer.getvalue()


def excel_mime() -> str:
    """Content type for XLSX downloads."""
    return "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"


def pdf_mime() -> str:
    """Content type for PDF downloads."""
    return "application/pdf"
