import { YAML_EXT } from "@/lib/yamlFiles";
import { parse, stringify } from "yaml";
import { assetFileName } from "./assetDiskWrite";
import type { ParsedMcFont } from "./mcFontsParser";

/**
 * An imported font, **unpacked** on the server's disk (ADR
 * `assets-on-server-disk`).
 *
 * The deciding measure: vanilla ASCII is 95 PNGs plus its descriptor, 26 KB in
 * total. Keeping the zip would have put a black box in the middle of a folder
 * where everything else is hand-editable, and touching a single glyph would
 * have meant unzip, fix, rezip — to save 96 entries.
 *
 *     assets/fonts/<name>/font.yml       ← which character, which image, ascent
 *     assets/fonts/<name>/<texture>.png  ← one file per glyph
 *
 * The descriptor holds paths **relative to the font folder**, as in the
 * original zip: what is written there is what the admin reads next to it.
 */
export const FONT_STEM = "font";
export const FONT_DESCRIPTOR = `${FONT_STEM}${YAML_EXT}`;
export const FONT_DIR = "assets/fonts";

export interface FontGlyphMeta {
  char: string;
  texture: string;
  ascent: number;
  height: number;
  width: number;
}

export interface FontMetaOnDisk {
  namespace: string;
  glyphMap: FontGlyphMeta[];
}

/** A font's folder, from its name. */
export function fontDir(name: string): string {
  return `${FONT_DIR}/${assetFileName(name)}`;
}

/** The files to write to put an imported font on disk. */
export function fontFilesFor(
  name: string,
  parsed: Pick<ParsedMcFont, "glyphMap" | "glyphPngs">,
): {
  binaries: { path: string; bytes: Uint8Array }[];
  descriptor: { path: string; content: string };
} {
  const dir = fontDir(name);
  const binaries = [...parsed.glyphPngs.entries()]
    .map(([texture, bytes]) => ({ path: `${dir}/${texture}`, bytes }))
    .sort((a, b) => a.path.localeCompare(b.path));

  const descriptor = {
    path: `${dir}/${FONT_DESCRIPTOR}`,
    content: stringify({
      namespace: `artisan:${assetFileName(name)}`,
      glyphs: parsed.glyphMap.map((g) => ({
        char: g.char,
        texture: g.texture,
        ascent: g.ascent,
        height: g.height,
        width: g.width,
      })),
    }),
  };
  return { binaries, descriptor };
}

/**
 * Re-reads a font descriptor. `null` if unreadable — the font then disappears
 * from the library, but its PNGs stay on disk: what is not understood is never
 * deleted.
 */
export function fontFromDisk(content: string): FontMetaOnDisk | null {
  try {
    const parsed = parse(content) as { namespace?: unknown; glyphs?: unknown } | null;
    if (!parsed || typeof parsed !== "object") return null;
    const glyphs = Array.isArray(parsed.glyphs) ? parsed.glyphs : [];
    const glyphMap: FontGlyphMeta[] = [];
    for (const g of glyphs) {
      if (!g || typeof g !== "object") continue;
      const entry = g as Record<string, unknown>;
      if (typeof entry.char !== "string" || typeof entry.texture !== "string") continue;
      glyphMap.push({
        char: entry.char,
        texture: entry.texture,
        ascent: typeof entry.ascent === "number" ? entry.ascent : 0,
        height: typeof entry.height === "number" ? entry.height : 8,
        width: typeof entry.width === "number" ? entry.width : 0,
      });
    }
    return {
      namespace: typeof parsed.namespace === "string" ? parsed.namespace : "",
      glyphMap,
    };
  } catch {
    return null;
  }
}
