import { apiFetch } from "./client";

/**
 * A Document kind registered on a server (ADR `extensible-document-kinds`, W6): Artisan's
 * own (`module_id` absent) or a module's. Wire verbatim from `document_kinds` at Presence.
 * The editor compares it with the kinds its own modules contribute: a kind the active
 * server does not list is written to a folder nothing on that server reads.
 */
export interface ServerDocumentKind {
  kind: string;
  dir: string;
  /** The `schema:` labels the server reads for this kind; the first one is canonical. */
  schemaVersions: string[];
  idPrefix: string | null;
  moduleId: string | null;
}

/** Document kinds of a server. [] on any failure. */
export async function fetchServerDocumentKinds(serverId: string): Promise<ServerDocumentKind[]> {
  try {
    const data = await apiFetch<{
      document_kinds?: {
        kind?: string;
        dir?: string;
        schema_versions?: string[];
        id_prefix?: string | null;
        module_id?: string | null;
      }[];
    }>(`/api/v1/servers/${serverId}/document-kinds`);
    return (data.document_kinds ?? [])
      .filter((k) => typeof k.kind === "string" && k.kind.length > 0)
      .map((k) => ({
        kind: k.kind as string,
        dir: typeof k.dir === "string" ? k.dir : "",
        schemaVersions: Array.isArray(k.schema_versions) ? k.schema_versions : [],
        idPrefix: k.id_prefix ?? null,
        moduleId: k.module_id ?? null,
      }));
  } catch {
    return [];
  }
}
