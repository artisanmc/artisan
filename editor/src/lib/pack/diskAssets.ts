import { yamlStem } from "@/lib/yamlFiles";
import { parse } from "yaml";
import { sha256Hex } from "../sha256";
import { parseAssetUsages } from "./assetUsages";
import { FONT_DIR, FONT_STEM, fontFromDisk } from "./fontOnDisk";
import type { AssetRow } from "./resourcePackBuilder";

/**
 * A Project's assets **read from the server's disk** (ADR
 * `assets-on-server-disk`).
 *
 * Returns the shape the resource pack builder expects (`AssetRow`).
 *
 * An asset's identity is its **file name**: `assets/glyphs/diamant.png`
 * becomes the asset `diamant`. Its sibling descriptor (`diamant.yaml`) carries
 * what the PNG cannot say — ascent, codepoint, content width. An asset without
 * a descriptor stays usable with defaults: a typo in a `.yaml` must not make
 * an image disappear (bare data files rule).
 */
export interface DiskAsset {
  row: AssetRow;
  path: string;
  hash: string;
}

const TYPE_BY_DIR: Record<string, string> = {
  "assets/glyphs": "glyph",
  "assets/textures": "texture",
};

function typeOf(path: string): string | null {
  const dir = path.slice(0, path.lastIndexOf("/"));
  return TYPE_BY_DIR[dir] ?? null;
}

function nameOf(path: string): string {
  const base = path.slice(path.lastIndexOf("/") + 1);
  return base.replace(/\.[^.]+$/, "");
}

function sha256(content: string): string {
  return sha256Hex(new TextEncoder().encode(content));
}

function num(value: unknown, fallback: number | null): number | null {
  return typeof value === "number" && Number.isFinite(value) ? value : fallback;
}

/**
 * Assembles a Project's assets from the tree announced by the server.
 *
 * `binaries` carries the paths and fingerprints; `files` carries the
 * descriptors. No bytes travel here — bytes are requested asset by asset, by
 * whoever needs them.
 */
export function diskAssetsFromTree(
  anchorProjectId: string,
  files: { path: string; content: string }[],
  binaries: { path: string; hash: string; size: number }[],
): DiskAsset[] {
  const descriptors = new Map<string, Record<string, unknown>>();
  for (const f of files) {
    const stem = f.path.startsWith("assets/") ? yamlStem(f.path) : null;
    if (stem === null || (descriptors.has(stem) && !f.path.endsWith(".yml"))) continue;
    try {
      const parsed = parse(f.content);
      if (parsed && typeof parsed === "object") {
        descriptors.set(stem, parsed as Record<string, unknown>);
      }
    } catch {
      // Unreadable descriptor: the image stays usable with defaults. Making it
      // disappear for a typo would punish the wrong thing.
    }
  }

  const out: DiskAsset[] = [];

  // A FONT is a folder, not a file: `assets/fonts/<name>/font.yaml` plus one
  // PNG per glyph. The font is the asset — otherwise the library would show 95
  // "glyphs" named a, b, c… next to it.
  for (const f of files) {
    const descriptor = yamlStem(f.path);
    if (!f.path.startsWith(`${FONT_DIR}/`) || !descriptor?.endsWith(`/${FONT_STEM}`)) continue;
    const dir = descriptor.slice(0, -(FONT_STEM.length + 1));
    const name = dir.slice(dir.lastIndexOf("/") + 1);
    const meta = fontFromDisk(f.content);
    if (!meta) continue; // unreadable descriptor: do not invent a font
    const now = new Date();
    out.push({
      path: f.path,
      // A font's hash is its descriptor's: that is what changes when a glyph is
      // added, removed or moved.
      hash: sha256(f.content),
      row: {
        id: name,
        projectId: anchorProjectId,
        type: "font",
        name,
        width: 0,
        height: 0,
        ascent: null,
        codepoint: null,
        contentWidth: null,
        fontMeta: meta as unknown as AssetRow["fontMeta"],
        contentHash: sha256(f.content),
        createdAt: now,
        updatedAt: now,
      } as AssetRow,
    });
  }

  for (const bin of binaries) {
    const type = typeOf(bin.path);
    if (type === null) continue; // outside the asset folders: not our business
    const meta = descriptors.get(bin.path.replace(/\.[^.]+$/, "")) ?? {};
    const now = new Date();
    out.push({
      path: bin.path,
      hash: bin.hash,
      row: {
        id: nameOf(bin.path),
        projectId: anchorProjectId,
        type,
        name: nameOf(bin.path),
        usages: parseAssetUsages(meta.usages),
        width: num(meta.width, 0) ?? 0,
        height: num(meta.height, 0) ?? 0,
        ascent: num(meta.ascent, null),
        codepoint: num(meta.codepoint, null),
        contentWidth: num(meta.content_width, null),
        fontMeta: (meta.font_meta as AssetRow["fontMeta"]) ?? null,
        contentHash: bin.hash,
        createdAt: now,
        updatedAt: now,
      } as AssetRow,
    });
  }
  return out.sort((a, b) => a.path.localeCompare(b.path));
}
