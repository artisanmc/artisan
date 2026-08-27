import type { Project } from "@/domain/types";
import { readProjectFiles } from "@/lib/api/projectFiles";
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
  networkId: string,
  serverId: string,
): Promise<ExportZipResult> {
  if (!hasUser) return { ok: false, error: "not_signed_in" };
  try {
    const diskId = project.diskId ?? project.id;
    const disk = await readProjectFiles(networkId, serverId, diskId);
    if (!disk.ok) {
      return { ok: false, error: disk.error === "server_offline" ? "server_offline" : "transport" };
    }
    if (disk.unchanged) {
      // On n'annonce aucune empreinte ici : le serveur n'a rien à comparer, donc
      // ce cas n'arrive pas. Plutôt que de forcer la main au compilateur, on
      // échoue franchement — un zip vide serait pire qu'un export refusé.
      return { ok: false, error: "transport" };
    }
    // buildZip attend les chemins canoniques que produisait le store backend.
    const canonical: Record<string, string> = {};
    for (const [rel, content] of Object.entries(disk.files)) {
      canonical[`plugins/Artisan/projects/${diskId}/${rel}`] = content;
    }
    const blob = await buildZip(canonical);
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `${project.id}.zip`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
    return { ok: true };
  } catch {
    return { ok: false, error: "transport" };
  }
}
