/**
 * `@artisan/editor-sdk` — the public surface a frontend module compiles
 * against. Modules import ONLY from this entrypoint, never from deep editor
 * paths (`@/modules/api/...`, `@/components/...`).
 *
 * M1 scope: module-system contract only, re-exported from the in-repo
 * implementation. No physical npm package / publish yet (cf. spec §6.3, §10).
 * Shared UI primitives (SchemaForm, MiniMessageInline, RevealField, placeholder
 * catalog) join this barrel when the first module UI consumes them (M2).
 *
 * Test-only helpers (`clearRegistry`, `clearModuleBus`) are deliberately NOT
 * re-exported — they are implementation details of the in-repo tests.
 */
export type { FrontendModule, ModuleSidebarEntry, ModuleRouteDecl } from "@/modules/api/types";
export { registerModule, listModules, getModule } from "@/modules/api/registry";
export type { ModuleEvent } from "@/modules/api/eventBus";
export { onModuleEvent, emitModuleEvent } from "@/modules/api/eventBus";
