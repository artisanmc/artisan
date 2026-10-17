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
  BoardItem,
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
export {
  SDK_VERSION,
  parseSdkVersion,
  sdkCompatibility,
  type SdkCompatibility,
} from "./version";
export {
  type EditorHost,
  type TextWrite,
  type ActionChainWire,
  type ActionChainEditorProps,
  type MaterialInputProps,
  type ItemInputProps,
  type ItemSpecWire,
  type ItemComparisonWire,
  type MiniMessageInputProps,
  type HostComponents,
  ActionChainEditor,
  MaterialInput,
  ItemInput,
  MiniMessageInput,
  installEditorHost,
  useProject,
  useContentLang,
  useUiLang,
  updateDocument,
  newTextKey,
  textValue,
  fieldText,
  projectLangs,
  selectDocumentItem,
  notify,
} from "./host/host";
export { createModuleI18n } from "./host/i18n";
export { injectModuleStyles } from "./host/styles";
export { cn } from "./lib/cx";
