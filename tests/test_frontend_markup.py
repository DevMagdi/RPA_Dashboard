"""Frontend markup audit — invalid JSX/DOM nesting.

React (and the browser) log ``<div> cannot be a descendant of <p>`` for the
dashboard capacity tiles: the loading placeholder (``Skeleton``, which renders
a ``div``) sat inside a ``<p>``.  React recovers by re-parenting the node, so
the page still renders — but the markup is invalid, the DOM is re-parsed and
the console is spammed on every load.

Like the raw-SQL audits in ``test_dialect_sqlserver.py`` this reads the sources
directly (no browser required) and fails when a block-level element or
component is nested inside a paragraph.
"""

from __future__ import annotations

import pathlib
import re
from typing import Dict, Iterable, List, Set

FRONTEND_SRC = pathlib.Path(__file__).resolve().parents[1] / "rpa-dashboard" / "src"

#: Raw HTML tags that may never live inside a <p>.
BLOCK_TAGS = (
    "div", "section", "article", "header", "footer", "main", "nav", "form",
    "table", "thead", "tbody", "tr", "ul", "ol", "li", "h1", "h2", "h3", "h4",
    "h5", "h6", "hr", "pre", "blockquote",
)

#: ``export function Name(...)  …  return (<tag`` — the *first* JSX tag the
#: component renders decides whether it is block-rooted.  Statements before the
#: ``return`` are allowed (a component may compute a label first).
COMPONENT_DEF = re.compile(
    r"export\s+(?:default\s+)?function\s+([A-Z]\w*)\s*\([^)]*\)\s*\{"
    r"(?P<body>.*?)"
    r"return\s*\(?\s*(?:/\*.*?\*/\s*)*<(?P<tag>[A-Za-z][\w.]*)",
    re.DOTALL,
)

PARAGRAPH = re.compile(r"<p\b[^>]*>(.*?)</p>", re.DOTALL)

#: ``{/* … */}`` / ``/* … */`` blocks and full-line ``//`` comments — prose such
#: as "must not be a <p>" must not be mistaken for markup.
JSX_COMMENT = re.compile(r"\{/\*.*?\*/\}|/\*.*?\*/", re.DOTALL)
LINE_COMMENT = re.compile(r"^\s*//.*$", re.MULTILINE)


def strip_comments(source: str) -> str:
    """Remove comments so the audit only ever sees real markup."""
    return LINE_COMMENT.sub("", JSX_COMMENT.sub("", source))


def _jsx_sources() -> Dict[pathlib.Path, str]:
    return {
        path: strip_comments(path.read_text(encoding="utf-8"))
        for path in sorted(FRONTEND_SRC.rglob("*.jsx"))
    }


def component_roots(sources: Iterable[str]) -> Dict[str, str]:
    """Map ``Component -> first rendered tag`` for every component in the tree."""
    roots: Dict[str, str] = {}
    for source in sources:
        for match in COMPONENT_DEF.finditer(source):
            name, tag = match.group(1), match.group("tag")
            # A component may only claim a root once, and the first definition wins.
            roots.setdefault(name, tag)
    return roots


def block_root_components(sources: Iterable[str]) -> Set[str]:
    """Components whose rendered root is block level.

    Resolved to a fixed point, because a component may render *another*
    component (``CardBody`` renders ``CardContent`` which renders a ``<div>``) —
    nesting either one inside a ``<p>`` is the same invalid markup.
    """
    roots = component_roots(sources)
    block = set()
    changed = True
    while changed:
        changed = False
        for name, tag in roots.items():
            if name in block:
                continue
            if tag.lower() in BLOCK_TAGS or tag in block:
                block.add(name)
                changed = True
    return block


def paragraphs_containing_blocks(source: str, block_components: Iterable[str] = ()) -> List[str]:
    """Return the offending tags found inside ``source``'s ``<p>`` blocks."""
    nested = re.compile(r"<(" + "|".join(sorted(set(BLOCK_TAGS) | set(block_components))) + r")\b")
    offenders: List[str] = []
    for match in PARAGRAPH.finditer(source):
        hit = nested.search(match.group(1))
        if hit:
            offenders.append(f"<p> contains <{hit.group(1)}>")
    return offenders


def test_frontend_sources_are_present():
    """Guard: the audit is worthless if the JSX sources are not checked out."""
    assert _jsx_sources(), f"no .jsx sources found under {FRONTEND_SRC}"


def test_block_root_components_are_detected():
    """The audit must know that ``Skeleton`` renders a ``div`` (the reported bug)."""
    block_components = block_root_components(_jsx_sources().values())
    assert {"Skeleton", "SkeletonText", "CardBody", "CardHeader"} <= block_components


def test_comments_are_stripped_before_the_audit():
    """Prose like ``must not be a <p>`` must not be read as markup."""
    source = "{/* the value slot must not be a <p> */}\n<div>ok</div>\n"
    assert "<p" not in strip_comments(source)


def test_no_block_element_nested_inside_a_paragraph():
    block_components = block_root_components(_jsx_sources().values())
    offenders: List[str] = []
    for path, source in _jsx_sources().items():
        for problem in paragraphs_containing_blocks(source, block_components):
            offenders.append(f"{path.relative_to(FRONTEND_SRC.parent.parent)}: {problem}")
    assert not offenders, "invalid nesting — a <p> cannot contain block elements:\n" + "\n".join(offenders)


def test_audit_detects_the_pattern_that_shipped():
    """Self-check: the detector must fail on the code the user reported."""
    broken = '<p className="mt-1 text-lg font-semibold text-text">{loading ? <Skeleton className="h-6 w-12" /> : value}</p>'
    assert paragraphs_containing_blocks(broken, {"Skeleton"}) == ["<p> contains <Skeleton>"]
    assert paragraphs_containing_blocks("<p>plain <div>nested</div></p>") == ["<p> contains <div>"]

    fixed = '<div className="mt-1 text-lg font-semibold text-text">{loading ? <Skeleton className="h-6 w-12" /> : value}</div>'
    assert paragraphs_containing_blocks(fixed, {"Skeleton"}) == []
