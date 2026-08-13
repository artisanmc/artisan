import type { PlannedDelete, PlannedWrite } from "@/features/project/diskSave";

const API_URL = import.meta.env.VITE_API_URL ?? "http://localhost:3001";

/**
 * Lecture / écriture des fichiers d'un Project **sur le disque du serveur**
 * (ADR `server-disk-only-storage`). Le backend relaie au plugin ; il ne détient
 * aucune copie, donc serveur hors ligne = Project inouvrable, jamais un repli
 * périmé.
 */

export type ProjectFilesError =
  | "server_offline"
  | "fetch_timeout"
  | "unknown_project"
  | "invalid_path"
  | "invalid_input"
  | "read_error"
  | "write_error"
  | "too_large"
  | "network_error"
  | "forbidden";

export interface ProjectFileConflict {
  path: string;
  /** Contenu actuel sur disque ; `null` = le fichier y a été supprimé. */
  disk: string | null;
}

export type ProjectReadResult =
  | { ok: true; files: Record<string, string> }
  | { ok: false; error: ProjectFilesError };

export type ProjectWriteResult =
  | { ok: true }
  | { ok: false; error: "conflict"; conflicts: ProjectFileConflict[] }
  | { ok: false; error: ProjectFilesError };

function knownError(raw: unknown, fallback: ProjectFilesError): ProjectFilesError {
  const codes: ProjectFilesError[] = [
    "server_offline", "fetch_timeout", "unknown_project", "invalid_path",
    "invalid_input", "read_error", "write_error", "too_large", "forbidden",
  ];
  return codes.includes(raw as ProjectFilesError) ? (raw as ProjectFilesError) : fallback;
}

function base(networkId: string, serverId: string, diskId: string): string {
  return `${API_URL}/api/v1/networks/${networkId}/servers/${serverId}/projects/${encodeURIComponent(diskId)}/files`;
}

/** L'arbre complet du Project, lu à la demande sur le disque du serveur. */
export async function readProjectFiles(
  networkId: string,
  serverId: string,
  diskId: string,
): Promise<ProjectReadResult> {
  try {
    const res = await fetch(base(networkId, serverId, diskId), { credentials: "include" });
    const body = (await res.json().catch(() => null)) as {
      files?: { path: string; content: string }[];
      error?: string;
    } | null;
    if (!res.ok) return { ok: false, error: knownError(body?.error, "read_error") };
    const files: Record<string, string> = {};
    for (const f of body?.files ?? []) files[f.path] = f.content;
    return { ok: true, files };
  } catch {
    return { ok: false, error: "network_error" };
  }
}

/**
 * Écrit le delta sur le disque du serveur. Un 409 rapporte les fichiers qui ont
 * bougé, **avec leur contenu disque** — de quoi afficher le diff sans second
 * aller-retour. Rien n'a été écrit dans ce cas : le plugin applique tout ou rien.
 */
export async function writeProjectFiles(
  networkId: string,
  serverId: string,
  diskId: string,
  plan: { files: PlannedWrite[]; deletes: PlannedDelete[] },
): Promise<ProjectWriteResult> {
  try {
    const res = await fetch(base(networkId, serverId, diskId), {
      method: "PUT",
      credentials: "include",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ files: plan.files, deletes: plan.deletes }),
    });
    if (res.status === 409) {
      const body = (await res.json().catch(() => null)) as { conflicts?: ProjectFileConflict[] } | null;
      return { ok: false, error: "conflict", conflicts: body?.conflicts ?? [] };
    }
    if (!res.ok) {
      const body = (await res.json().catch(() => null)) as { error?: string } | null;
      return { ok: false, error: knownError(body?.error, "write_error") };
    }
    return { ok: true };
  } catch {
    return { ok: false, error: "network_error" };
  }
}
