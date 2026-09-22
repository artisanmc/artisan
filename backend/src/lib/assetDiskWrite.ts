import { parse, stringify } from "yaml";
import { CODEPOINT_MAX, CODEPOINT_MIN } from "./codepoints";
import type { DiskAsset } from "./diskAssets";
import type { AssetUsage } from "./assetUsages";

/** Pure asset descriptors and discovery types; ProjectAssets owns storage operations. */

const DIR_BY_TYPE: Record<string, string> = {
  glyph: "assets/glyphs",
  texture: "assets/textures",
  font: "assets/fonts",
};

/** Nom de fichier = identité. Un nom d'asset est déjà contraint, on le confirme. */
export function assetFileName(name: string): string {
  return name
    .toLowerCase()
    .replace(/[^a-z0-9_.-]+/g, "-")
    .replace(/\.+/g, "-")
    .replace(/^-+|-+$/g, "") || "asset";
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
  if (d.content_width !== null && d.content_width !== undefined) out.content_width = d.content_width;
  if (d.usages !== undefined) out.usages = d.usages;
  return stringify(out);
}

/**
 * Le premier codepoint libre de la zone privée, **lu sur le disque**.
 *
 * L'unicité était garantie par un index SQL ; elle devient une proposition de
 * l'éditeur, et la fusion au build tranche les collisions résiduelles (ADR
 * décision 6). Un admin qui édite ses fichiers à la main peut donc en dupliquer
 * un : ça ne casse pas le build, ça se journalise.
 */
export function nextFreeCodepoint(existing: DiskAsset[]): number {
  const used = new Set(
    existing.map((a) => a.row.codepoint).filter((c): c is number => c !== null),
  );
  for (let cp = CODEPOINT_MIN; cp <= CODEPOINT_MAX; cp++) if (!used.has(cp)) return cp;
  throw new Error(`no free codepoint left in U+E000..U+F7FF`);
}

export interface DiskAssetsTree {
  assets: DiskAsset[];
  files: { path: string; content: string }[];
  /**
   * Les binaires BRUTS de l'arbre. Distincts de `assets` : les PNG d'une police
   * dépliée n'y sont pas des assets à part entière (c'est la police, l'asset),
   * mais ce sont bien des fichiers, et les supprimer demande leur empreinte.
   */
  binaries: { path: string; hash: string; size: number }[];
}

/**
 * L'état du disque, tel que le serveur l'a lu.
 *
 * L'échec est **qualifié**, et ça n'est pas cosmétique : tant que la table
 * servait de repli, « le serveur n'a pas répondu » et « le Project n'a pas cet
 * asset » pouvaient se confondre sans dommage. Le disque devenu seule source
 * (P6), les confondre ferait lire un serveur éteint comme une bibliothèque
 * vide — et un geste de suppression porterait sur ce vide.
 */
export type DiskAssetsRead =
  | ({ ok: true } & DiskAssetsTree)
  | { ok: false; error: "server_offline" | "read_error" };

/** Descripteur courant d'un asset, tel qu'il est sur le disque. */
export function descriptorOf(
  files: { path: string; content: string }[],
  path: string,
): { content: string; parsed: Record<string, unknown> } | null {
  const descriptorPath = path.replace(/\.png$/, ".yaml");
  const file = files.find((f) => f.path === descriptorPath);
  if (!file) return null;
  try {
    const parsed = parse(file.content);
    return { content: file.content, parsed: (parsed ?? {}) as Record<string, unknown> };
  } catch {
    return { content: file.content, parsed: {} };
  }
}
