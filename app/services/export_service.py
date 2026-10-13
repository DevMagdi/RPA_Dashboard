"""Branded exports: Excel (openpyxl) and PDF (reportlab).

Banks need evidence artefacts: an audit extract for the regulator, a monthly
ROI pack for the steering committee, a run history for an incident review.
Both formats are generated **with the organization branding** (colours, company name)
so the same product can be white-labelled per client.
"""

from __future__ import annotations

import io
import logging
from datetime import datetime
from typing import Any, Dict, List, Optional, Sequence

from app.services.organization_service import get_branding

logger = logging.getLogger(__name__)

MAX_ROWS = 50_000


def _branding() -> Dict[str, Any]:
    """Fetch branding with a safe fallback (never blocks an export)."""
    try:
        from app.db.session import session_scope

        with session_scope() as session:
            return get_branding(session)
    except Exception as exc:  # pragma: no cover - defensive
        logger.warning("Branding lookup failed: %s", exc)
        return {"company_name": "RPA CoE", "name": "RPA CoE Control Room", "primary_color": "#4B367C", "accent_color": "#F37920"}


def build_excel(
    *,
    
    title: str,
    columns: Sequence[str],
    rows: Sequence[Dict[str, Any]],
    sheet_name: str = "Export",
    metadata: Optional[Dict[str, Any]] = None,
) -> bytes:
    """Render a branded multi-section XLSX workbook."""
    from openpyxl import Workbook
    from openpyxl.styles import Alignment, Border, Font, PatternFill, Side
    from openpyxl.utils import get_column_letter

    branding = _branding()
    header_bg = str(branding.get("primary_color") or "#4B367C").replace("#", "")
    accent = str(branding.get("accent_color") or "#F37920").replace("#", "")

    workbook = Workbook()
    sheet = workbook.active
    sheet.title = (sheet_name or "Export")[:31]

    # Title band
    sheet.merge_cells(start_row=1, start_column=1, end_row=1, end_column=max(1, len(columns)))
    title_cell = sheet.cell(row=1, column=1, value=f"{branding.get('company_name')} — {title}")
    title_cell.font = Font(size=14, bold=True, color="FFFFFF")
    title_cell.fill = PatternFill("solid", fgColor=header_bg)
    title_cell.alignment = Alignment(horizontal="left", vertical="center")
    sheet.row_dimensions[1].height = 26

    # Metadata band
    meta_parts = [f"Generated: {datetime.utcnow():%Y-%m-%d %H:%M} UTC"]
    for key, value in (metadata or {}).items():
        meta_parts.append(f"{key}: {value}")
    sheet.merge_cells(start_row=2, start_column=1, end_row=2, end_column=max(1, len(columns)))
    meta_cell = sheet.cell(row=2, column=1, value=" · ".join(meta_parts))
    meta_cell.font = Font(size=9, italic=True, color="555555")
    meta_cell.fill = PatternFill("solid", fgColor="F1F5F9")

    header_fill = PatternFill("solid", fgColor=header_bg)
    accent_fill = PatternFill("solid", fgColor=accent)
    thin = Side(style="thin", color="E2E8F0")
    border = Border(left=thin, right=thin, top=thin, bottom=thin)

    header_row = 4
    for index, column in enumerate(columns, start=1):
        cell = sheet.cell(row=header_row, column=index, value=column)
        cell.font = Font(bold=True, color="FFFFFF", size=10)
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
            cell.font = Font(size=10)
            if row_index % 2 == 0:
                cell.fill = PatternFill("solid", fgColor="F8FAFC")

    # Totals strip (sums the numeric columns)
    total_row = header_row + min(len(rows), MAX_ROWS) + 1
    for column_index, column in enumerate(columns, start=1):
        values = [row.get(column) for row in rows[:MAX_ROWS]]
        numeric = [float(v) for v in values if isinstance(v, (int, float)) and not isinstance(v, bool)]
        if numeric and len(numeric) == len([v for v in values if v is not None]):
            cell = sheet.cell(row=total_row, column=column_index, value=round(sum(numeric), 2))
            cell.font = Font(bold=True, color="FFFFFF", size=10)
            cell.fill = accent_fill
            cell.border = border

    # Column widths
    for column_index, column in enumerate(columns, start=1):
        width = max(
            len(str(column)) + 4,
            min(48, max((len(str(row.get(column, ""))) for row in rows[:200]), default=8) + 4),
        )
        sheet.column_dimensions[get_column_letter(column_index)].width = width
    sheet.freeze_panes = sheet.cell(row=header_row + 1, column=1)

    buffer = io.BytesIO()
    workbook.save(buffer)
    return buffer.getvalue()


