/**
 * The workspace's primary views, ordered exactly as they appear in the topbar
 * segmented nav. The index is also the 1-based Minecraft-hotbar digit shortcut
 * (1 = Home, 2 = Canvas, 3 = Translations, …) — keep the order and the nav in sync.
 * `home` is the module's entry view and the default: it maps to `?tab=undefined`;
 * the canvas is `?tab=board`.
 */
export type WorkspaceViewTab = "home" | "board" | "translations" | "resources" | "history";

export const WORKSPACE_VIEW_TABS: WorkspaceViewTab[] = [
  "home",
  "board",
  "translations",
  "resources",
  "history",
];

/** `?tab=` of a view: the home is the default, so it clears the param. */
export function tabSearchValue(tab: WorkspaceViewTab): WorkspaceViewTab | undefined {
  return tab === "home" ? undefined : tab;
}

/**
 * The view a page shows. The home covers the module's root only: under a Document, a
 * collection, a screen or a data source (`childOpen`), no tab means the board behind
 * that page, as before the home existed.
 */
export function effectiveTab(
  tab: WorkspaceViewTab | undefined,
  childOpen: boolean,
): WorkspaceViewTab {
  const t = tab ?? "home";
  return t === "home" && childOpen ? "board" : t;
}

/** Home and board live at the module's root: from a child page they leave it. */
export const leavesChildPage = (tab: WorkspaceViewTab): boolean =>
  tab === "home" || tab === "board";
