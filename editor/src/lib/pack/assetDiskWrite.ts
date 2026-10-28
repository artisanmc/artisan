import { YAML_EXT, findYaml } from "@/lib/yamlFiles";
import { parse, stringify } from "yaml";
import type { AssetUsage } from "./assetUsages";
import { CODEPOINT_MAX, CODEPOINT_MIN } from "./codepoints";
import type { DiskAsset } from "./diskAssets";

/** Pure asset descriptors and discovery types; ProjectAssets owns storage operations. */

const DIR_BY_TYPE: Record<string, string> = {
  glyph: "assets/glyphs",
  texture: "assets/textures",
  font: "assets/fonts",
};

/** File name = identity. An asset name is already constrained; this confirms it. */
export function assetFileName(name: string): string {
  return (
    name
      .toLowerCase()
      .replace(/[^a-z0-9_.-]+/g, "-")
      .replace(/\.+/g, "-")
      .replace(/^-+|-+$/g, "") || "asset"
  );
}

export function assetDiskPath(type: string, name: string): string {
  return `${DIR_BY_TYPE[type] ?? "assets"}/${assetFileName(name)}.png`;
}

export interface DiskAssetDescriptor {
  usages?: AssetUsage[];
  ascent?: number | null;
  codepoint?: number | null;
  width?: number;
  height?: number;
  content_width?: number | null;
}

export function descriptorYaml(d: DiskAssetDescriptor): string {
  const out: Record<string, unknown> = {};
  if (d.ascent !== null && d.ascent !== undefined) out.ascent = d.ascent;
  if (d.codepoint !== null && d.codepoint !== undefined) out.codepoint = d.codepoint;
  if (d.width) out.width = d.width;
  if (d.height) out.height = d.height;
  if (d.content_width !== null && d.content_width !== undefined)
    out.content_width = d.content_width;
  if (d.usages !== undefined) out.usages = d.usages;
  return stringify(out);
}

/**
 * The first free codepoint of the private use area, **read from the disk**.
 *
 * Uniqueness used to be guaranteed by a SQL index; it is now a proposal from
 * the editor, and the merge at build time settles remaining collisions (ADR
 * decision 6). An admin hand-editing their files can therefore duplicate one:
 * it does not break the build, it gets logged.
 */
export function nextFreeCodepoint(existing: DiskAsset[]): number {
  const used = new Set(existing.map((a) => a.row.codepoint).filter((c): c is number => c !== null));
  for (let cp = CODEPOINT_MIN; cp <= CODEPOINT_MAX; cp++) if (!used.has(cp)) return cp;
  throw new Error("no free codepoint left in U+E000..U+F7FF");
}

export interface DiskAssetsTree {
  assets: DiskAsset[];
  files: { path: string; content: string }[];
  /**
   * The tree's RAW binaries. Distinct from `assets`: the PNGs of an unpacked
   * font are not assets in their own right (the font is the asset), but they
   * are files, and deleting them needs their fingerprint.
   */
  binaries: { path: string; hash: string; size: number }[];
}

/**
 * The disk's state, as the server read it.
 *
 * The failure is **qualified**, and that is not cosmetic: with the disk as the
 * only source, confusing "the server did not answer" with "the Project does
 * not have this asset" would read an offline server as an empty library — and
 * a delete gesture would act on that emptiness.
 */
export type DiskAssetsRead =
  | ({ ok: true } & DiskAssetsTree)
  | { ok: false; error: "server_offline" | "read_error" };

/** Where an asset's descriptor goes: beside its image, `.yml` (`diamant.png` → `diamant.yml`). */
export function descriptorPath(path: string): string {
  return path.replace(/\.png$/, YAML_EXT);
}

/** An asset's current descriptor, as it is on disk (`.yml`, else `.yaml`). */
export function descriptorOf(
  files: { path: string; content: string }[],
  path: string,
): { path: string; content: string; parsed: Record<string, unknown> } | null {
  const stem = path.replace(/\.png$/, "");
  const found = findYaml(stem, (p) => files.some((f) => f.path === p));
  const file = found ? files.find((f) => f.path === found) : undefined;
  if (!file) return null;
  try {
    const parsed = parse(file.content);
    return {
      path: file.path,
      content: file.content,
      parsed: (parsed ?? {}) as Record<string, unknown>,
    };
  } catch {
    return { path: file.path, content: file.content, parsed: {} };
  }
}
