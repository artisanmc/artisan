import type { Project } from "@/domain/types";
import type { ReactNode } from "react";

/** A menu drawn as the game does, open on its own screen (the Play engine's picture of it). */
export type MenuPreviewRenderer = (props: {
  serverId: string;
  projects: readonly Project[];
  projectId: string;
  menuId: string;
  frame?: { width: number; height: number };
}) => ReactNode;

let renderer: MenuPreviewRenderer | null = null;

/**
 * The host gives the Play feature's menu picture once, at startup: the catalogue (a feature of
 * its own) draws menus without importing the Play feature. Until then, or in a test, a menu
 * shows its tile.
 */
export function registerMenuPreview(next: MenuPreviewRenderer): void {
  renderer = next;
}

export function menuPreviewRenderer(): MenuPreviewRenderer | null {
  return renderer;
}
