import { isPrivateProjectPath } from "@/lib/projectFileVisibility";
import { isValidProjectFolderName } from "@/lib/projectFolderName";
import { isModuleFile } from "@/lib/yamlFiles";
import JSZip from "jszip";

/** Canonical on-disk root of a project's file tree. */
const PROJECT_BASE = "plugins/Artisan/projects";

export interface NormalizedProjectFiles<T = string> {
  projectId: string;
  files: Record<string, T>;
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
 * The project root is the directory holding the **shallowest** module file
 * (`artisan-module.yml`, formerly `manifest.yaml`).
 * Everything under it is carried verbatim — including files the editor domain
 * does not model (`.artisan/editor.yaml`, an Add-on root's own `config.yml`),
 * which is the point of exporting the tree rather than regenerating it.
 */
export function normalizeProjectFiles<T extends string | Uint8Array>(
  entries: Record<string, T>,
  targetId?: string,
): NormalizedProjectFiles<T> {
  const paths = Object.keys(entries).filter((p) => !isJunk(p) && !isPrivateProjectPath(p));

  const manifestPath = paths
    .filter((p) => isModuleFile(p.split("/").pop()!))
    .sort((a, b) => a.split("/").length - b.split("/").length || a.localeCompare(b))[0];
  if (!manifestPath) throw new Error("no_manifest");

  const root = manifestPath.slice(0, manifestPath.lastIndexOf("/") + 1);
  const dirName = root.replace(/\/$/, "").split("/").pop() ?? "";
  const projectId = targetId?.trim() || dirName;
  if (!projectId) throw new Error("project_id_required");
  if (targetId !== undefined && !isValidProjectFolderName(projectId))
    throw new Error("invalid_project_id");
  if (
    projectId === "." ||
    projectId === ".." ||
    /[\\/]/.test(projectId) ||
    [...projectId].some((character) => character.charCodeAt(0) < 32)
  ) {
    throw new Error("invalid_project_id");
  }

  const files: Record<string, T> = {};
  for (const path of paths) {
    if (!path.startsWith(root)) continue;
    files[`${PROJECT_BASE}/${projectId}/${path.slice(root.length)}`] = entries[path]!;
  }
  return { projectId, files };
}

/** Read every text entry of a zip into a flat `path → content` map. */
export async function readProjectZip(file: Blob): Promise<Record<string, string | Uint8Array>> {
  let zip: JSZip;
  try {
    zip = await JSZip.loadAsync(file);
  } catch {
    throw new Error("not_a_zip");
  }
  const out: Record<string, string | Uint8Array> = {};
  const entries = Object.values(zip.files).filter(
    (e) => !e.dir && !isJunk(e.name) && !isPrivateProjectPath(e.name),
  );
  await Promise.all(
    entries.map(async (e) => {
      const bytes = await e.async("uint8array");
      try {
        if (
          /\.(png|jpe?g|gif|webp|ttf|otf|woff2?|zip|ogg|mp3|wav)$/i.test(e.name) ||
          bytes.includes(0)
        ) {
          out[e.name] = bytes;
          return;
        }
        out[e.name] = new TextDecoder("utf-8", { fatal: true }).decode(bytes);
      } catch {
        out[e.name] = bytes;
      }
    }),
  );
  return out;
}
