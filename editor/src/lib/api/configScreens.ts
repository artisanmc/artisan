const API_URL = import.meta.env.VITE_API_URL ?? "http://localhost:3001";

/** A module-declared Config screen (ADR module-config-screens), wire verbatim. */
export interface ServerEditorScreen {
  id: string;
  moduleId: string | null;
  label: string;
  table: string;
  projectId: string;
}

/** Declared Config screens of a server. [] on any failure. */
export async function fetchServerEditorScreens(
  networkId: string,
  serverId: string,
): Promise<ServerEditorScreen[]> {
  try {
    const res = await fetch(
      `${API_URL}/api/v1/networks/${networkId}/servers/${serverId}/screens`,
      { credentials: "include" },
    );
    if (!res.ok) return [];
    const data = (await res.json()) as {
      screens?: {
        id: string;
        module_id?: string | null;
        label?: string;
        table?: string;
        project_id?: string;
      }[];
    };
    return (data.screens ?? [])
      .filter((s) => s.id && s.label && s.table && s.project_id)
      .map((s) => ({
        id: s.id,
        moduleId: s.module_id ?? null,
        label: s.label as string,
        table: s.table as string,
        projectId: s.project_id as string,
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
  networkId: string,
  serverId: string,
  req: { projectId: string; table: string },
): Promise<ConfigReadResult> {
  try {
    const res = await fetch(
      `${API_URL}/api/v1/networks/${networkId}/servers/${serverId}/config/read`,
      {
        method: "POST",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ project_id: req.projectId, table: req.table }),
      },
    );
    const body = (await res.json().catch(() => null)) as {
      files?: ConfigFile[];
      error?: string;
      message?: string | null;
    } | null;
    if (res.ok) return { ok: true, files: body?.files ?? [] };
    return { ok: false, error: knownError(body?.error, "read_error"), message: body?.message ?? null };
  } catch {
    return { ok: false, error: "network_error", message: null };
  }
}

export type ConfigWriteResult =
  | { ok: true }
  | { ok: false; error: ConfigErrorCode; message: string | null };

/** Live write of Config-screen files to the plugin's disk (it hot-reloads + auto-pushes). */
export async function configWrite(
  networkId: string,
  serverId: string,
  req: { projectId: string; files: ConfigFile[]; deletes?: string[] },
): Promise<ConfigWriteResult> {
  try {
    const res = await fetch(
      `${API_URL}/api/v1/networks/${networkId}/servers/${serverId}/config/write`,
      {
        method: "POST",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          project_id: req.projectId,
          files: req.files,
          deletes: req.deletes ?? [],
        }),
      },
    );
    if (res.ok) return { ok: true };
    const body = (await res.json().catch(() => null)) as {
      error?: string;
      message?: string | null;
    } | null;
    return { ok: false, error: knownError(body?.error, "write_error"), message: body?.message ?? null };
  } catch {
    return { ok: false, error: "network_error", message: null };
  }
}

const KNOWN_ERRORS: ConfigErrorCode[] = [
  "server_offline", "fetch_timeout", "invalid_path", "unknown_project",
  "too_large", "read_error", "write_error",
];

function knownError(code: string | undefined, fallback: ConfigErrorCode): ConfigErrorCode {
  return KNOWN_ERRORS.includes(code as ConfigErrorCode) ? (code as ConfigErrorCode) : fallback;
}
