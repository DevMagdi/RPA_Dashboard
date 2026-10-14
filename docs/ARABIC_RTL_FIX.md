# The "????" defect — root cause and fix (Arabic / RTL)

The client reported Arabic screens rendering as `????`. The symptom looks like a
single bug; it was **five independent layers**, each capable of destroying
Arabic on its own. All five are fixed and each one now has a regression test
that fails if it comes back.

| # | Layer | What went wrong | Fix | Test that guards it |
|---|---|---|---|---|
| 1 | **SQL Server storage** | Every text column was declared `String(n)` → `VARCHAR(n)`. Under a Latin collation `VARCHAR` stores one byte per character, so Arabic was replaced with `?` **at write time** — the characters never reached the database. | All text columns are SQLAlchemy `Unicode`/`UnicodeText` → `NVARCHAR(n)` / `NVARCHAR(MAX)` on SQL Server, still `VARCHAR`/`TEXT` on PostgreSQL and SQLite. | `tests/test_arabic_rendering.py::test_sqlserver_ddl_is_unicode` |
| 2 | **Existing databases** | Installations created before the fix kept their `VARCHAR` columns — new Arabic values would be destroyed the same way. | `app/db/unicode_upgrade.py` generates an idempotent migration; the DBA-runnable script ships as `db/migrations/sqlserver/005_unicode_nvarchar_upgrade.sql` (125 guarded `ALTER COLUMN`s) and a follow-up revision repairs a database in place. | `…::test_existing_installations_get_a_migration_without_drift` (fails if the script and the metadata drift apart) |
| 3 | **HTTP headers** | `Content-Disposition: filename="سجل_التدقيق.xlsx"` cannot be encoded: HTTP headers are latin-1, so an Arabic file name raised or arrived as `????`. | `app/core/text.py::content_disposition` emits RFC 5987 `filename*=UTF-8''…` plus an ASCII fallback; all four export endpoints use it and accept `?locale=ar`. | `…::test_content_disposition_uses_rfc_5987_for_arabic_file_names`, `…::test_export_endpoints_send_arabic_safe_download_headers` |
| 4 | **PDF export** | reportlab has no bidirectional algorithm and its built-in Helvetica has no Arabic glyphs — an "Arabic" PDF printed boxes and `?`. The report sub-title used the sample stylesheet's `Helvetica-Bold`, which reproduced the defect *inside the fixed service*. | Strings are shaped (`arabic-reshaper` + `python-bidi`) and the bundled **Amiri** TTF is embedded; tables mirror and right-align; the whole document is styled from the embedded family. | `…::test_pdf_export_contains_shaped_arabic` (extracts the text back out of the PDF and requires Arabic glyphs, no `U+25A0`, no `?`) |
| 5 | **Browser fonts** | A workstation without an Arabic font shows tofu boxes even when the bytes are perfect — and a bank deployment is air-gapped, so no CDN. | Cairo (Arabic UI) and Inter (Latin UI) are self-hosted in `rpa-dashboard/public/fonts`, declared with script-specific `unicode-range`, and preloaded from `index.html`. | `…::test_bundled_webfonts_cover_arabic_shaping`, `test_frontend_experience_contracts.py::test_arabic_fonts_are_self_hosted_with_a_script_specific_unicode_range` |

## Product-level guarantees

* **Direction is a document fact.** `applyLanguage()` writes `lang`, `dir` and
  `data-locale` onto `<html>` and persists the choice (`rpa.lang`); the inline
  bootstrap in `index.html` does the same **before first paint**, so a reload
  never flashes the wrong direction. The document title is translated *after*
  the language switch (a bug caught by `src/test/i18n.test.jsx`).
* **Latin digits in Arabic.** The Arabic locale is `ar-EG-u-nu-latn`: Arabic
  month names and plural rules, but `1,234.56` — an operator reading a contract
  number next to an amount must not have to decode ١٢٣٤٫٥٦.
* **Real pluralisation.** Arabic has six plural categories
  (`zero/one/two/few/many/other`); the bundles carry all of them, so
  `{{count}} عنصر` reads correctly for 0, 1, 2, 3–10 and 11+.
* **Nothing is hard-coded.** Both bundles are key-complete (en 593 / ar 606 flat
  keys, the difference being Arabic's extra plural forms) and a scan fails the
  build if a `????`/`\uFFFD`/mojibake value or an untranslated English JSX
  literal appears.
* **Arabic is one click away everywhere.** The login screen, the top bar, the
  command palette (`Ctrl+K → Language`) and Settings all switch language; the
  shortcut `Ctrl+Shift+L` toggles it from anywhere in the app.
* **Exports are bilingual too.** `GET /api/exports/{audit.xlsx,runs.xlsx,roi.pdf,capacity.pdf}?locale=ar`
  returns an Arabic-titled, right-to-left document with an Arabic file name.

## Operator-facing migration steps

1. Back up the database.
2. Run `db/migrations/sqlserver/005_unicode_nvarchar_upgrade.sql` (idempotent;
   it only touches columns that are not yet `nvarchar`).
3. Re-import rows whose values were already stored as `?` — those characters
   are gone from the database and cannot be reconstructed (`app/core/text.py`
   documents this explicitly).
4. Confirm with `python -m app.db.unicode_upgrade --check` (reports index-key
   risks) and by exporting an Arabic PDF (`?locale=ar`) — it must contain
   joined Arabic glyphs, not boxes.

## Verification performed in this checkout

```
tests/test_arabic_rendering.py                       16 passed
src/test/i18n.test.jsx (bundle parity, switching, digits, plurals)   7 passed
src/test/rtl.test.jsx (DOM direction, logical utilities, table mirroring)  6 passed
tests/test_frontend_experience_contracts.py (fonts, direction, parity)  15 passed
```

Shaping proof (extracted from a generated Arabic PDF):

```
RPA CoE Control Room · ﺳﺮﻱ
ﺗﻘﺮﻳﺮ ﺍﻷﺩﺍﺀ ﺍﻟﺘﺸﻐﻴﻠﻲ
24 :ﻋﺪﺩ ﺍﻟﻌﻤﻠﻴﺎﺕ         ← presentation forms (U+FE70–FEFF), visual order
boxes: 0   question marks: 0   Arabic glyphs: 119
```