def build_pdf(
    *,
    
    title: str,
    sections: List[Dict[str, Any]],
    summary_lines: Optional[List[str]] = None,
) -> bytes:
    """Render a branded PDF report (title page band, KPI table, data tables)."""
    from reportlab.lib import colors
    from reportlab.lib.pagesizes import A4, landscape
    from reportlab.lib.styles import ParagraphStyle, getSampleStyleSheet
    from reportlab.lib.units import mm
    from reportlab.platypus import Paragraph, SimpleDocTemplate, Spacer, Table, TableStyle

    branding = _branding()
    primary = colors.HexColor(str(branding.get("primary_color") or "#4B367C"))
    accent = colors.HexColor(str(branding.get("accent_color") or "#F37920"))

    buffer = io.BytesIO()
    document = SimpleDocTemplate(
        buffer,
        pagesize=landscape(A4),
        leftMargin=14 * mm,
        rightMargin=14 * mm,
        topMargin=14 * mm,
        bottomMargin=14 * mm,
        title=title,
    )
    styles = getSampleStyleSheet()
    heading = ParagraphStyle("brand", parent=styles["Heading1"], textColor=primary, fontSize=18, spaceAfter=4)
    subtitle = ParagraphStyle("sub", parent=styles["Normal"], textColor=colors.HexColor("#64748B"), fontSize=9)
    section_style = ParagraphStyle("section", parent=styles["Heading2"], textColor=accent, fontSize=12, spaceBefore=10)

    story: List[Any] = [
        Paragraph(str(branding.get("company_name") or "RPA CoE"), heading),
        Paragraph(title, styles["Heading2"]),
        Paragraph(f"Generated {datetime.utcnow():%Y-%m-%d %H:%M} UTC · RPA CoE Control Room", subtitle),
        Spacer(1, 6 * mm),
    ]

    if summary_lines:
        summary_table = Table([[Paragraph(line, styles["Normal"])] for line in summary_lines], colWidths=[250 * mm])
        summary_table.setStyle(
            TableStyle(
                [
                    ("BACKGROUND", (0, 0), (-1, -1), colors.HexColor("#F8FAFC")),
                    ("BOX", (0, 0), (-1, -1), 0.5, colors.HexColor("#E2E8F0")),
                    ("LEFTPADDING", (0, 0), (-1, -1), 8),
                    ("TOPPADDING", (0, 0), (-1, -1), 6),
                    ("BOTTOMPADDING", (0, 0), (-1, -1), 6),
                ]
            )
        )
        story.extend([summary_table, Spacer(1, 6 * mm)])

    for section in sections:
        story.append(Paragraph(str(section.get("title") or ""), section_style))
        columns = list(section.get("columns") or [])
        rows = list(section.get("rows") or [])[:400]
        if not columns:
            continue
        data = [columns] + [[str(row.get(column, ""))[:60] for column in columns] for row in rows]
        table = Table(data, repeatRows=1)
        table.setStyle(
            TableStyle(
                [
                    ("BACKGROUND", (0, 0), (-1, 0), primary),
                    ("TEXTCOLOR", (0, 0), (-1, 0), colors.white),
                    ("FONTNAME", (0, 0), (-1, 0), "Helvetica-Bold"),
                    ("FONTSIZE", (0, 0), (-1, -1), 8),
                    ("GRID", (0, 0), (-1, -1), 0.25, colors.HexColor("#CBD5E1")),
                    ("ROWBACKGROUNDS", (0, 1), (-1, -1), [colors.white, colors.HexColor("#F8FAFC")]),
                    ("VALIGN", (0, 0), (-1, -1), "MIDDLE"),
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
        canvas.setFont("Helvetica", 7)
        canvas.setFillColor(colors.HexColor("#64748B"))
        canvas.drawString(14 * mm, 8 * mm, f"{branding.get('name')} · confidential")
        canvas.drawRightString(landscape(A4)[0] - 14 * mm, 8 * mm, f"Page {doc.page}")
        canvas.restoreState()

    document.build(story, onFirstPage=_footer, onLaterPages=_footer)
    return buffer.getvalue()


def excel_mime() -> str:
    """Content type for XLSX downloads."""
    return "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"


def pdf_mime() -> str:
    """Content type for PDF downloads."""
    return "application/pdf"
