import type { PlannedDelete, PlannedWrite } from "@/features/project/diskSave";
import { isPrivateProjectPath } from "@/lib/projectFileVisibility";
import { ApiError, apiFetch } from "./client";
import type { ProjectSummary } from "./servers";

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
  | "plugin_update_required";

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

/** The hub's code when it is one of ours; a transport failure is `network_error`; else `fallback`. */
function refusal(error: unknown, fallback: ProjectFilesError): ProjectFilesError {
  const failure = ApiError.from(error);
  return failure.status === 0 ? "network_error" : knownError(failure.code, fallback);
}

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
    "plugin_update_required",
  ];
  return codes.includes(raw as ProjectFilesError) ? (raw as ProjectFilesError) : fallback;
}

/** A Project named by its id, or by its folder on a given server. */
export type ProjectTarget = string | { serverId: string; diskId: string };

function base(target: ProjectTarget): string {
  if (typeof target === "string") return `/api/v1/projects/${encodeURIComponent(target)}/files`;
  return `/api/v1/servers/${target.serverId}/projects/${encodeURIComponent(target.diskId)}/files`;
}

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
    const url = ifHash ? `${base(target)}?if_hash=${encodeURIComponent(ifHash)}` : base(target);
    const body = await apiFetch<{
      files?: { path: string; content: string }[];
      binaries?: { path: string; hash: string; size: number }[];
      failed?: FailedDocument[];
      hash?: string | null;
      unchanged?: boolean;
      offlineSince?: string;
      unpublished?: boolean;
    } | null>(url);
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
  } catch (error) {
    return { ok: false, error: refusal(error, "read_error") };
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
    await apiFetch(base(target), {
      method: "PUT",
      json: {
        files: plan.files,
        deletes: plan.deletes,
        renames: plan.renames ?? [],
        create: plan.create === true,
        ...(plan.operationId ? { operationId: plan.operationId } : {}),
        ...(plan.binaries ? { binaries: plan.binaries } : {}),
      },
    });
    return { ok: true };
  } catch (error) {
    const failure = ApiError.from(error);
    if (failure.status === 0) return { ok: false, error: "network_error" };
    if (failure.status === 409) {
      const body = failure.body as {
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
    return {
      ok: false,
      error: knownError(failure.code, "write_error"),
      code: failure.hasCode ? failure.code : "write_error",
      status: failure.status,
      ...(failure.detail !== undefined ? { message: failure.detail } : {}),
    };
  }
}

export interface FileVersion {
  /** Archive time in milliseconds. */
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
    const body = await apiFetch<{ versions?: FileVersion[] } | null>(url);
    return { ok: true, versions: body?.versions ?? [] };
  } catch (error) {
    return { ok: false, error: refusal(error, "read_error") };
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
    const body = await apiFetch<{ project_ids?: string[]; projects?: ProjectSummary[] } | null>(
      `/api/v1/servers/${serverId}/projects`,
    );
    return {
      ok: true,
      projectIds: body?.project_ids ?? [],
      ...(body?.projects ? { projects: body.projects } : {}),
    };
  } catch (error) {
    return { ok: false, error: refusal(error, "read_error") };
  }
}
