import type { FrontendModule } from "@artisan/editor-sdk";

/**
 * Presence-gated EXTERNAL modules. Core modules (menus, commands) stay
 * hard-registered in main.tsx; only entries here are lazy-loaded and gated on
 * presence. Each `load` resolves the module's default export.
 */
export interface ModuleManifestEntry {
  id: string;
  load: () => Promise<FrontendModule>;
}

export const MODULE_MANIFEST: ModuleManifestEntry[] = [
  { id: "quests", load: () => import("@artisan/quests-editor").then((m) => m.default) },
  { id: "boutique", load: () => import("@artisan/boutique-editor").then((m) => m.default) },
];
