import type { TFunction } from "i18next";
import {
  Ban,
  ChevronsLeft,
  ChevronsRight,
  Coins,
  Eraser,
  GitBranch,
  Heading,
  LayoutGrid,
  type LucideIcon,
  MapPin,
  Megaphone,
  MessageSquare,
  MessagesSquare,
  MousePointerClick,
  PackageMinus,
  PackagePlus,
  PenLine,
  Plus,
  Puzzle,
  Repeat,
  Sparkles,
  SquareTerminal,
  SquareX,
  TrendingUp,
  Undo2,
  Variable,
  Volume2,
  Zap,
} from "lucide-react";

/**
 * What an action does, as the step chain shows it: each family has a colour token
 * (`--fam-<family>` and `--fam-<family>-soft` in globals.css) and each core action an icon.
 * Seven families at most, so colour keeps meaning something.
 */
export type ActionFamily =
  | "logic"
  | "message"
  | "effect"
  | "navigation"
  | "reward"
  | "world"
  | "module";

export const ACTION_FAMILIES: ActionFamily[] = [
  "logic",
  "message",
  "effect",
  "navigation",
  "reward",
  "world",
  "module",
];

const CORE: Record<string, { family: ActionFamily; icon: LucideIcon }> = {
  send_message: { family: "message", icon: MessageSquare },
  broadcast: { family: "message", icon: Megaphone },
  show_title: { family: "message", icon: Heading },
  play_sound: { family: "effect", icon: Volume2 },
  open_menu: { family: "navigation", icon: LayoutGrid },
  close_menu: { family: "navigation", icon: SquareX },
  open_previous_menu: { family: "navigation", icon: Undo2 },
  pagination_next: { family: "navigation", icon: ChevronsRight },
  pagination_prev: { family: "navigation", icon: ChevronsLeft },
  open_dialog: { family: "navigation", icon: MessagesSquare },
  close_dialog: { family: "navigation", icon: SquareX },
  give_item: { family: "reward", icon: PackagePlus },
  take_item: { family: "reward", icon: PackageMinus },
  give_money: { family: "reward", icon: Coins },
  take_money: { family: "reward", icon: Coins },
  give_xp: { family: "reward", icon: Sparkles },
  give_level: { family: "reward", icon: TrendingUp },
  teleport: { family: "world", icon: MapPin },
  run_command: { family: "world", icon: SquareTerminal },
  set_arg: { family: "logic", icon: Variable },
  set_arg_cycle_next: { family: "logic", icon: Repeat },
  set_arg_cycle_prev: { family: "logic", icon: Repeat },
  run_actions: { family: "logic", icon: Zap },
  set_var: { family: "logic", icon: Variable },
  add_var: { family: "logic", icon: Plus },
  clear_var: { family: "logic", icon: Eraser },
  chat_button: { family: "message", icon: MousePointerClick },
  // The triggers module's two actions: they change the running Game event (eventActions.ts).
  cancel_event: { family: "effect", icon: Ban },
  set_event: { family: "effect", icon: PenLine },
};

/** The icon of an `if` / `else` step. */
export const BRANCH_ICON = GitBranch;

/** Family and icon of an action by its wire name; a module action (`quests:start`) or an unknown one is `module`. */
export function actionAppearance(name: string): { family: ActionFamily; icon: LucideIcon } {
  return CORE[name] ?? { family: "module", icon: Puzzle };
}

/** Whether the action is one of Artisan's own, with a translated name under `actionCatalog.names`. */
export function isCoreAction(name: string): boolean {
  return name in CORE;
}

/** An action's name as a row shows it: the catalog's for a core action, else its own (without its module). */
export function actionLabel(name: string, t: TFunction): string {
  const colon = name.indexOf(":");
  if (isCoreAction(name)) return t(`actionCatalog.names.${name}`);
  return colon > 0 ? name.slice(colon + 1) : name;
}

/** CSS colour and soft background of a family, as `var(--token)` references. */
export function familyColors(family: ActionFamily): { fg: string; soft: string } {
  return { fg: `var(--fam-${family})`, soft: `var(--fam-${family}-soft)` };
}
