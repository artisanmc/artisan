import { apiFetch } from "./client";
import type { TemplateInfo } from "./templates";

export interface ActiveModule {
  id: string;
  version: string | null;
  /** The editor view the module's jar carries (ADR `runtime-editor-modules`), when it has one. */
  /** `local`: read from a file on the server's disk (`dev.editor-bundles`), not from the jar. */
  editor_bundle?: { sdk: string; hash: string; size?: number; local?: boolean };
  /** The example content the module offers to copy into a Project (protocol 1.3). */
  templates?: TemplateInfo[];
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

/** A plugin of the suite as its server announces it (`suite_plugins`, protocol 1.5). */
export interface SuitePlugin {
  name: string;
  version: string;
  /** The jar's file name, what an update replaces; absent when unknown. */
  file?: string;
  enabled: boolean;
  /** The plugins it depends on, hard and soft, by name. */
  depends: string[];
}

/**
 * Artisan and the plugins that depend on it, directly or not, on a server.
 * [] when the server is older than protocol 1.5 or unreachable.
 */
export async function fetchSuitePlugins(serverId: string): Promise<SuitePlugin[]> {
  try {
    const data = await apiFetch<{ plugins?: SuitePlugin[] }>(`/api/v1/servers/${serverId}/plugins`);
    return data.plugins ?? [];
  } catch {
    return [];
  }
}
