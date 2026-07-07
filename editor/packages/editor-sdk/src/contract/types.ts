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
}
