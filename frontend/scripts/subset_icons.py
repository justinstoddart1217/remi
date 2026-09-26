"""Build the Remi subset of Material Symbols Outlined (called by subset-icons.sh).

usage: subset_icons.py SOURCE.woff2 OUT.woff2 OUT_TS

Steps:
1. Prune the ligature lookup to exactly the icon names Remi uses, so the subsetter's
   GSUB closure does not drag in all ~4,000 icons that share the same letters.
2. Subset to those icon glyphs, their FILL alternates and the letters that spell them.
   Ligatures (rlig) and the FILL feature variation (rclt) survive.
3. Instance the variable font like the prototype's Google Fonts request
   (opsz,wght,FILL,GRAD@20..24,300,0..1,0): wght=300, GRAD=0, opsz 20..24, FILL 0..1.
4. Verify every name still shapes to a single glyph through the ligature, then write the
   woff2 and a generated TypeScript map of name -> codepoint for <Icon>.
"""

import io
import sys
from pathlib import Path

from fontTools import subset
from fontTools.ttLib import TTFont
from fontTools.varLib import instancer

# The 16 icons in Remi.dc.html's Google Fonts request (the app shell and its screens).
APP_ICONS = [
    "add", "arrow_forward", "calendar_month", "check", "chevron_left", "chevron_right",
    "close", "edit_note", "north_east", "notes", "repeat", "search", "stacks", "today",
    "unfold_more", "view_timeline",
]
# Remi Textbook.dc.html adds these 12 (Remi Home and Remi Foundations use no others).
TEXTBOOK_ICONS = [
    "delete", "description", "drag_indicator", "functions", "home", "horizontal_rule",
    "insert_chart", "left_panel_close", "left_panel_open", "open_in_full", "title",
    "upload_file",
]
# Added by the Ninety One redesign (2026-09-25): the Notes rails and note expand/collapse.
REDESIGN_ICONS = ["close_fullscreen", "right_panel_close", "right_panel_open"]
# New UI that the design cannot create (Settings page, ADR-0010).
NEW_UI_ICONS = ["settings", "tune"]

ICONS = sorted({*APP_ICONS, *TEXTBOOK_ICONS, *REDESIGN_ICONS, *NEW_UI_ICONS})

AXIS_LIMITS: dict[str, float | tuple[float, float]] = {
    "wght": 300,
    "GRAD": 0,
    "opsz": (20, 24),
    "FILL": (0, 1),
}


def _ligature_lookups(font: TTFont) -> list[object]:
    """Every LigatureSubst subtable (unwrapping Extension lookups)."""
    found: list[object] = []
    for lookup in font["GSUB"].table.LookupList.Lookup:
        for sub in lookup.SubTable:
            real = sub.ExtSubTable if lookup.LookupType == 7 else sub
            if type(real).__name__ == "LigatureSubst":
                found.append(real)
    return found


def prune_ligatures(font: TTFont, names: list[str]) -> dict[str, str]:
    """Keep only the ligatures that spell ``names``. Returns name -> glyph."""
    cmap = font.getBestCmap()
    char_glyph = {chr(cp): glyph for cp, glyph in cmap.items() if cp < 0x80}
    wanted: dict[tuple[str, ...], str] = {}
    for name in names:
        try:
            wanted[tuple(char_glyph[c] for c in name)] = name
        except KeyError as exc:
            raise SystemExit(f"icon name {name!r} uses a character the font lacks: {exc}") from None

    resolved: dict[str, str] = {}
    for table in _ligature_lookups(font):
        kept: dict[str, list[object]] = {}
        for first, ligatures in table.ligatures.items():
            for lig in ligatures:
                seq = (first, *lig.Component)
                if seq in wanted:
                    kept.setdefault(first, []).append(lig)
                    resolved[wanted[seq]] = lig.LigGlyph
        table.ligatures = kept

    missing = sorted(set(names) - set(resolved))
    if missing:
        raise SystemExit(f"no ligature found for: {', '.join(missing)}")
    return resolved


