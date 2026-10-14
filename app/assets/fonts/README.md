# Bundled fonts

Air-gapped bank deployments cannot fetch fonts from a CDN, and a client
workstation without an Arabic-capable system font renders Arabic as
`????`/tofu (`□`).  The report stack therefore ships its own Arabic typeface.

| File | Use | Licence |
|------|-----|---------|
| `Amiri-Regular.ttf` / `Amiri-Bold.ttf` | Arabic + Latin text inside generated **PDF** reports | SIL OFL 1.1 — see `LICENSE-Amiri-OFL.txt` |

The web UI ships its own webfonts in `rpa-dashboard/public/fonts/`
(Inter for Latin, Cairo for Arabic) — also self-hosted, also OFL.

`tests/test_arabic_rendering.py` parses the `cmap` of every bundled font and
fails the build if a glyph used by the Arabic UI or by an export is missing,
so "Arabic shows as `????`" can never regress unnoticed.
