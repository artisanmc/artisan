import type { Project } from "@/domain/types";
import { projectTree } from "@/features/project/saveProjectToDisk";
import { readDraftBlob } from "@/lib/api/projectDrafts";
import { EXPORT_NOTE } from "@/lib/pack/elsewhere";
import { themeArchiveName } from "@/lib/pack/themeArchive";
import { projectClient } from "@/lib/projectClient";
import { useProjectBaselineStore } from "@/state/projectBaselineStore";
import { useProjectDraftStore } from "@/state/projectDraftStore";
import { buildZip } from "./buildZip";
import { type ElsewhereExport, exportElsewhere } from "./exportElsewhere";

/**
 * The archive is the module's root as is: its files at the top, no folder and
 * no server path. Unzipped into the module's folder (`plugins/Artisan/modules/<folder>/`,
 * or an add-on's own, like `plugins/ArtisanDailyRewards/artisan_module/`), it is
 * the module again. Its name is the module's folder (`daily.zip`): that is what
 * the import of another server reads to find the module it updates.
 */
export function archiveName(diskId: string): string {
  return `${diskId}.zip`;
}

export interface ExportZipResult {
  ok: boolean;
  /** Set when the export could not be produced. */
  error?: "not_signed_in" | "server_offline" | "transport";
  /** The server's common images copied into the archive, when it has any (`exportElsewhere`). */
  copied?: string[];
  /**
   * The module's folder was exported alone: what it names elsewhere could not be read, so its
   * archive has no note and no copy of a common image.
   */
  alone?: true;
}

/**
 * Download the project's file tree **exactly as it sits on the server**, zipped.
 *
 * The archive is the disk truth (ADR `server-disk-only-storage`), not a
 * regeneration from the in-memory domain: it therefore carries what the domain
 * does not model — the `.artisan/editor.yaml` board state, and an Add-on root's
 * own files. And it is never gated on validation: getting your files out must
 * not depend on their being valid, which is the whole anti-lock-in promise.
 *
 * It reads the disk rather than the unsaved editor state on purpose — an export
 * is a snapshot of what the server actually runs. Unsaved edits are not in it,
 * for the same reason they are not in the game.
 */
export async function runExportZip(project: Project, hasUser: boolean): Promise<ExportZipResult> {
  if (!hasUser) return { ok: false, error: "not_signed_in" };
  return exportDisk(project.id, archiveName(project.diskId ?? project.id), project);
}

/**
 * Downloads the theme `name` as the server holds it (`<name>.theme.zip`): its folder as is,
 * the Project `projectId`. A theme is exported alone (ADR `common-images-and-themes`,
 * decision 10): it holds no menu and embeds nothing of a module.
 */
export function runExportThemeZip(projectId: string, name: string): Promise<ExportZipResult> {
  return exportDisk(projectId, themeArchiveName(name));
}

/**
 * The Project's files as its server's disk holds them, zipped under `fileName`. A `module`
 * also takes what it names elsewhere (`exportElsewhere`): a note, and the server's common
 * images a name alone reaches. Getting the folder out never depends on that: when it cannot be
 * read, the folder is exported alone (`alone`).
 */
async function exportDisk(
  projectId: string,
  fileName: string,
  module?: Project,
): Promise<ExportZipResult> {
  try {
    const client = projectClient(projectId);
    const disk = await client.read();
    if (!disk.ok) {
      return { ok: false, error: disk.error === "server_offline" ? "server_offline" : "transport" };
    }
    if (disk.unchanged) {
      // No fingerprint is announced here: the server has nothing to compare, so
      // this case does not happen. Rather than forcing the compiler's hand, fail
      // openly — an empty zip would be worse than a refused export.
      return { ok: false, error: "transport" };
    }
    const canonical: Record<string, string | Uint8Array> = {};
    for (const [rel, content] of Object.entries(disk.files)) {
      canonical[rel] = content;
    }
    for (const binary of disk.binaries ?? []) {
      canonical[binary.path] = await client.binary(binary.path);
    }
    if (!module) {
      await download(canonical, fileName);
      return { ok: true };
    }
    // A note left by an archive unzipped by hand speaks of another server.
    delete canonical[EXPORT_NOTE];
    let elsewhere: ElsewhereExport | null = null;
    let alone = false;
    try {
      elsewhere = await exportElsewhere(module, disk);
    } catch {
      alone = true;
    }
    // A copy never replaces a file of the module: it is made only for a name the module does not hold.
    for (const [path, content] of Object.entries(elsewhere?.files ?? {}))
      if (!(path in canonical)) canonical[path] = content;
    await download(canonical, fileName);
    return {
      ok: true,
      ...(elsewhere?.copied.length ? { copied: elsewhere.copied } : {}),
      ...(alone ? { alone: true as const } : {}),
    };
  } catch {
    return { ok: false, error: "transport" };
  }
}

/**
 * Exports the **current draft**: what the editor shows, modified images
 * included. This is the demo's export (ADR `server-only-projects`): it
 * publishes nothing, all its work lives in its draft.
 */
export async function runExportDraftZip(project: Project): Promise<ExportZipResult> {
  try {
    const diskId = project.diskId ?? project.id;
    const draft = useProjectDraftStore.getState().get(project.id);
    const published = useProjectBaselineStore.getState().binaryBaselines[project.id] ?? {};
    const base = draft?.binaryBaseline ?? published;
    const images = draft?.binaryTree ?? base;
    const client = projectClient(project.id);
    const canonical: Record<string, string | Uint8Array> = {};
    for (const [rel, content] of Object.entries(projectTree(project))) {
      canonical[rel] = content;
    }
    for (const [path, meta] of Object.entries(images)) {
      const unchanged = base[path]?.hash === meta.hash;
      if (!unchanged && !draft?.remote) return { ok: false, error: "transport" };
      canonical[path] = unchanged
        ? await client.binary(path)
        : await readDraftBlob(project.id, draft!.remote!.id, meta.hash);
    }
    await download(canonical, archiveName(diskId));
    return { ok: true };
  } catch {
    return { ok: false, error: "transport" };
  }
}

async function download(files: Record<string, string | Uint8Array>, fileName: string) {
  const blob = await buildZip(files);
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = fileName;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}
