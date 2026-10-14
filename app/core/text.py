"""Arabic / bilingual text handling — the "????" fix.

A bank deployment of the Control Room is bilingual: the interface, the audit
trail, the process catalogue and every exported artefact carry Arabic next to
English.  Arabic is the one script where a *single* wrong layer in the stack
turns an entire screen into ``????`` or ``???`` instead of the expected text:

===========================================  ==========================================================
Layer                                        Failure it produces
===========================================  ==========================================================
**SQL Server columns**                       ``VARCHAR`` stores one byte per character under a Latin
                                             collation: Arabic (and any non-ASCII name) collapses to
                                             ``????`` *at write time* — the data is gone forever.
                                             ``app/db/tables.py`` now declares ``NVARCHAR``/``Unicode``
                                             columns and :mod:`app.db.unicode_upgrade` repairs an
                                             existing database in place.
**HTTP headers**                             Header values are encoded as latin-1 by the ASGI server, so
                                             ``Content-Disposition: filename="تقرير.pdf"`` raises or is
                                             mangled.  :func:`content_disposition` emits the RFC 5987
                                             ``filename*=UTF-8''`` form with an ASCII fallback.
**PDF export**                               reportlab's built-in Helvetica has no Arabic glyphs and no
                                             shaping engine, so an Arabic PDF prints dots/boxes/``?``.
                                             :func:`shape_arabic` produces the contextual (presentation)
                                             forms in visual order and :mod:`app.services.export_service`
                                             embeds a bundled Arabic-capable TTF.
**Terminals / logs**                         A Windows console at code page 437 writes ``?`` for Arabic
                                             log lines.  ``ENV=production`` logging is told to use UTF-8
                                             (see ``app/core/logging.py``).
**Browser fonts**                            A workstation without an Arabic font shows tofu boxes even
                                             when the bytes are perfect.  The SPA self-hosts Cairo +
                                             Inter (``rpa-dashboard/public/fonts``) so glyphs are always
                                             present, air-gapped included.
===========================================  ==========================================================

The helpers here are deliberately dependency-tolerant: if the optional
shaping libraries are missing the export path degrades to logical-order text
with a warning instead of breaking a scheduled report.
"""

from __future__ import annotations

import logging
import re
import unicodedata
from typing import Optional
from urllib.parse import quote

logger = logging.getLogger(__name__)

#: Every code-point block that carries Arabic script (letters, marks, the
#: presentation forms a PDF needs, and the Arabic-Indic digits).
ARABIC_RANGES = (
    (0x0600, 0x06FF),  # Arabic
    (0x0750, 0x077F),  # Arabic Supplement
    (0x0870, 0x08FF),  # Arabic Extended-A/B
    (0xFB50, 0xFDFF),  # Arabic Presentation Forms-A
    (0xFE70, 0xFEFF),  # Arabic Presentation Forms-B
)

_ARABIC_CHAR = re.compile("[" + "".join(f"\\u{lo:04x}-\\u{hi:04x}" for lo, hi in ARABIC_RANGES) + "]")

#: Strong right-to-left characters (Arabic/Hebrew) — used by ``detect_direction``.
_RTL_CHARS = re.compile(r"[\u0590-\u05ff\u0600-\u06ff\u0750-\u077f\ufb1d-\ufdff\ufe70-\ufeff]")

#: Unicode isolates (LRI/RLI/PDI) keep mixed digit runs readable in a single
#: DOM text node: ``{isolate('١٢٣ ABC', rtl=True)}``.
_LRI, _RLI, _PDI = "\u2066", "\u2067", "\u2069"

_shaping_ready: Optional[bool] = None


def has_arabic(value: object) -> bool:
    """``True`` when *value* contains at least one Arabic character."""
    if value is None:
        return False
    return bool(_ARABIC_CHAR.search(str(value)))


def contains_arabic(*values: object) -> bool:
    """``True`` when **any** of the given values contains Arabic text."""
    return any(has_arabic(value) for value in values)


def is_arabic_locale(locale: Optional[str]) -> bool:
    """``True`` for ``ar``, ``ar-EG``, ``ar_SA`` … (case-insensitive)."""
    return bool(locale) and str(locale).strip().lower().replace("_", "-").startswith("ar")


