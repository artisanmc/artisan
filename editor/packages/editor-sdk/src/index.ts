/**
 * `@artisan/editor-sdk` — the public surface a frontend module compiles
 * against. Modules import ONLY from this entrypoint.
 *
 * Test-only helpers (clearRegistry, clearModuleBus) are deliberately NOT
 * re-exported here.
 */
export type {
  FrontendModule,
  ModuleSidebarEntry,
  ModuleRouteDecl,
  DocumentKindContribution,
  DocumentEditorProps,
  DocumentPreviewProps,
  DocumentLabelContext,
  DocumentParseContext,
  DocumentParseResult,
  LTextSiteContribution,
  ChainSlotContribution,
} from "./contract/types";
export {
  registerModule,
  listModules,
  getModule,
  collectModuleExportFiles,
  listDocumentKindContributions,
  documentKindContribution,
} from "./contract/registry";
export type { ModuleEvent } from "./contract/eventBus";
export { onModuleEvent, emitModuleEvent } from "./contract/eventBus";
export { Button, buttonVariants, type ButtonProps } from "./ui/button";
export { cn } from "./lib/cx";
