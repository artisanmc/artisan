import type * as React from "react";
import type { StatsScope } from "./statsScope";

/** What the server holds that statistics may never have seen: the things nobody uses. */
export interface KnownContent {
  /** The names of the commands made in Artisan (`command` Documents). */
  commands: string[];
  /** Each menu as `core:menu_open` names it (`project:menu`), with its clickable elements. */
  menus: { ref: string; elements: string[] }[];
}

export interface StatsTabProps {
  scope: StatsScope;
  /** What the tab drills into (a command, a menu), kept in the URL. */
  focus: string | undefined;
  onFocus: (focus: string | undefined) => void;
  known: KnownContent;
}

/** A tab of the statistics space: Artisan's own, then one per module that declares one. */
export interface StatsTab {
  id: string;
  /** Already translated. */
  label: string;
  component: React.ComponentType<StatsTabProps>;
}