def detect_direction(*values: object) -> str:
    """Return ``"rtl"`` when the content is predominantly Arabic, else ``"ltr"``.

    Used to flip tables, headers and page furniture in generated reports so an
    Arabic export reads right-to-left without a separate template.
    """
    text = " ".join(str(value) for value in values if value)
    rtl = len(_RTL_CHARS.findall(text))
    if rtl == 0:
        return "ltr"
    latin = len(re.findall(r"[A-Za-z]", text))
    return "rtl" if rtl >= latin else "ltr"


def shaping_available() -> bool:
    """Whether the optional ``arabic-reshaper``/``python-bidi`` stack imports."""
    global _shaping_ready
    if _shaping_ready is None:
        try:  # pragma: no cover - exercised implicitly by the export tests
            import arabic_reshaper
            from bidi.algorithm import get_display

            if not callable(arabic_reshaper.reshape) or not callable(get_display):
                raise ImportError("Arabic shaping entry points are unavailable")
            _shaping_ready = True
        except Exception:  # pragma: no cover - degraded deployments
            logger.warning(
                "Arabic shaping libraries are missing — PDF text will be written in logical order. "
                "Install arabic-reshaper and python-bidi for correct reports."
            )
            _shaping_ready = False
    return _shaping_ready


def shape_arabic(value: object, *, insert_isolates: bool = False) -> str:
    """Return *value* ready for a renderer that has **no** Arabic engine.

    reportlab (and every other canvas-style PDF writer) draws glyph runs
    left-to-right with no notion of joining or of the bidirectional algorithm.
    This converts Arabic letters to their contextual presentation forms
    (``arabic-reshaper``) and reorders the line for visual reading
    (``python-bidi``).

    Non-Arabic input is returned unchanged, so the same call site can be used
    for every string in a bilingual report.
    """
    text = "" if value is None else str(value)
    if not text or not has_arabic(text):
        return text
    if insert_isolates:
        return bidi_isolate(text, rtl=True)
    if not shaping_available():  # pragma: no cover - degraded deployments
        return text
    try:
        import arabic_reshaper
        from bidi.algorithm import get_display

        return get_display(arabic_reshaper.reshape(text))
    except Exception as exc:  # pragma: no cover - never break an export
        logger.warning("Arabic shaping failed (%s) — writing logical order", exc)
        return text


def bidi_isolate(value: object, *, rtl: bool = True) -> str:
    """Wrap *value* in Unicode isolates so mixed text keeps its own direction."""
    text = "" if value is None else str(value)
    if not text:
        return text
    return f"{_RLI if rtl else _LRI}{text}{_PDI}"


def ascii_slug(value: object, *, fallback: str = "export", max_length: int = 60) -> str:
    """Transliterate-ish ASCII slug safe for a ``filename=`` header parameter.

    Arabic characters are **dropped** (not replaced by ``?``): the human
    readable Arabic name travels in the RFC 5987 parameter instead, and this
    value is only the legacy fallback every client understands.
    """
    text = unicodedata.normalize("NFKD", "" if value is None else str(value))
    keep = [ch if (ch.isascii() and (ch.isalnum() or ch in "-_")) else "-" for ch in text]
    slug = re.sub(r"-{2,}", "-", "".join(keep)).strip("-_")
    if not slug:
        slug = fallback
    return slug[:max_length].strip("-_") or fallback


def content_disposition(filename: str, *, disposition: str = "attachment") -> str:
    """Build a header value that survives Arabic (or accented) file names.

    ``filename="…"`` is encoded as latin-1 by the ASGI layer, which makes
    ``تقرير.pdf`` an error or a row of ``?``.  RFC 5987's ``filename*=UTF-8''``
    parameter is understood by every current browser, and the plain parameter
    is kept as an ASCII-only fallback for old clients and download managers.
    """
    name = (filename or "").strip() or "export"
    ascii_name = name
    if not name.isascii():
        # Keep the extension so the fallback is still openable.
        stem, _, extension = name.rpartition(".")
        suffix = f".{extension}" if stem and re.fullmatch(r"[A-Za-z0-9]{1,5}", extension or "") else ""
        ascii_name = f"{ascii_slug(stem or name)}{suffix}"
    header = f'{disposition}; filename="{ascii_name}"'
    encoded = quote(name, safe="")
    if encoded != ascii_name:
        header = f"{header}; filename*=UTF-8''{encoded}"
    return header


def display_name(value: object, *, fallback: str = "") -> str:
    """Text for a UI/audit string: NFC-normalised, trimmed, never ``None``."""
    text = unicodedata.normalize("NFC", "" if value is None else str(value)).strip()
    return text or fallback
