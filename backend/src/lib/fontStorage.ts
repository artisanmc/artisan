import { mkdir, writeFile, readFile, rm } from "fs/promises";
import { dirname, join, resolve, normalize, sep, isAbsolute } from "path";

export interface FontPaths {
  /** Absolute path to the font asset's root dir. */
  dir: string;
  /** Absolute path to the font.json file. */
  fontJson: string;
}

export function fontDirPaths(projectId: string, assetId: string): FontPaths {
  const dir = resolve("data/assets", projectId, "fonts", assetId);
  return { dir, fontJson: join(dir, "font.json") };
}

/**
 * Returns true if relPath is safe to use as a relative path inside the font dir:
 * - not absolute
 * - does not contain ".." after normalization
 * - does not start with a path separator after normalization
 */
function isSafeGlyphPath(relPath: string): boolean {
  if (isAbsolute(relPath)) return false;
  const normalized = normalize(relPath);
  if (normalized.split(sep).includes("..")) return false;
  if (normalized.startsWith(sep)) return false;
  // On Windows, normalize may convert "/" to "\". Also reject leading "/" on the raw input
  // for cross-platform consistency (already covered by normalized.startsWith(sep) on POSIX).
  if (normalized.startsWith("/")) return false;
  return true;
}

/** Write font.json plus all glyph PNGs (keyed by relative path inside the font dir). */
export async function writeFontAssets(
  projectId: string,
  assetId: string,
  fontJsonContent: Uint8Array,
  glyphPngs: Map<string, Uint8Array>,
): Promise<void> {
  // Validate all glyph paths BEFORE any I/O so we never partially write.
  for (const relPath of glyphPngs.keys()) {
    if (!isSafeGlyphPath(relPath)) {
      throw new Error(`invalid glyph path: ${relPath}`);
    }
  }

  const { dir, fontJson } = fontDirPaths(projectId, assetId);
  await mkdir(dir, { recursive: true });
  await writeFile(fontJson, fontJsonContent);

  for (const [relPath, bytes] of glyphPngs.entries()) {
    const dest = join(dir, relPath);
    await mkdir(dirname(dest), { recursive: true });
    await writeFile(dest, bytes);
  }
}

/** Recursively delete the font asset's directory. Idempotent. */
export async function deleteFontAssets(projectId: string, assetId: string): Promise<void> {
  const { dir } = fontDirPaths(projectId, assetId);
  await rm(dir, { recursive: true, force: true });
}

/** Read a single glyph PNG by its relative path inside the font dir. Returns null on miss. */
export async function readFontGlyph(
  projectId: string,
  assetId: string,
  relPath: string,
): Promise<Uint8Array | null> {
  if (!isSafeGlyphPath(relPath)) return null;
  const { dir } = fontDirPaths(projectId, assetId);
  const target = join(dir, relPath);
  try {
    const buf = await readFile(target);
    return new Uint8Array(buf.buffer, buf.byteOffset, buf.byteLength);
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === "ENOENT") return null;
    throw err;
  }
}
