import JSZip from "jszip";
import { parse } from "yaml";

/** Canonical on-disk root of a project's file tree. */
const PROJECT_BASE = "plugins/Artisan/projects";

export interface NormalizedProjectFiles {
  projectId: string;
  files: Record<string, string>;
}

/** `__MACOSX/*`, `.DS_Store` and bare directory entries carry nothing. */
function isJunk(path: string): boolean {
  return (
    path.endsWith("/") ||
    path.startsWith("__MACOSX/") ||
    path.split("/").some((seg) => seg === ".DS_Store" || seg.startsWith("._"))
  );
}

/**
 * Re-root an archive's entries onto the canonical
 * `plugins/Artisan/projects/<id>/` layout, whatever shape they arrived in:
 * our own export, a project directory zipped straight off the server, a
 * manifest at the archive root, or any of those wrapped in an extra folder.
 *
 * The project root is the directory holding the **shallowest** `manifest.yaml`.
 * Everything under it is carried verbatim — including files the editor domain
 * does not model (`.artisan/editor.yaml`, an Add-on root's own `config.yml`),
 * which is the point of exporting the tree rather than regenerating it.
 */
export function normalizeProjectFiles(entries: Record<string, string>): NormalizedProjectFiles {
  const paths = Object.keys(entries).filter((p) => !isJunk(p));

  const manifestPath = paths
    .filter((p) => p === "manifest.yaml" || p.endsWith("/manifest.yaml"))
    .sort((a, b) => a.split("/").length - b.split("/").length || a.localeCompare(b))[0];
  if (!manifestPath) throw new Error("no_manifest");

  const root = manifestPath.slice(0, manifestPath.length - "manifest.yaml".length);
  const declaredId = (() => {
    try {
      const m = parse(entries[manifestPath] ?? "") as { project_id?: unknown } | null;
      return typeof m?.project_id === "string" && m.project_id.trim() ? m.project_id.trim() : null;
    } catch {
      return null;
    }
  })();
  const dirName = root.replace(/\/$/, "").split("/").pop() ?? "";
  const projectId = declaredId ?? (dirName || "imported");

  const files: Record<string, string> = {};
  for (const path of paths) {
    if (!path.startsWith(root)) continue;
    files[`${PROJECT_BASE}/${projectId}/${path.slice(root.length)}`] = entries[path] ?? "";
  }
  return { projectId, files };
}

/** Read every text entry of a zip into a flat `path → content` map. */
export async function readProjectZip(file: Blob): Promise<Record<string, string>> {
  let zip: JSZip;
  try {
    zip = await JSZip.loadAsync(file);
  } catch {
    throw new Error("not_a_zip");
  }
  const out: Record<string, string> = {};
  const entries = Object.values(zip.files).filter((e) => !e.dir);
  await Promise.all(
    entries.map(async (e) => {
      out[e.name] = await e.async("string");
    }),
  );
  return out;
}
