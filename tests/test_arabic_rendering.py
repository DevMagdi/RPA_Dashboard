"""Arabic / Unicode correctness — the "????" defect, layer by layer.

The client saw ``????`` where Arabic text belonged.  That symptom can be
produced by five independent layers, so this file proves each one is fixed
rather than trusting a single screenshot:

1. **Storage** — SQL Server ``VARCHAR`` (non-Unicode) columns destroyed Arabic
   at write time.  ``test_sqlserver_ddl_is_unicode`` compiles the real schema
   for the mssql dialect and requires ``NVARCHAR`` for every text column;
   ``test_arabic_round_trip_through_the_database`` proves the value survives a
   write/read cycle, and ``test_existing_installations_get_a_migration`` checks
   the checked-in upgrade script is still in sync with the metadata.
2. **HTTP headers** — a non-ASCII file name cannot be encoded as latin-1.
   ``test_content_disposition_*`` require the RFC 5987 form.
3. **PDF export** — reportlab's built-in fonts have no Arabic glyphs and no
   shaping engine.  ``test_pdf_export_contains_shaped_arabic`` extracts the
   text back out of the generated PDF and requires Arabic glyphs, no boxes and
   no ``?``.
4. **Excel export** — ``test_excel_export_is_right_to_left`` checks the sheet
   view flag and the Arabic cell values.
5. **Browser fonts** — the glyphs only exist if a self-hosted Arabic font ships
   with the SPA (``test_bundled_webfonts_cover_arabic_shaping``).
6. **Service logs** — a Windows Service runs on a legacy console code page, so
   the log handler itself replaced Arabic with ``?``.  The handler stack is now
   forced to UTF-8 (``test_service_logs_are_utf8_safe_on_a_legacy_windows_console``).
"""

from __future__ import annotations

import io
import re
from pathlib import Path

import pytest

from app.core.text import (
    ARABIC_RANGES,
    ascii_slug,
    bidi_isolate,
    contains_arabic,
    content_disposition,
    detect_direction,
    has_arabic,
    is_arabic_locale,
    shape_arabic,
)

REPO_ROOT = Path(__file__).resolve().parents[1]
FRONTEND_FONTS = REPO_ROOT / "rpa-dashboard" / "public" / "fonts"
PDF_FONTS = REPO_ROOT / "app" / "assets" / "fonts"
ARABIC_SAMPLE = "تقرير الأداء التشغيلي — معالجة الفواتير"
MIXED_SAMPLE = "Process: معالجة الفواتير (AUTH-2026-0001) — 42%"


def _arabic_glyph_count(text: str) -> int:
    return sum(1 for char in text if any(low <= ord(char) <= high for low, high in ARABIC_RANGES))


# --------------------------------------------------------------------------- #
# 1. Text helpers
# --------------------------------------------------------------------------- #
def test_arabic_detection_and_direction():
    assert has_arabic(ARABIC_SAMPLE) is True
    assert has_arabic("Invoice processing") is False
    assert has_arabic(None) is False
    assert contains_arabic("English only", ARABIC_SAMPLE) is True
    assert is_arabic_locale("ar") is True
    assert is_arabic_locale("ar-EG") is True
    assert is_arabic_locale("ar_SA") is True
    assert is_arabic_locale("en") is False
    assert detect_direction(ARABIC_SAMPLE) == "rtl"
    assert detect_direction("Monthly ROI report") == "ltr"
    assert detect_direction(MIXED_SAMPLE) == "ltr" or detect_direction(MIXED_SAMPLE) == "rtl"


def test_shaping_produces_presentation_forms_in_visual_order():
    """A PDF canvas has no shaping engine: we must hand it presentation forms."""
    shaped = shape_arabic(ARABIC_SAMPLE)
    assert shaped != ARABIC_SAMPLE
    # Arabic Presentation Forms-B (U+FE70–U+FEFF) is what reportlab can draw.
    assert re.search(r"[\uFE70-\uFEFF]", shaped), shaped
    assert _arabic_glyph_count(shaped) > 0
    # Latin text is never touched.
    assert shape_arabic("Invoice processing") == "Invoice processing"


