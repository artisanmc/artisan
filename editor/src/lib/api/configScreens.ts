import { ApiError, apiFetch } from "./client";

/** A module-declared Config screen (ADR module-config-screens), wire verbatim. */
export interface ServerEditorScreen {
  id: string;
  moduleId: string | null;
  label: string;
  table: string;
  projectId: string;
  /** Key of the module's own view (`FrontendModule.screens`); absent = generated form. */
  component?: string;
}

/** Declared Config screens of a server. [] on any failure. */
export async function fetchServerEditorScreens(serverId: string): Promise<ServerEditorScreen[]> {
  try {
    const data = await apiFetch<{
      screens?: {
        id: string;
        module_id?: string | null;
        label?: string;
        table?: string;
        project_id?: string;
        component?: string | null;
      }[];
    }>(`/api/v1/servers/${serverId}/screens`);
    return (data.screens ?? [])
      .filter((s) => s.id && s.label && s.table && s.project_id)
      .map((s) => ({
        id: s.id,
        moduleId: s.module_id ?? null,
        label: s.label as string,
        table: s.table as string,
        projectId: s.project_id as string,
        ...(s.component ? { component: s.component } : {}),
      }));
  } catch {
    return [];
  }
}

export type ConfigErrorCode =
  | "server_offline"
  | "fetch_timeout"
  | "invalid_path"
  | "unknown_project"
  | "too_large"
  | "read_error"
  | "write_error"
  | "network_error";

export interface ConfigFile {
  path: string;
  content: string;
}

export type ConfigReadResult =
  | { ok: true; files: ConfigFile[] }
  | { ok: false; error: ConfigErrorCode; message: string | null };

/** Live read of a Config-screen table's files from the plugin's disk (WS relay). */
export async function configRead(
  serverId: string,
  req: { projectId: string; table: string },
): Promise<ConfigReadResult> {
  try {
    const body = await apiFetch<{ files?: ConfigFile[] }>(
      `/api/v1/servers/${serverId}/config/read`,
      {
        method: "POST",
        json: { project_id: req.projectId, table: req.table },
      },
    );
    return { ok: true, files: body.files ?? [] };
  } catch (error) {
    return refused(error, "read_error");
  }
}

export type ConfigWriteResult =
  | { ok: true }
  | { ok: false; error: ConfigErrorCode; message: string | null };

/** Live write of Config-screen files to the plugin's disk (it hot-reloads + auto-pushes). */
export async function configWrite(
  serverId: string,
  req: { projectId: string; files: ConfigFile[]; deletes?: string[] },
): Promise<ConfigWriteResult> {
  try {
    await apiFetch(`/api/v1/servers/${serverId}/config/write`, {
      method: "POST",
      json: { project_id: req.projectId, files: req.files, deletes: req.deletes ?? [] },
    });
    return { ok: true };
  } catch (error) {
    return refused(error, "write_error");
  }
}

const KNOWN_ERRORS: ConfigErrorCode[] = [
  "server_offline",
  "fetch_timeout",
  "invalid_path",
  "unknown_project",
  "too_large",
  "read_error",
  "write_error",
];

function refused(
  error: unknown,
  fallback: ConfigErrorCode,
): { ok: false; error: ConfigErrorCode; message: string | null } {
  const failure = ApiError.from(error);
  if (failure.status === 0) return { ok: false, error: "network_error", message: null };
  const known = KNOWN_ERRORS.find((code) => code === failure.code);
  return { ok: false, error: known ?? fallback, message: failure.detail ?? null };
}
