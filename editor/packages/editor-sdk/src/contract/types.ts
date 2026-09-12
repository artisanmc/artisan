import type { ComponentType, ReactNode } from "react";

export interface ModuleSidebarEntry {
  icon: ComponentType<{ className?: string }> | (() => ReactNode);
  label: string;
  to: string;
}

export interface ModuleRouteDecl {
  path: string;
  component: ComponentType;
}

export interface FrontendModule {
  id: string;
  displayName: string;
  schemaVersion: string;
  sidebar: ModuleSidebarEntry;
  routes: ModuleRouteDecl[];
  wsMessageTypes?: string[];
  onMount?: () => void;
  onUnmount?: () => void;
  /**
   * Files this module contributes to the project bundle on export, keyed by
   * project-relative path. Keys MUST live under "<moduleId>/" (enforced by
   * collectModuleExportFiles); out-of-namespace keys are dropped.
   */
  exportFiles?: (project: unknown) => Record<string, string>;
  /**
   * Authoring-time rows for one of this module's data sources, computed from
   * the module's own project state (moduleData) — so canvas/library tiles
   * update LIVE while editing the module's form, before any deploy. Return
   * null when the ref isn't this module's or the project holds no data for it
   * (the host then falls back to the live server snapshot). Must mirror the
   * plugin fetcher's row shape. The host resolves localized values in the
   * project's dataSources before calling this hook, using the preview language.
   */
  localPreviewRows?: (project: unknown, ref: string) => Record<string, unknown>[] | null;
  /** Source ref → declared row model, available independently of server presence. */
  dataSourceModels?: Record<string, string>;
}
