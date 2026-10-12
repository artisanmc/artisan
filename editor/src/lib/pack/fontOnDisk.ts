import { parse, stringify } from "yaml";
import { assetFileName } from "./assetDiskWrite";
import type { ParsedMcFont } from "./mcFontsParser";

/**
 * Une police importée, **dépliée** sur le disque du serveur (ADR
 * `assets-on-server-disk` — question ouverte tranchée le 2026-08-17).
 *
 * La mesure qui a décidé : l'ASCII vanilla fait 95 PNG plus son descripteur,
 * 26 Ko en tout. Garder le zip aurait posé une boîte noire au milieu d'un
 * dossier dont tout le reste s'édite à la main, et il aurait fallu dézipper,
 * corriger, rezipper pour toucher un seul glyphe — pour économiser 96 entrées.
 *
 *     assets/fonts/<nom>/font.yaml      ← quel caractère, quelle image, ascent
 *     assets/fonts/<nom>/<texture>.png  ← un fichier par glyphe
 *
 * Le descripteur porte les chemins **relatifs au dossier de la police**, comme
 * dans le zip d'origine : ce qui est écrit là est ce que l'admin lit à côté.
 */
export const FONT_DESCRIPTOR = "font.yaml";
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

/** Le dossier d'une police, d'après son nom. */
export function fontDir(name: string): string {
  return `${FONT_DIR}/${assetFileName(name)}`;
}

/** Les fichiers à écrire pour poser une police importée sur le disque. */
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
 * Relit un descripteur de police. `null` s'il est illisible — la police
 * disparaît alors de la bibliothèque, mais ses PNG restent sur le disque : on ne
 * supprime jamais ce qu'on ne comprend pas.
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
