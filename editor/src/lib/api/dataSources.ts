const API_URL = import.meta.env.VITE_API_URL ?? "http://localhost:3001";

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
}

/**
 * Data sources reported by the connected server for a network/server pair.
 * Cookie auth, `serverId` is the exact server_key id (not a slug). [] on any
 * failure (non-OK response, network error, or malformed JSON).
 */
export async function fetchServerDataSourcesUser(
  networkId: string,
  serverId: string,
): Promise<ServerDataSource[]> {
  try {
    const res = await fetch(
      `${API_URL}/api/v1/networks/${networkId}/servers/${serverId}/data-sources`,
      { credentials: "include" },
    );
    if (!res.ok) return [];
    const data = (await res.json()) as {
      data_sources?: {
        ref: string;
        module_id?: string | null;
        schema?: { name: string; type: string; description?: string | null }[];
        schema_hint?: string | null;
        stability?: "static" | "dynamic" | null;
        key_field?: string | null;
      }[];
    };
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
    }));
  } catch {
    return [];
  }
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

/** Live preview relayed to the connected plugin (5 s backend timeout). */
export async function previewDataSource(
  networkId: string,
  serverId: string,
  req: PreviewRequest,
): Promise<PreviewResult> {
  try {
    const res = await fetch(
      `${API_URL}/api/v1/networks/${networkId}/servers/${serverId}/data-sources/preview`,
      {
        method: "POST",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(req),
      },
    );
    const body = (await res.json().catch(() => null)) as {
      rows?: Record<string, unknown>[];
      truncated?: boolean;
      error?: string;
      message?: string | null;
    } | null;
    if (res.ok) return { ok: true, rows: body?.rows ?? [], truncated: body?.truncated ?? false };
    const known: PreviewErrorCode[] = [
      "server_offline",
      "fetch_timeout",
      "unknown_source",
      "player_required",
      "fetch_error",
    ];
    const error = known.includes(body?.error as PreviewErrorCode)
      ? (body?.error as PreviewErrorCode)
      : "fetch_error";
    return { ok: false, error, message: body?.message ?? null };
  } catch {
    return { ok: false, error: "network_error", message: null };
  }
}
