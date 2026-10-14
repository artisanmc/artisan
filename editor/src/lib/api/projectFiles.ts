import type { PlannedDelete, PlannedWrite } from "@/features/project/diskSave";
import { projectFetch } from "@/lib/projectFetch";
import { isPrivateProjectPath } from "@/lib/projectFileVisibility";
import type { ProjectSummary } from "./networks";

const API_URL = import.meta.env.VITE_API_URL ?? "";

/**
 * Reading / writing a Project's files **on the server's disk** (ADR
 * `server-disk-only-storage`). The hub relays to the plugin; it holds no copy,
 * so server offline = Project cannot be opened, never a stale fallback.
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
  quota: number | null;
  proUntil: string | null;
  inventoryAvailable: boolean;
  count: number | null;
  reason: "free_quota_reached" | "free_quota_exceeded" | "inventory_unavailable" | null;
  projectOrigin: "personal" | "module";
}

export type ServerEditorAccessDto = Omit<EditorAccessDto, "projectOrigin">;

export async function getServerEditorAccess(serverId: string): Promise<ServerEditorAccessDto> {
  const res = await fetch(`${API_URL}/api/v1/servers/${encodeURIComponent(serverId)}/editor-access`, { credentials: "include", cache: "no-store" });
  const body = await res.json().catch(() => null) as ServerEditorAccessDto | null;
  if (body && (res.ok || res.status === 503 && body.reason === "inventory_unavailable")) return body;
  throw new Error("editor_access_unavailable");
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
  /** Current content on disk; `null` = the file was deleted there. */
  disk: string | null;
}

/** A Document the server failed to load, and why. */
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
      /** Server off: the hub's last known copy, received at this date. */
      offlineSince?: string;
      /** Never published: nothing on disk, everything is in the draft. */
      unpublished?: boolean;
    }
  /**
   * The server holds exactly the announced fingerprint: nothing was transferred,
   * and the last known version stays valid — it was just revalidated.
   */
  | { ok: true; unchanged: true; hash: string | null; offlineSince?: string; unpublished?: boolean }
  | { ok: false; error: ProjectFilesError };

export type ProjectWriteResult =
  | { ok: true }
  | {
      ok: false;
      error: "conflict";
      conflicts: ProjectFileConflict[];
      /** The folder's real state — enough to see that a renamed file appeared. */
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

/** A Project named by its id, or by its folder on a given server. */
export type ProjectTarget = string | { serverId: string; diskId: string };

function base(target: ProjectTarget): string {
  if (typeof target === "string")
    return `${API_URL}/api/v1/projects/${encodeURIComponent(target)}/files`;
  return `${API_URL}/api/v1/servers/${target.serverId}/projects/${encodeURIComponent(target.diskId)}/files`;
}

const fetchProjectId = (target: ProjectTarget) => (typeof target === "string" ? target : undefined);

/** The Project's full tree, read on demand from the server's disk. */
export async function readProjectFiles(
  target: ProjectTarget,
  /**
   * The fingerprint we already hold. The server only sends the tree back if it
   * changed — otherwise it answers `unchanged`, and we keep what we had without
   * transferring seconds' worth of files to learn it.
   */
  ifHash?: string | null,
): Promise<ProjectReadResult> {
  try {
    const url = ifHash
      ? `${base(target)}?if_hash=${encodeURIComponent(ifHash)}`
      : base(target);
    const res = await projectFetch(fetchProjectId(target), url, {
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
 * Writes the delta to the server's disk. A 409 reports the files that moved,
 * **with their disk content** — enough to show the diff without a second round
 * trip. Nothing was written in that case: the plugin applies all or nothing.
 */
export async function writeProjectFiles(
  target: ProjectTarget,
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
      fetchProjectId(target),
      base(target),
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
  /** Present when the history comes from Versions; `null` = the server. */
  author?: { id: string; name: string } | null;
}

export type ProjectHistoryResult =
  | { ok: true; versions: FileVersion[] }
  | { ok: false; error: ProjectFilesError };

/**
 * The archived versions of ONE file — the trash the plugin writes before each
 * overwrite (ADR `server-disk-only-storage` decision 5), most recent first.
 *
 * Restoring has no dedicated call: the chosen content is put back in the
 * editor and saved. It is a write like any other, so it goes through the same
 * compare-and-swap — a restore cannot overwrite behind someone's back.
 */
export async function readFileHistory(
  target: ProjectTarget,
  path: string,
): Promise<ProjectHistoryResult> {
  try {
    const url = `${base(target).replace(/\/files$/, "/history")}?path=${encodeURIComponent(path)}`;
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
 * The Projects present on the server's disk, **now**.
 *
 * The hub keeps no list of them: it went stale on the first renamed or deleted
 * folder (ADR `server-disk-only-storage`). The folder name IS the Project's
 * identity — renaming it renames the Project, immediately.
 *
 * Server offline → error, hence an empty list: its Projects cannot be opened
 * anyway.
 */
export async function listServerProjects(serverId: string): Promise<ProjectListResult> {
  try {
    const res = await fetch(
      `${API_URL}/api/v1/servers/${serverId}/projects`,
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
