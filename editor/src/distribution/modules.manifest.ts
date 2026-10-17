import type { FrontendModule } from "@artisan/editor-sdk";

/**
 * Presence-gated EXTERNAL modules built into the editor. Core modules (menus, commands)
 * stay hard-registered in main.tsx; only entries here are lazy-loaded and gated on
 * presence. Each `load` resolves the module's default export. A module whose server
 * serves its own bundle gets that one instead (`modulesStore`, ADR
 * `runtime-editor-modules`): an entry here is the fallback for a plugin that serves none.
 */
export interface ModuleManifestEntry {
  id: string;
  load: () => Promise<FrontendModule>;
}

export const MODULE_MANIFEST: ModuleManifestEntry[] = [
  // ArtisanQuests reports itself as `msquests` at presence.
  { id: "msquests", load: () => import("@artisan/quests-editor").then((m) => m.default) },
  { id: "boutique", load: () => import("@artisan/boutique-editor").then((m) => m.default) },
];
