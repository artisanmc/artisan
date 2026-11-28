import { hashBytes } from "@/lib/contentHash";
import { parse } from "yaml";
import type { PackProject } from "./packAssembly";

/**
 * The theme `artisan` in a folder that holds its whole tree (ADR `editable-module-tree`,
 * decision 9): Artisan's images and components sit at their own paths, and `artisan-shipped.yml`
 * says which are still Artisan's drawing (same bytes as shipped). The builder reads them as it
 * reads the former layout: an untouched file is the base (`originals/…`), a redrawn one the
 * server's. Mirror of `KitLayout.kt`, one conformance case.
 */
export const KIT_SHIPPED_INDEX = "artisan-shipped.yml";
const ORIGINALS = "originals/";

/** `files: { <path>: { hash } }` of the index, by path. */
function hashes(text: string): Map<string, string> {
  let root: unknown;
  try {
    root = parse(text);
  } catch {
    return new Map();
  }
  const files = (root as { files?: unknown } | null)?.files;
  const out = new Map<string, string>();
  if (!files || typeof files !== "object") return out;
  for (const [path, e] of Object.entries(files as Record<string, unknown>)) {
    const hash = (e as { hash?: unknown } | null)?.hash;
    if (typeof hash === "string") out.set(path, hash);
  }
  return out;
}

/** `project` as the builder reads the common images: unchanged unless it is the tree layout. */
export async function kitAsRead(project: PackProject): Promise<PackProject> {
  const index = project.files.find((f) => f.path === KIT_SHIPPED_INDEX);
  if (!index) return project;
  if (
    project.files.some((f) => f.path.startsWith(ORIGINALS)) ||
    project.binaries.some((b) => b.path.startsWith(ORIGINALS))
  )
    return project;
  const shipped = hashes(index.content);
  const files: PackProject["files"] = [];
  for (const f of project.files) {
    if (f.path === KIT_SHIPPED_INDEX) continue;
    const expected = shipped.get(f.path);
    const same =
      expected !== undefined && (await hashBytes(new TextEncoder().encode(f.content))) === expected;
    files.push(same ? { path: ORIGINALS + f.path, content: f.content } : f);
  }
  const moved = new Map<string, string>();
  const binaries = project.binaries.map((b) => {
    if (shipped.get(b.path) !== b.hash) return b;
    moved.set(ORIGINALS + b.path, b.path);
    return { ...b, path: ORIGINALS + b.path };
  });
  return { ...project, files, binaries, binary: (path) => project.binary(moved.get(path) ?? path) };
}