def codepoints_for(font: TTFont, glyphs: dict[str, str]) -> dict[str, int]:
    """The lowest private-use codepoint mapped to each icon glyph."""
    by_glyph: dict[str, list[int]] = {}
    for cp, glyph in font.getBestCmap().items():
        if cp >= 0xE000:
            by_glyph.setdefault(glyph, []).append(cp)
    out: dict[str, int] = {}
    for name, glyph in glyphs.items():
        cps = by_glyph.get(glyph)
        if not cps:
            raise SystemExit(f"icon {name!r} has no codepoint")
        out[name] = min(cps)
    return out


def verify(sfnt: bytes, codepoints: dict[str, int]) -> None:
    """Every name must shape to exactly one glyph, the same one as its codepoint."""
    import uharfbuzz as hb

    face = hb.Face(hb.Blob(sfnt))  # HarfBuzz reads sfnt, not woff2
    font = hb.Font(face)
    for fill in (0, 1):
        font.set_variations({"FILL": fill, "opsz": 24})
        for name, cp in codepoints.items():
            gids: list[int] = []
            for text in (name, chr(cp)):
                buf = hb.Buffer()
                buf.add_str(text)
                buf.guess_segment_properties()
                hb.shape(font, buf, {})
                gids.append(buf.glyph_infos[0].codepoint if len(buf.glyph_infos) == 1 else -1)
            if gids[0] <= 0 or gids[0] != gids[1]:
                raise SystemExit(f"ligature check failed for {name!r} (FILL={fill}): {gids}")


def write_ts(path: Path, codepoints: dict[str, int], source: str) -> None:
    lines = [
        "// Generated by frontend/scripts/subset-icons.sh. Do not edit by hand.",
        f"// Source: {source}. Material Symbols is Apache-2.0 (Google).",
        "",
        "/** Every icon in src/assets/fonts/material-symbols-remi.woff2, with its codepoint. */",
        "export const ICON_CODEPOINTS = {",
        *(f"  {name}: 0x{cp:x}," for name, cp in sorted(codepoints.items())),
        "} as const;",
        "",
        "export type IconName = keyof typeof ICON_CODEPOINTS;",
        "",
    ]
    path.write_text("\n".join(lines), encoding="utf-8")


def main(argv: list[str]) -> int:
    if len(argv) != 4:
        raise SystemExit(__doc__)
    source, out_font, out_ts = Path(argv[1]), Path(argv[2]), Path(argv[3])

    font = TTFont(source)
    glyphs = prune_ligatures(font, ICONS)
    codepoints = codepoints_for(font, glyphs)
    letters = sorted({c for name in ICONS for c in name})

    options = subset.Options()
    options.layout_features = ["*"]
    options.name_IDs = ["*"]
    options.notdef_outline = True
    options.glyph_names = False
    options.flavor = None
    subsetter = subset.Subsetter(options)
    subsetter.populate(
        glyphs=sorted(glyphs.values()),
        unicodes=sorted({*codepoints.values(), *(ord(c) for c in letters), 0x20}),
    )
    subsetter.subset(font)

    font = instancer.instantiateVariableFont(font, AXIS_LIMITS)
    sfnt = io.BytesIO()
    font.flavor = None
    font.save(sfnt)
    verify(sfnt.getvalue(), codepoints)

    font.flavor = "woff2"
    out_font.parent.mkdir(parents=True, exist_ok=True)
    font.save(out_font)
    write_ts(out_ts, codepoints, source.name)

    kept = TTFont(out_font)
    axes = {a.axisTag: (a.minValue, a.defaultValue, a.maxValue) for a in kept["fvar"].axes}
    print(
        f"wrote {out_font} ({out_font.stat().st_size} bytes): {len(ICONS)} icons, "
        f"{len(kept.getGlyphOrder())} glyphs, axes {axes}"
    )
    return 0


if __name__ == "__main__":
    raise SystemExit(main(sys.argv))
