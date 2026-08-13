/**
 * The workspace's primary views, ordered exactly as they appear in the topbar
 * segmented nav. The index is also the 1-based Minecraft-hotbar digit shortcut
 * (1 = Canvas, 2 = Translations, …) — keep the order and the nav in sync.
 * `overview` is the canvas (default view); it maps to `?tab=undefined`.
 */
export type WorkspaceViewTab =
  | "overview"
  | "translations"
  | "data-sources"
  | "assistant";

export const WORKSPACE_VIEW_TABS: WorkspaceViewTab[] = [
  "overview",
  "translations",
  "data-sources",
  "assistant",
];
