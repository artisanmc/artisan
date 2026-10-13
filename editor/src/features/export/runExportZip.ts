import type { Project } from "@/domain/types";
import { projectTree } from "@/features/project/saveProjectToDisk";
import { readDraftBlob } from "@/lib/api/projectDrafts";
import { projectClient } from "@/lib/projectClient";
import { useProjectBaselineStore } from "@/state/projectBaselineStore";
import { useProjectDraftStore } from "@/state/projectDraftStore";
import { buildZip } from "./buildZip";

export interface ExportZipResult {
  ok: boolean;
  /** Set when the export could not be produced. */
  error?: "not_signed_in" | "server_offline" | "transport";
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
export async function runExportZip(
  project: Project,
  hasUser: boolean,
  _networkId?: string,
  _serverId?: string,
): Promise<ExportZipResult> {
  if (!hasUser) return { ok: false, error: "not_signed_in" };
  try {
    const diskId = project.diskId ?? project.id;
    const client = projectClient(project.id);
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
    // buildZip expects the canonical project paths.
    const canonical: Record<string, string | Uint8Array> = {};
    for (const [rel, content] of Object.entries(disk.files)) {
      canonical[`plugins/Artisan/projects/${diskId}/${rel}`] = content;
    }
    for (const binary of disk.binaries ?? []) {
      canonical[`plugins/Artisan/projects/${diskId}/${binary.path}`] = await client.binary(
        binary.path,
      );
    }
    await download(canonical, project.id);
    return { ok: true };
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
      canonical[`plugins/Artisan/projects/${diskId}/${rel}`] = content;
    }
    for (const [path, meta] of Object.entries(images)) {
      const unchanged = base[path]?.hash === meta.hash;
      if (!unchanged && !draft?.remote) return { ok: false, error: "transport" };
      canonical[`plugins/Artisan/projects/${diskId}/${path}`] = unchanged
        ? await client.binary(path)
        : await readDraftBlob(project.id, draft!.remote!.id, meta.hash);
    }
    await download(canonical, project.id);
    return { ok: true };
  } catch {
    return { ok: false, error: "transport" };
  }
}

async function download(files: Record<string, string | Uint8Array>, name: string) {
  const blob = await buildZip(files);
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = `${name}.zip`;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}