def test_bidi_isolate_keeps_mixed_content_readable():
    isolated = bidi_isolate(MIXED_SAMPLE)
    assert isolated.startswith("\u2067") and isolated.endswith("\u2069")
    assert MIXED_SAMPLE in isolated


def test_ascii_slug_never_emits_question_marks():
    slug = ascii_slug(ARABIC_SAMPLE)
    assert "?" not in slug
    assert slug.isascii()
    assert slug  # falls back to a usable stem
    assert ascii_slug("audit_trail_20261014") == "audit_trail_20261014"


def test_content_disposition_uses_rfc_5987_for_arabic_file_names():
    header = content_disposition("سجل_التدقيق_20261014.xlsx")
    assert "filename*=UTF-8''" in header
    assert "%D8%B3%D8%AC%D9%84" in header  # URL-encoded Arabic
    # The fallback parameter must remain encodable as latin-1 (ASGI headers).
    fallback = re.search(r'filename="([^"]*)"', header)
    assert fallback, header
    fallback.group(1).encode("latin-1")
    assert "?" not in fallback.group(1)


def test_content_disposition_is_a_noop_for_ascii_names():
    header = content_disposition("runs_20261014.xlsx", disposition="attachment")
    assert header == 'attachment; filename="runs_20261014.xlsx"'
    assert "filename*" not in header


# --------------------------------------------------------------------------- #
# 2. Storage layer
# --------------------------------------------------------------------------- #
def test_sqlserver_ddl_is_unicode():
    """Every text column must be NVARCHAR on SQL Server, not VARCHAR."""
    from sqlalchemy.dialects import mssql
    from sqlalchemy.schema import CreateTable

    from app.db.tables import metadata

    non_unicode: list[str] = []
    for table in metadata.tables.values():
        ddl = str(CreateTable(table).compile(dialect=mssql.dialect()))
        for line in ddl.splitlines():
            # A bare VARCHAR(...) column is the defect; NVARCHAR is correct.
            if re.search(r"\bVARCHAR\s*\(", line) and "NVARCHAR" not in line:
                non_unicode.append(f"{table.name}: {line.strip()}")
    assert non_unicode == [], "SQL Server text columns must be NVARCHAR:\n" + "\n".join(non_unicode[:10])

    # And the fix must not leak into the other dialects as a type change.
    from sqlalchemy.dialects import sqlite

    ddl = str(CreateTable(metadata.tables["ProcessConfig"]).compile(dialect=sqlite.dialect()))
    assert "NVARCHAR" not in ddl


def test_existing_installations_get_a_migration_without_drift():
    """The DBA script must match the metadata — no silently missed column."""
    from app.db.unicode_upgrade import oversized_index_columns, script, upgrade_statements

    on_disk = (REPO_ROOT / "db" / "migrations" / "sqlserver" / "005_unicode_nvarchar_upgrade.sql").read_text(encoding="utf-8")
    assert on_disk == script(), "regenerate with: python -m app.db.unicode_upgrade --print"

    statements = upgrade_statements()
    alters = [statement for statement in statements if "ALTER TABLE" in statement]
    assert len(alters) >= 100
    assert all("NVARCHAR(" in statement for statement in alters)
    # Idempotent: every ALTER is guarded by a type check.
    assert all("t.name <> N'nvarchar'" in statement for statement in alters)
    # SQL Server index keys are limited (2 bytes per NVARCHAR char).
    assert oversized_index_columns() == []


