import type { PlannedDelete, PlannedWrite } from "@/features/project/diskSave";
import { projectFetch } from "@/lib/projectFetch";
import { isPrivateProjectPath } from "@/lib/projectFileVisibility";
import type { ProjectSummary } from "./networks";

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
  | "forbidden"
  | "quota_denied"
  | "inventory_unavailable"
  | "plugin_update_required";
export interface EditorAccessDto {
  enabled: boolean;
  quota: number;
  proUntil: string | null;
  inventoryAvailable: boolean;
  count: number | null;
  reason: "free_quota_reached" | "free_quota_exceeded" | "inventory_unavailable" | null;
  projectOrigin: "personal" | "module";
}

export async function getEditorAccess(projectId: string): Promise<EditorAccessDto | null> {
  const res = await fetch(`${API_URL}/api/v1/projects/${encodeURIComponent(projectId)}/editor-access`, { credentials: "include", cache: "no-store" });
  if (res.status === 422) return null;
  const body = await res.json().catch(() => null) as EditorAccessDto | null;
  if (res.ok || res.status === 503 && body?.reason === "inventory_unavailable") return body;
  throw new Error("editor_access_unavailable");
}

export interface ProjectFileConflict {
  path: string;
  /** Contenu actuel sur disque ; `null` = le fichier y a été supprimé. */
  disk: string | null;
}

/** Un Document que le serveur n'a pas réussi à charger, et pourquoi. */
export interface FailedDocument {
  path: string;
  reason: string;
}

export type ProjectReadResult =
  | {
      ok: true;
      unchanged?: false;
      files: Record<string, string>;
      binaries?: { path: string; hash: string; size: number }[];
      failed: FailedDocument[];
      hash: string | null;
      /** Serveur éteint : dernière copie connue du backend, reçue à cette date. */
      offlineSince?: string;
      /** Jamais publié : rien sur le disque, tout est dans le brouillon. */
      unpublished?: boolean;
    }
  /**
   * Le serveur porte exactement l'empreinte annoncée : rien n'a été transporté,
   * et la dernière version connue reste valable — elle vient d'être revalidée.
   */
  | { ok: true; unchanged: true; hash: string | null; offlineSince?: string; unpublished?: boolean }
  | { ok: false; error: ProjectFilesError };

export type ProjectWriteResult =
  | { ok: true }
  | {
      ok: false;
      error: "conflict";
      conflicts: ProjectFileConflict[];
      /** L'état réel du dossier — de quoi voir qu'un fichier renommé est apparu. */
      diskFiles: string[];
    }
  | { ok: false; error: ProjectFilesError; code?: string; status?: number; message?: string };

function knownError(raw: unknown, fallback: ProjectFilesError): ProjectFilesError {
  const codes: ProjectFilesError[] = [
    "server_offline",
    "fetch_timeout",
    "unknown_project",
    "invalid_path",
    "invalid_input",
    "read_error",
    "write_error",
    "too_large",
    "forbidden",
    "quota_denied",
    "inventory_unavailable",
    "plugin_update_required",
  ];
  return codes.includes(raw as ProjectFilesError) ? (raw as ProjectFilesError) : fallback;
}

function base(networkId: string, serverId: string | undefined, diskId: string | undefined): string {
  if (diskId === undefined)
    return `${API_URL}/api/v1/projects/${encodeURIComponent(networkId)}/files`;
  return `${API_URL}/api/v1/networks/${networkId}/servers/${serverId}/projects/${encodeURIComponent(diskId)}/files`;
}

