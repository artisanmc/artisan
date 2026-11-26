import { yamlStem } from "@/lib/yamlFiles";
import { parse } from "yaml";
import { sha256Hex } from "../sha256";
import { parseAssetUsages } from "./assetUsages";
import { type ComposeRecipe, composeRecipe } from "./compose";
import { FONT_DIR, FONT_STEM, fontFromDisk } from "./fontOnDisk";
import { type PixelSize, imageFunctionOf, refusedImages } from "./imageFunction";
import type { AssetRow } from "./resourcePackBuilder";
import { shippedView } from "./shippedView";

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
  /** A composed image (`compose.ts`): `path` is its descriptor's, it has no PNG. */
  compose?: ComposeRecipe;
}

/** Whether a descriptor says its image follows the ramps: `ramps: true`, nothing else. */
export const followsRamps = (meta: unknown): boolean =>
  !!meta && typeof meta === "object" && (meta as { ramps?: unknown }).ramps === true;

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
  ownFiles: { path: string; content: string }[],
  ownBinaries: { path: string; hash: string; size: number }[],
  /**
   * The pack's read: the module's assets (`originals/assets/…`) too, the owner's file winning
   * name for name. A returned `path` stays the file's real one, to read its bytes.
   */
  options: {
    originals?: boolean;
    /**
     * The pixel size of a file, for the pack: with it, the owner's image of an original that
     * declares a function is left out at other measures (`imageFunction.ts`), the original showing.
     */
    sizeOf?: (path: string) => PixelSize | null;
  } = {},
): DiskAsset[] {
  // The owner's images that are not taken go, descriptor included: the original's show.
  const refused = options.originals ? refusedImages(ownFiles, ownBinaries, options.sizeOf) : [];
  const leftOut = new Set(refused.map((image) => image.path));
  const leftOutStems = new Set(refused.map((image) => image.stem));
  const keptFiles = leftOut.size
    ? ownFiles.filter((f) => {
        const stem = f.path.startsWith("originals/") ? null : yamlStem(f.path);
        return stem === null || !leftOutStems.has(stem);
      })
    : ownFiles;
  const keptBinaries = leftOut.size ? ownBinaries.filter((b) => !leftOut.has(b.path)) : ownBinaries;
  const files = options.originals
    ? shippedView(keptFiles).map(({ entry, at }) => ({ ...entry, path: at, real: entry.path }))
    : keptFiles.map((f) => ({ ...f, real: f.path }));
  const everyBinary = options.originals
    ? shippedView(keptBinaries).map(({ entry, at }) => ({ ...entry, path: at, real: entry.path }))
    : keptBinaries.map((b) => ({ ...b, real: b.path }));
  const descriptors = new Map<string, Record<string, unknown>>();
  const descriptorFiles = new Map<string, { real: string; content: string }>();
  for (const f of files) {
    const stem = f.path.startsWith("assets/") ? yamlStem(f.path) : null;
    if (stem === null || (descriptors.has(stem) && !f.path.endsWith(".yml"))) continue;
    try {
      const parsed = parse(f.content);
      if (parsed && typeof parsed === "object") {
        descriptors.set(stem, parsed as Record<string, unknown>);
        descriptorFiles.set(stem, { real: f.real, content: f.content });
      }
    } catch {
      // Unreadable descriptor: the image stays usable with defaults. Making it
      // disappear for a typo would punish the wrong thing.
    }
  }

  // The owner's composed image takes its name from the PNG the module ships: a composed
  // image's file is its descriptor, and the owner's file wins name for name.
  const composedOver = new Set(
    [...descriptors]
      .filter(
        ([stem, meta]) =>
          !descriptorFiles.get(stem)!.real.startsWith("originals/") && composeRecipe(meta),
      )
      .map(([stem]) => stem),
  );
  const binaries = everyBinary.filter(
    (bin) =>
      !bin.real.startsWith("originals/") || !composedOver.has(bin.path.replace(/\.[^.]+$/, "")),
  );

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
      path: f.real,
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
      path: bin.real,
      hash: bin.hash,
      row: {
        id: nameOf(bin.path),
        projectId: anchorProjectId,
        type,
        name: nameOf(bin.path),
        usages: parseAssetUsages(meta.usages),
        ...(imageFunctionOf(meta) ? { function: imageFunctionOf(meta)! } : {}),
        ...(followsRamps(meta) ? { ramps: true } : {}),
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
  // A composed image: a descriptor with a recipe and no file of its name beside it.
  const drawn = new Set(binaries.map((bin) => bin.path.replace(/\.[^.]+$/, "")));
  for (const [stem, meta] of descriptors) {
    const type = TYPE_BY_DIR[stem.slice(0, stem.lastIndexOf("/"))] ?? null;
    if (type === null || drawn.has(stem)) continue;
    // A YAML list is an object too, as for any descriptor: no recipe in it.
    const compose = composeRecipe(meta);
    if (!compose) continue;
    const file = descriptorFiles.get(stem)!;
    const name = stem.slice(stem.lastIndexOf("/") + 1);
    const now = new Date();
    out.push({
      path: file.real,
      hash: sha256(file.content),
      compose,
      row: {
        id: name,
        projectId: anchorProjectId,
        type,
        name,
        usages: parseAssetUsages(meta.usages),
        ...(imageFunctionOf(meta) ? { function: imageFunctionOf(meta)! } : {}),
        width: num(meta.width, 0) ?? 0,
        height: num(meta.height, 0) ?? 0,
        ascent: num(meta.ascent, null),
        codepoint: num(meta.codepoint, null),
        contentWidth: num(meta.content_width, null),
        fontMeta: (meta.font_meta as AssetRow["fontMeta"]) ?? null,
        contentHash: sha256(file.content),
        createdAt: now,
        updatedAt: now,
      } as AssetRow,
    });
  }
  // Code unit order, not localeCompare: the pack's bytes must not depend on the browser's
  // locale, and the hub's builder sorts the same way.
  return out.sort((a, b) => (a.path < b.path ? -1 : a.path > b.path ? 1 : 0));
}