def test_arabic_round_trip_through_the_database(client, admin_headers):
    """A value written through the API comes back byte-identical.

    This is the regression test for the *data* half of the "????" defect: with
    ``VARCHAR`` columns the row existed but its Arabic characters were already
    gone by the time anything could read it back.
    """
    name = "معالجة الفواتير الآلية — اختبار الترميز"
    created = client.post(
        "/api/update-roi",
        json={
            "ProcessName": name,
            "EmpMinutesPerRequest": 4,
            "EmpCostPerRequest": 12.5,
            "BotCostPerRequest": 1.25,
            "ExpectedRunsPerDay": 30,
            "Department": "العمليات",
            "Criticality": "High",
        },
        headers=admin_headers,
    )
    assert created.status_code in (200, 201), created.text

    listing = client.get("/api/processes", params={"search": "اختبار الترميز", "limit": 20}, headers=admin_headers)
    assert listing.status_code == 200, listing.text
    items = listing.json()["items"]
    assert items, "the Arabic process name did not survive the write"

    stored = items[0].get("process_name") or items[0].get("ProcessName")
    assert stored == name, f"{stored!r} != {name!r}"
    assert "?" not in stored
    # The em dash is a non-ASCII character too — it must survive as itself.
    assert "—" in stored


# --------------------------------------------------------------------------- #
# 3. Excel / PDF exports
# --------------------------------------------------------------------------- #
def test_excel_export_is_right_to_left_and_keeps_arabic():
    from openpyxl import load_workbook

    from app.services.export_service import build_excel

    payload = build_excel(
        title="سجل التدقيق",
        columns=["الاسم", "الإجراء"],
        rows=[{"الاسم": "أحمد محمود", "الإجراء": "تسجيل الدخول"}],
        sheet_name="سجل",
        locale="ar",
    )
    sheet = load_workbook(io.BytesIO(payload)).active
    assert sheet.sheet_view.rightToLeft is True
    assert sheet["A1"].value.endswith("سجل التدقيق")
    values = [cell.value for row in sheet.iter_rows() for cell in row if isinstance(cell.value, str)]
    assert "أحمد محمود" in values
    assert not any("?" in value for value in values)


def test_pdf_export_contains_shaped_arabic():
    """Extract the text back out of the PDF — no boxes, no question marks."""
    pypdf = pytest.importorskip("pypdf")

    from app.services.export_service import build_pdf

    payload = build_pdf(
        title="تقرير الأداء التشغيلي",
        summary_lines=["عدد العمليات: 24 · الساعات الموفرة: 128.5"],
        sections=[
            {
                "title": "توزيع الأحمال",
                "columns": ["العملية", "الحالة"],
                "rows": [{"العملية": "معالجة الفواتير", "الحالة": "مكتمل"}],
            }
        ],
        locale="ar",
    )
    reader = pypdf.PdfReader(io.BytesIO(payload))
    text = "\n".join(page.extract_text() or "" for page in reader.pages)

    assert _arabic_glyph_count(text) > 20, text[:200]
    assert "\u25a0" not in text  # reportlab's "missing glyph" box
    assert "?" not in text
    # The bundled Arabic font must be embedded, not referenced from the reader.
    assert "Amiri" in str(payload[:20000]) or b"Amiri" in payload


def test_pdf_export_requires_no_arabic_for_english_reports():
    pypdf = pytest.importorskip("pypdf")

    from app.services.export_service import build_pdf

    payload = build_pdf(
        title="Run history",
        sections=[{"title": "Runs", "columns": ["RunID", "Status"], "rows": [{"RunID": 1, "Status": "Success"}]}],
        locale="en",
    )
    text = "\n".join(page.extract_text() or "" for page in pypdf.PdfReader(io.BytesIO(payload)).pages)
    assert "Run history" in text
    assert "?" not in text


def test_report_copy_is_bilingual_and_complete():
    from app.services.export_service import COPY, report_copy

    english, arabic = report_copy("en"), report_copy("ar")
    assert set(english) == set(arabic), "EN/AR copy must expose the same keys"
    assert set(english) == set(COPY["en"])
    for key in ("audit_title", "runs_title", "roi_title", "capacity_title", "file_audit"):
        assert arabic[key] != english[key] or key.startswith("file_")
        if key.startswith("file_"):
            continue
        assert has_arabic(arabic[key]), f"{key} is not Arabic"


