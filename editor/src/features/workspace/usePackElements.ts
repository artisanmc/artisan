// Pure selectors for the workspace panel. File is named `usePackElements`
// to anchor a future React-hook wrapper; for now only the pure
// `buildPackElements` is needed (WorkspacePanel calls it directly).
import type { Pack } from "@/domain/types";
import { getFirstTitleText } from "@/domain/menuTitle";
import { getText } from "@/lib/i18n";

export type ElementType = "menu" | "command" | "dialog";
export interface PackElementItem { id: string; label: string; type: ElementType; onBoard: boolean; }
export interface PackElementGroup { type: ElementType; items: PackElementItem[]; }

/** Human-readable label for any element id in the pack (menu/command/dialog), fallback to the id. */
export function elementLabel(pack: Pack, id: string, activeLang: string): string {
  const menu = pack.menus?.find((m) => m.id === id);
  if (menu) { const lt = getFirstTitleText(menu); return (lt ? getText(pack, lt, activeLang) : "") || id; }
  const command = pack.commands?.find((c) => c.id === id);
  if (command) return `/${command.name}`;
  const dialog = pack.dialogs?.find((d) => d.id === id);
  if (dialog) return getText(pack, dialog.title, activeLang) || id;
  return id;
}

/** Pure: construit la liste catégorisée des éléments du pack (source de vérité du panneau). */
export function buildPackElements(pack: Pack, activeLang: string): PackElementGroup[] {
  const onBoard = (id: string) => id in pack.canvasLayout;
  const menus: PackElementItem[] = (pack.menus ?? []).map((m) => ({
    id: m.id, label: elementLabel(pack, m.id, activeLang), type: "menu", onBoard: onBoard(m.id),
  }));
  const commands: PackElementItem[] = (pack.commands ?? []).map((c) => ({
    id: c.id, label: elementLabel(pack, c.id, activeLang), type: "command", onBoard: onBoard(c.id),
  }));
  const dialogs: PackElementItem[] = (pack.dialogs ?? []).map((d) => ({
    id: d.id, label: elementLabel(pack, d.id, activeLang), type: "dialog", onBoard: onBoard(d.id),
  }));
  return [
    { type: "menu", items: menus },
    { type: "command", items: commands },
    { type: "dialog", items: dialogs },
  ];
}
