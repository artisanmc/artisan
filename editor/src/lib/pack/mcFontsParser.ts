import { strFromU8, unzipSync } from "fflate";
import { readPngDimensions } from "./pngDimensions";

export interface ParsedMcFontGlyph {
  char: string;
  texture: string; // path inside the zip (matches a key in glyphPngs), e.g. "glyphs/a.png"
  ascent: number;
  height: number;
  width: number; // read from the actual PNG header
}

export interface ParsedMcFont {
  glyphMap: ParsedMcFontGlyph[];
  glyphPngs: Map<string, Uint8Array>; // file path → PNG bytes (deduped: 1 entry per unique path)
  warnings: string[];
}

/**
 * Pure function: parses an MCFonts-style zip into a glyph map + PNG bytes.
 *
 * Expects `font.json` at the zip root (no namespace prefix). Each bitmap provider's
 * `file` field is `namespace:path/...`; we strip the namespace, then try the
 * remaining path as-is against the zip. If not found, we also strip a leading
 * `font/<anything>/` prefix (MCFonts convention: the zip contains the contents of
 * the font folder, but `file` references the full assets-style path).
 */
export function parseMcFontsZip(zipBuf: Uint8Array): ParsedMcFont {
  const entries = unzipSync(zipBuf);

  const fontJsonBytes = entries["font.json"];
  if (!fontJsonBytes) {
    throw new Error("font.json missing at zip root");
  }

  const fontJson = JSON.parse(strFromU8(fontJsonBytes)) as {
    providers?: unknown[];
  };

  const providers = Array.isArray(fontJson.providers) ? fontJson.providers : [];

  const warnings: string[] = [];
  const glyphMap: ParsedMcFontGlyph[] = [];
  const glyphPngs = new Map<string, Uint8Array>();

  for (const rawProvider of providers) {
    const provider = rawProvider as {
      type?: string;
      file?: string;
      ascent?: number;
      height?: number;
      chars?: unknown[];
    };

    if (provider.type !== "bitmap") {
      warnings.push(`skipping provider type=${provider.type}`);
      continue;
    }

    const file = typeof provider.file === "string" ? provider.file : "";
    if (!file) {
      warnings.push("skipping bitmap provider with no file");
      continue;
    }

    // Strip leading "namespace:" prefix.
    const stripped = file.replace(/^[^:]+:/, "");

    // Try resolution strategies in order.
    let resolvedPath: string | null = null;
    let pngBytes: Uint8Array | null = null;

    if (entries[stripped]) {
      resolvedPath = stripped;
      pngBytes = entries[stripped];
    } else {
      // Fallback: strip a leading "font/<anything>/" prefix.
      const fallback = stripped.replace(/^font\/[^/]+\//, "");
      if (fallback !== stripped && entries[fallback]) {
        resolvedPath = fallback;
        pngBytes = entries[fallback];
      }
    }

    if (!resolvedPath || !pngBytes) {
      warnings.push(`png not found in zip for file=${file}`);
      continue;
    }

    let width: number;
    try {
      width = readPngDimensions(pngBytes).width;
    } catch (err) {
      warnings.push(`invalid png at ${resolvedPath}: ${(err as Error).message}`);
      continue;
    }

    const ascent = typeof provider.ascent === "number" ? provider.ascent : 0;
    const height = typeof provider.height === "number" ? provider.height : 8;

    const chars = Array.isArray(provider.chars) ? provider.chars : [];
    let addedAnyChar = false;
    for (const rawChar of chars) {
      if (typeof rawChar !== "string" || rawChar.length !== 1) {
        warnings.push(`skipping multi-char entry: "${String(rawChar)}"`);
        continue;
      }
      glyphMap.push({
        char: rawChar,
        texture: resolvedPath,
        ascent,
        height,
        width,
      });
      addedAnyChar = true;
    }

    if (addedAnyChar) {
      // Map dedupes naturally; ok to set even if already present.
      glyphPngs.set(resolvedPath, pngBytes);
    }
  }

  return { glyphMap, glyphPngs, warnings };
}