def test_export_endpoints_send_arabic_safe_download_headers(client, admin_headers):
    """The file name header must survive the latin-1 header encoding."""
    response = client.get("/api/exports/audit.xlsx?days=7&locale=ar", headers=admin_headers)
    assert response.status_code == 200, response.text
    assert response.headers["content-type"].startswith(
        "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
    )
    disposition = response.headers["content-disposition"]
    assert "filename*=UTF-8''" in disposition
    assert response.content[:2] == b"PK"  # a real workbook

    english = client.get("/api/exports/runs.xlsx?days=7&locale=en", headers=admin_headers)
    assert english.status_code == 200
    assert 'filename="runs_' in english.headers["content-disposition"]


# --------------------------------------------------------------------------- #
# 4. Browser fonts
# --------------------------------------------------------------------------- #
def test_bundled_webfonts_cover_arabic_shaping():
    """The SPA must ship the glyphs — an air-gapped bank has no font CDN."""
    cairo = FRONTEND_FONTS / "cairo-arabic-wght-normal.woff2"
    assert cairo.exists() and cairo.stat().st_size > 10_000
    assert (FRONTEND_FONTS / "inter-latin-wght-normal.woff2").exists()

    font_tools = pytest.importorskip("fontTools")
    assert font_tools  # silence the unused import check

    from fontTools.ttLib import TTFont

    cmap = TTFont(cairo, lazy=True).getBestCmap()
    for char in "ابتثجحخدذرزسشصضطظعغفقكلمنهوي،؛؟":
        assert ord(char) in cmap, f"Cairo subset is missing {char!r}"
    # Arabic digits and the tatweel/hamza forms the UI can render.
    for char in "٠١٢٣٤٥٦٧٨٩ـ":
        assert ord(char) in cmap, f"Cairo subset is missing {char!r}"


def test_service_logs_are_utf8_safe_on_a_legacy_windows_console():
    """A cp1256/cp437 console must not turn Arabic log lines into ``?``."""
    import logging
    import sys

    from app.core.logging import configure_logging, configure_stream_encoding

    legacy = io.TextIOWrapper(io.BytesIO(), encoding="cp1256", errors="replace")
    stream = configure_stream_encoding(legacy)
    assert stream is legacy
    assert "utf8" in (stream.encoding or "").lower().replace("-", "")
    assert stream.errors == "backslashreplace", "a lost glyph must escape, never become '?'"

    original = sys.stdout
    sys.stdout = stream
    try:
        configure_logging(force=True)
        logging.getLogger("arabic.rendering").info("تم تشغيل العملية — تقرير العائد ١٢٣٤٥")
        stream.flush()
    finally:
        sys.stdout = original

    text = legacy.buffer.getvalue().decode("utf-8")
    assert "تم تشغيل العملية" in text
    assert "?" not in text
    assert has_arabic(text)


def test_pdf_font_has_the_arabic_glyph_forms_a_canvas_needs():
    regular = PDF_FONTS / "Amiri-Regular.ttf"
    bold = PDF_FONTS / "Amiri-Bold.ttf"
    assert regular.exists() and bold.exists()
    assert (PDF_FONTS / "LICENSE-Amiri-OFL.txt").exists(), "the OFL text must ship with the font"

    pytest.importorskip("fontTools")
    from fontTools.ttLib import TTFont

    font = TTFont(regular, lazy=True)
    cmap = font.getBestCmap()
    shaped = shape_arabic(ARABIC_SAMPLE)
    missing = sorted({char for char in shaped if char.strip() and ord(char) not in cmap})
    assert missing == [], f"Amiri cannot draw: {missing[:10]}"
    assert "GSUB" in font, "an Arabic font without GSUB cannot join letters"
