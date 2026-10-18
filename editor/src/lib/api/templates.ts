import { ApiError, apiFetch } from "./client";
import type { ProjectTarget } from "./projectFiles";

/**
 * Module templates (ADR `module-templates`): example files a module ships, which any
 * Project can copy. Announced at Presence without content (`ActiveModule.templates`);
 * the files are read on demand, the copy is written by the server.
 */

export interface TemplateFileInfo {
  path: string;
  /** Lowercase hex SHA-256 of the file as shipped. */
  hash: string;
  size: number;
}

export interface TemplateInfo {
  id: string;
  title: string;
  /** Raised by the module each time it changes the files. */
  version: number;
  /** The Project the server created with these files once, at its first start. */
  seed_project?: string;
  files: TemplateFileInfo[];
}

/** Where a Project file copied from a template came from (`.artisan/origins.yaml`). */
export interface FileOrigin {
  module: string;
  template: string;
  version: number;
  /** Hash of the file as it was copied. */
  hash: string;
}

export type TemplateError =
  | "conflict"
  | "not_found"
  | "unknown_project"
  | "unknown_path"
  | "server_offline"
  | "plugin_update_required"
  | "forbidden"
  | "network_error"
  | "write_error"
  | "fetch_error";

function errorOf(error: unknown): TemplateError {
  const failure = ApiError.from(error);
  if (failure.status === 0) return "network_error";
  if (failure.status === 403) return "forbidden";
  const known: TemplateError[] = [
    "conflict",
    "not_found",
    "unknown_project",
    "unknown_path",
    "server_offline",
    "plugin_update_required",
    "write_error",
  ];
  return known.includes(failure.code as TemplateError)
    ? (failure.code as TemplateError)
    : "fetch_error";
}

function projectBase(target: ProjectTarget): string {
  if (typeof target === "string") return `/api/v1/projects/${encodeURIComponent(target)}`;
  return `/api/v1/servers/${target.serverId}/projects/${encodeURIComponent(target.diskId)}`;
}

/** UTF-8 text of a base64 file, as the editor shows it. */
function decodeBase64(content: string): string {
  const bytes = Uint8Array.from(atob(content), (c) => c.charCodeAt(0));
  return new TextDecoder().decode(bytes);
}

/** The template's files as shipped (its default version), by path. */
export async function fetchTemplateFiles(
  serverId: string,
  moduleId: string,
  templateId: string,
): Promise<{ ok: true; files: Record<string, string> } | { ok: false; error: TemplateError }> {
  try {
    const body = await apiFetch<{ files?: { path: string; content_base64: string }[] }>(
      `/api/v1/servers/${serverId}/modules/${encodeURIComponent(moduleId)}/templates/${encodeURIComponent(templateId)}`,
    );
    const files: Record<string, string> = {};
    for (const file of body.files ?? []) files[file.path] = decodeBase64(file.content_base64);
    return { ok: true, files };
  } catch (error) {
    return { ok: false, error: errorOf(error) };
  }
}

/** Where the Project's files copied from templates came from, by path. */
export async function fetchProjectOrigins(
  target: ProjectTarget,
): Promise<
  { ok: true; origins: Record<string, FileOrigin> } | { ok: false; error: TemplateError }
> {
  try {
    const body = await apiFetch<{ origins?: Record<string, FileOrigin> }>(
      `${projectBase(target)}/origins`,
    );
    return { ok: true, origins: body.origins ?? {} };
  } catch (error) {
    return { ok: false, error: errorOf(error) };
  }
}

export type TemplateCopyResult =
  | { ok: true; written: string[]; unchanged: string[] }
  /** Files holding other content: nothing was written. */
  | { ok: false; error: "conflict"; conflicts: string[] }
  | { ok: false; error: Exclude<TemplateError, "conflict"> };

/**
 * Copies a template (or `paths` of it) into the Project. Never overwrites a file holding
 * other content unless `replace`: the answer then lists those files.
 */
export async function copyTemplate(
  target: ProjectTarget,
  request: { module: string; template: string; paths?: string[]; replace?: boolean },
): Promise<TemplateCopyResult> {
  try {
    const body = await apiFetch<{ written?: string[]; unchanged?: string[] }>(
      `${projectBase(target)}/templates`,
      { method: "POST", json: { ...request, replace: request.replace ?? false } },
    );
    return { ok: true, written: body.written ?? [], unchanged: body.unchanged ?? [] };
  } catch (error) {
    const failure = ApiError.from(error);
    if (failure.code === "conflict") {
      const conflicts = failure.body?.conflicts;
      return {
        ok: false,
        error: "conflict",
        conflicts: Array.isArray(conflicts)
          ? conflicts.filter((p): p is string => typeof p === "string")
          : [],
      };
    }
    return { ok: false, error: errorOf(error) as Exclude<TemplateError, "conflict"> };
  }
}