/** L'arbre complet du Project, lu à la demande sur le disque du serveur. */
export async function readProjectFiles(
  networkId: string,
  serverId?: string,
  diskId?: string,
  /**
   * L'empreinte qu'on détient déjà. Le serveur ne renvoie l'arbre que s'il a
   * changé — sinon il répond `unchanged`, et on garde ce qu'on avait sans avoir
   * transporté plusieurs secondes de fichiers pour l'apprendre.
   */
  ifHash?: string | null,
): Promise<ProjectReadResult> {
  try {
    const url = ifHash
      ? `${base(networkId, serverId, diskId)}?if_hash=${encodeURIComponent(ifHash)}`
      : base(networkId, serverId, diskId);
    const res = await projectFetch(diskId === undefined ? networkId : undefined, url, {
      credentials: "include",
    });
    const body = (await res.json().catch(() => null)) as {
      files?: { path: string; content: string }[];
      binaries?: { path: string; hash: string; size: number }[];
      failed?: FailedDocument[];
      hash?: string | null;
      unchanged?: boolean;
      offlineSince?: string;
      unpublished?: boolean;
      error?: string;
    } | null;
    if (!res.ok) return { ok: false, error: knownError(body?.error, "read_error") };
    const offline = {
      ...(body?.offlineSince ? { offlineSince: body.offlineSince } : {}),
      ...(body?.unpublished ? { unpublished: true } : {}),
    };
    if (body?.unchanged) return { ok: true, unchanged: true, hash: body.hash ?? null, ...offline };
    const files: Record<string, string> = {};
    for (const f of body?.files ?? []) if (!isPrivateProjectPath(f.path)) files[f.path] = f.content;
    return {
      ok: true,
      files,
      binaries: (body?.binaries ?? []).filter((file) => !isPrivateProjectPath(file.path)),
      failed: body?.failed ?? [],
      hash: body?.hash ?? null,
      ...offline,
    };
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
  serverId: string | undefined,
  diskId: string | undefined,
  plan: {
    files: PlannedWrite[];
    deletes: PlannedDelete[];
    renames?: { from: string; to: string; base_hash: string }[];
    create?: boolean;
    operationId?: string;
    binaries?: { path: string; content_base64: string | null; base_hash: string | null }[];
  },
): Promise<ProjectWriteResult> {
  try {
    const res = await projectFetch(
      diskId === undefined ? networkId : undefined,
      base(networkId, serverId, diskId),
      {
        method: "PUT",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          files: plan.files,
          deletes: plan.deletes,
          renames: plan.renames ?? [],
          create: plan.create === true,
          ...(plan.operationId ? { operationId: plan.operationId } : {}),
          ...(plan.binaries ? { binaries: plan.binaries } : {}),
        }),
      },
    );
    if (res.status === 409) {
      const body = (await res.json().catch(() => null)) as {
        conflicts?: ProjectFileConflict[];
        disk_files?: string[];
      } | null;
      return {
        ok: false,
        error: "conflict",
        conflicts: body?.conflicts ?? [],
        diskFiles: body?.disk_files ?? [],
      };
    }
    if (!res.ok) {
      const body = (await res.json().catch(() => null)) as {
        error?: string;
        message?: unknown;
      } | null;
      return {
        ok: false,
        error: knownError(body?.error, "write_error"),
        code: typeof body?.error === "string" ? body.error : "write_error",
        status: res.status,
        ...(typeof body?.message === "string" ? { message: body.message } : {}),
      };
    }
    return { ok: true };
  } catch {
    return { ok: false, error: "network_error" };
  }
}

export interface FileVersion {
  /** Millis de l'archivage. */
  at: number;
  content: string;
  /** Présent quand l'historique vient des Versions ; `null` = le serveur. */
  author?: { id: string; name: string } | null;
}

export type ProjectHistoryResult =
  | { ok: true; versions: FileVersion[] }
  | { ok: false; error: ProjectFilesError };

/**
 * Les versions archivées d'UN fichier — la corbeille que le plugin écrit avant
 * chaque écrasement (ADR `server-disk-only-storage` décision 5), la plus récente
 * d'abord.
 *
 * Restaurer n'a pas d'appel dédié : on remet le contenu choisi dans l'éditeur et
 * on enregistre. C'est une écriture comme une autre, donc elle passe par le même
 * compare-and-swap — restaurer ne peut pas écraser dans le dos de quelqu'un.
 */
export async function readFileHistory(
  networkId: string,
  serverId: string | undefined,
  diskId: string | undefined,
  path: string,
): Promise<ProjectHistoryResult> {
  try {
    const url = `${base(networkId, serverId, diskId).replace(/\/files$/, "/history")}?path=${encodeURIComponent(path)}`;
    const res = await fetch(url, { credentials: "include" });
    const body = (await res.json().catch(() => null)) as {
      versions?: FileVersion[];
      error?: string;
    } | null;
    if (!res.ok) return { ok: false, error: knownError(body?.error, "read_error") };
    return { ok: true, versions: body?.versions ?? [] };
  } catch {
    return { ok: false, error: "network_error" };
  }
}

export type ProjectListResult =
  | { ok: true; projectIds: string[]; projects?: ProjectSummary[] }
  | { ok: false; error: ProjectFilesError };

/**
 * Les Projects présents sur le disque du serveur, **maintenant**.
 *
 * Le backend n'en tient plus de liste : elle se périmait au premier dossier
 * renommé ou supprimé (ADR `server-disk-only-storage`). Le nom du dossier EST
 * l'identité du Project — le renommer le renomme, immédiatement.
 *
 * Serveur hors ligne → erreur, et donc liste vide : ses Projects ne sont de
 * toute façon pas ouvrables.
 */
export async function listServerProjects(
  networkId: string,
  serverId: string,
): Promise<ProjectListResult> {
  try {
    const res = await fetch(
      `${API_URL}/api/v1/networks/${networkId}/servers/${serverId}/projects`,
      { credentials: "include" },
    );
    const body = (await res.json().catch(() => null)) as {
      project_ids?: string[];
      projects?: ProjectSummary[];
      error?: string;
    } | null;
    if (!res.ok) return { ok: false, error: knownError(body?.error, "read_error") };
    return {
      ok: true,
      projectIds: body?.project_ids ?? [],
      ...(body?.projects ? { projects: body.projects } : {}),
    };
  } catch {
    return { ok: false, error: "network_error" };
  }
}
