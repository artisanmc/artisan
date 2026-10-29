import { ApiError, apiFetch } from "./client";

export interface DataSourceSchemaField {
  name: string;
  type: string;
  description: string | null;
}

export interface ServerDataSource {
  ref: string;
  moduleId: string | null;
  schema: DataSourceSchemaField[];
  schemaHint: string | null;
  /** "static" = placeable (stable key-set); "dynamic" = pagination-only. null/absent = legacy. */
  stability?: "static" | "dynamic" | null;
  /** Row key field name for a static source (null/absent unless static). */
  keyField?: string | null;
  /**
   * Where the rows come from (API 2.19.0): server state, Project content, or
   * content joined to per-player state. null/absent = an older plugin, read as runtime.
   */
  origin?: DataSourceOrigin | null;
}

export type DataSourceOrigin = "runtime" | "content" | "mixed";

/**
 * Data sources reported by the connected server. `serverId` is the exact
 * server id (not a slug). [] on any failure (refused, network error, or
 * malformed JSON).
 */
export async function fetchServerDataSourcesUser(serverId: string): Promise<ServerDataSource[]> {
  try {
    const data = await apiFetch<{
      data_sources?: {
        ref: string;
        module_id?: string | null;
        schema?: { name: string; type: string; description?: string | null }[];
        schema_hint?: string | null;
        stability?: "static" | "dynamic" | null;
        key_field?: string | null;
        origin?: string | null;
      }[];
    }>(`/api/v1/servers/${serverId}/data-sources`);
    return (data.data_sources ?? []).map((d) => ({
      ref: d.ref,
      moduleId: d.module_id ?? null,
      schema: (d.schema ?? []).map((f) => ({
        name: f.name,
        type: f.type,
        description: f.description ?? null,
      })),
      schemaHint: d.schema_hint ?? null,
      stability: d.stability ?? null,
      keyField: d.key_field ?? null,
      origin: parseOrigin(d.origin),
    }));
  } catch {
    return [];
  }
}

/** A value this editor does not know (a newer plugin) is treated like an absent one. */
function parseOrigin(raw: string | null | undefined): DataSourceOrigin | null {
  return raw === "runtime" || raw === "content" || raw === "mixed" ? raw : null;
}

export type PreviewErrorCode =
  | "server_offline"
  | "fetch_timeout"
  | "unknown_source"
  | "player_required"
  | "fetch_error"
  | "network_error";

export type PreviewResult =
  | { ok: true; rows: Record<string, unknown>[]; truncated: boolean }
  | { ok: false; error: PreviewErrorCode; message: string | null };

export interface PreviewRequest {
  ref: string;
  params?: Record<string, string>;
  filter?: Record<string, string>;
  sort?: { by: string; direction?: "asc" | "desc" };
  limit?: number;
  args?: Record<string, string>;
}

const KNOWN_PREVIEW_ERRORS: PreviewErrorCode[] = [
  "server_offline",
  "fetch_timeout",
  "unknown_source",
  "player_required",
  "fetch_error",
];

/** Live preview relayed to the connected plugin (5 s hub timeout). */
export async function previewDataSource(
  serverId: string,
  req: PreviewRequest,
): Promise<PreviewResult> {
  try {
    const body = await apiFetch<{ rows?: Record<string, unknown>[]; truncated?: boolean }>(
      `/api/v1/servers/${serverId}/data-sources/preview`,
      { method: "POST", json: req },
    );
    return { ok: true, rows: body.rows ?? [], truncated: body.truncated ?? false };
  } catch (error) {
    const failure = ApiError.from(error);
    if (failure.status === 0) return { ok: false, error: "network_error", message: null };
    const known = KNOWN_PREVIEW_ERRORS.find((code) => code === failure.code);
    return { ok: false, error: known ?? "fetch_error", message: failure.detail ?? null };
  }
}

/**
 * Module-declared Data models reported at Presence (ADR composable-data-models
 * §4): model/v1 documents, verbatim. [] on any failure.
 */
export async function fetchServerDeclaredModels(
  serverId: string,
): Promise<Record<string, unknown>[]> {
  try {
    const data = await apiFetch<{ models?: Record<string, unknown>[] }>(
      `/api/v1/servers/${serverId}/models`,
    );
    return data.models ?? [];
  } catch {
    return [];
  }
}
