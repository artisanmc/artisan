import type { Hono } from "hono";

/**
 * Backend-side contract for an Interfaze module.
 *
 * Each module mounts its REST routes under /api/modules/{id}/* and may declare
 * data sources and commands that map to the plugin-side registries via WS.
 */
export interface BackendModule {
  /** Module id, lowercase. Must match the plugin-side InterfazeModule.id. */
  id: string;

  /** Schema version this module currently emits / accepts. */
  schemaVersion: string;

  /**
   * Mount the module's REST routes onto the given Hono app.
   * Implementations should call `app.route("/api/modules/{id}/...", subrouter)`
   * (or use the helper `mountSubrouter` in moduleRegistry).
   */
  registerRoutes(app: Hono): void;

  /** Drizzle table refs this module owns (used by tooling, not yet enforced). */
  tables?: unknown[];

  /** Data sources declared by this module (relayed to the plugin via WS). */
  dataSources?: DataSourceDeclaration[];

  /** Commands declared by this module (relayed to the plugin via WS). */
  commands?: CommandDeclaration[];
}

export interface DataSourceDeclaration {
  ref: string;          // "shop:items"
  schemaHint?: string;  // documentation only
}

export interface CommandDeclaration {
  name: string;         // "shop:buy"
  schemaHint?: string;
}
