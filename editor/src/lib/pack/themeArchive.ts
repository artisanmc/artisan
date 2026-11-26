import { isModuleFile } from "@/lib/yamlFiles";
import { KIT_FOLDER } from "./kit";
import { isThemeName } from "./theme";

/**
 * A theme's archive (ADR `common-images-and-themes`, decisions 5 and 10): the theme's folder as
 * it is, its files at the top, named `<name>.theme.zip`. A theme is exported alone: it holds
 * no menu and names no module's file, so the archive is the whole of it.
 */
const SUFFIX = ".theme.zip";

/** The folders a theme holds: its redraws and colours, its own images, its drawing notes. */
const THEME_DIRS = ["overrides", "assets", "data"];

/** A theme's archive is small: pixel-art images. */
export const THEME_ARCHIVE_MAX_BYTES = 8 * 1024 * 1024;

export const themeArchiveName = (name: string): string => `${name}${SUFFIX}`;

/**
 * The theme's name an archive's file name gives: `noel.theme.zip`, `noel.zip`, and the copies
 * a browser makes of them (`noel.theme (1).zip`). `undefined` when that is no theme's name, or the common images'.
 */
export function themeNameFromArchive(fileName: string): string | undefined {
  const base = fileName.split(/[\\/]/).pop() ?? "";
  const name = base
    .replace(/\.zip$/i, "")
    .replace(/\s*\(\d+\)$/, "")
    .replace(/\.theme$/i, "")
    .replace(/\s*\(\d+\)$/, "")
    .trim()
    .toLowerCase();
  return isThemeName(name) && name !== KIT_FOLDER ? name : undefined;
}

export interface ThemeArchive {
  /** The theme's text files, by their path in its folder. */
  files: Record<string, string>;
  /** Its images, the same way. */
  binaries: Record<string, Uint8Array>;
}

/** Why an archive is not a theme's: it is a module's, it holds no theme file, or it is too heavy. */
export type ThemeArchiveError = "is_module" | "not_a_theme" | "too_large";

const size = (content: string | Uint8Array) =>
  typeof content === "string" ? content.length : content.byteLength;

/**
 * The files of the theme an archive holds, whatever folder wraps them: what is under
 * `overrides/`, `assets/` and `data/` of the shallowest folder that has one of them. Anything
 * else is left out (a theme holds nothing else the server reads). An archive whose folder
 * holds a module's file is a module, to import as one.
 */
export function themeArchiveFiles(
  entries: Readonly<Record<string, string | Uint8Array>>,
): ThemeArchive | ThemeArchiveError {
  const paths = Object.keys(entries).filter(
    (path) => !path.includes("\\") && !path.includes(":") && !path.split("/").includes(".."),
  );
  // The folder the theme's own folders are in: the shallowest one, the archive's top included.
  const depth = (prefix: string) => (prefix === "" ? 0 : prefix.split("/").length);
  const roots = new Set<string>();
  for (const path of paths) {
    const parts = path.split("/");
    const at = parts.findIndex((part, i) => i < parts.length - 1 && THEME_DIRS.includes(part));
    if (at >= 0) roots.add(parts.slice(0, at).join("/"));
  }
  if (roots.size === 0) return "not_a_theme";
  const shallowest = Math.min(...[...roots].map(depth));
  const candidates = [...roots].filter((prefix) => depth(prefix) === shallowest);
  // Several themes side by side: which one is meant is not the archive's to say.
  if (candidates.length !== 1) return "not_a_theme";
  const root = candidates[0] as string;
  const under = root === "" ? "" : `${root}/`;
  const isModule = paths.some(
    (path) =>
      path.startsWith(under) &&
      !path.slice(under.length).includes("/") &&
      isModuleFile(path.slice(under.length)),
  );
  if (isModule) return "is_module";
  const archive: ThemeArchive = { files: {}, binaries: {} };
  let total = 0;
  for (const path of paths) {
    if (!path.startsWith(under)) continue;
    const inside = path.slice(under.length);
    if (!THEME_DIRS.some((dir) => inside.startsWith(`${dir}/`))) continue;
    const content = entries[path] as string | Uint8Array;
    total += size(content);
    if (typeof content === "string") archive.files[inside] = content;
    else archive.binaries[inside] = content;
  }
  if (total > THEME_ARCHIVE_MAX_BYTES) return "too_large";
  if (Object.keys(archive.files).length + Object.keys(archive.binaries).length === 0)
    return "not_a_theme";
  return archive;
}

/** The archive's files in the batches one write carries: each at most `maxBytes` of images. */
export function themeArchiveBatches(
  archive: ThemeArchive,
  maxBytes = 2 * 1024 * 1024,
): { files: Record<string, string>; binaries: Record<string, Uint8Array> }[] {
  const batches: { files: Record<string, string>; binaries: Record<string, Uint8Array> }[] = [];
  let current = { files: archive.files, binaries: {} as Record<string, Uint8Array> };
  let weight = 0;
  for (const path of Object.keys(archive.binaries).sort()) {
    const bytes = archive.binaries[path] as Uint8Array;
    if (weight > 0 && weight + bytes.byteLength > maxBytes) {
      batches.push(current);
      current = { files: {}, binaries: {} };
      weight = 0;
    }
    current.binaries[path] = bytes;
    weight += bytes.byteLength;
  }
  batches.push(current);
  return batches;
}
