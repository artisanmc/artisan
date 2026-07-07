const API_URL = import.meta.env.VITE_API_URL ?? "http://localhost:3001";

export interface ServerDataSource {
  ref: string;
  schemaHint: string | null;
}

/** Data sources reported by the connected server. [] on any non-OK response. */
export async function fetchServerDataSources(accessToken: string): Promise<ServerDataSource[]> {
  const res = await fetch(`${API_URL}/api/v1/editor-session/${accessToken}/data-sources`);
  if (!res.ok) return [];
  const data = (await res.json()) as { data_sources?: { ref: string; schema_hint?: string | null }[] };
  return (data.data_sources ?? []).map((d) => ({ ref: d.ref, schemaHint: d.schema_hint ?? null }));
}
