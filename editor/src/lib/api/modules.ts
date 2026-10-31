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
  /**
   * The icon and logo the module's jar carries (`ModuleBrandDeclaration`, protocol 1.5): the
   * files it has, their hash, and the logo's pixel grid. Served at `…/modules/:id/brand/:file.svg`.
   */
  brand?: ModuleBrandWire;
}

export type ModuleBrandFile =
  | "icon"
  | "logo-dark"
  | "logo-light"
  | "wordmark-dark"
  | "wordmark-light";

export interface ModuleBrandWire {
  hash: string;
  files: ModuleBrandFile[];
  logo?: { width: number; height: number };
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
