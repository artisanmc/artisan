const API_URL = import.meta.env.VITE_API_URL ?? "http://localhost:3001";

export interface ServerDataSource {
  ref: string;
  schemaHint: string | null;
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
    const data = (await res.json()) as { data_sources?: { ref: string; schema_hint?: string | null }[] };
    return (data.data_sources ?? []).map((d) => ({ ref: d.ref, schemaHint: d.schema_hint ?? null }));
  } catch {
    return [];
  }
}
