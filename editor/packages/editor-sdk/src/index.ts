/**
 * `@artisan/editor-sdk` — the public surface a frontend module compiles
 * against. Modules import ONLY from this entrypoint.
 *
 * P1b scope: module-system contract + ONE base component (Button) + cn, as a
 * real workspace package. Fattening with the full design system / SchemaForm
 * is P2 (cf. docs/superpowers/specs/2026-06-17-first-party-module-extensibility-design.md).
 *
 * Test-only helpers (clearRegistry, clearModuleBus) are deliberately NOT
 * re-exported here.
 */
export type { FrontendModule, ModuleSidebarEntry, ModuleRouteDecl } from "./contract/types";
export { registerModule, listModules, getModule, collectModuleExportFiles } from "./contract/registry";
export type { ModuleEvent } from "./contract/eventBus";
export { onModuleEvent, emitModuleEvent } from "./contract/eventBus";
export { Button, buttonVariants, type ButtonProps } from "./ui/button";
export { cn } from "./lib/cx";
