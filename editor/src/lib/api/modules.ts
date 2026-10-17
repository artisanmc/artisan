import { apiFetch } from "./client";

export interface ActiveModule {
  id: string;
  version: string | null;
  /** The editor view the module's jar carries (ADR `runtime-editor-modules`), when it has one. */
  /** `local`: read from a file on the server's disk (`dev.editor-bundles`), not from the jar. */
  editor_bundle?: { sdk: string; hash: string; size?: number; local?: boolean };
}

/**
 * Active modules of a server (presence activation), populated at each plugin
 * `hello`. `serverId` is the exact server id (not a slug). [] on any failure
 * (treat "no presence info" as "no modules").
 */
export async function fetchActiveModulesUser(serverId: string): Promise<ActiveModule[]> {
  try {
    const data = await apiFetch<{ modules?: ActiveModule[] }>(
      `/api/v1/servers/${serverId}/modules`,
    );
    return data.modules ?? [];
  } catch {
    return [];
  }
}
