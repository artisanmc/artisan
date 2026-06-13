import type { Pack } from "@/domain/types";
import { getFirstTitleText } from "@/domain/menuTitle";
import { getText } from "@/lib/i18n";

export type ElementType = "menu" | "command" | "dialog";
export interface PackElementItem { id: string; label: string; type: ElementType; onBoard: boolean; }
export interface PackElementGroup { type: ElementType; items: PackElementItem[]; }

/** Pure: construit la liste catégorisée des éléments du pack (source de vérité du panneau). */
export function buildPackElements(pack: Pack, activeLang: string): PackElementGroup[] {
  const onBoard = (id: string) => id in pack.canvasLayout;
  const menus: PackElementItem[] = (pack.menus ?? []).map((m) => {
    const lt = getFirstTitleText(m);
    return { id: m.id, label: (lt ? getText(pack, lt, activeLang) : "") || m.id, type: "menu", onBoard: onBoard(m.id) };
  });
  const commands: PackElementItem[] = (pack.commands ?? []).map((c) => ({
    id: c.id, label: `/${c.name}`, type: "command", onBoard: onBoard(c.id),
  }));
  const dialogs: PackElementItem[] = (pack.dialogs ?? []).map((d) => ({
    id: d.id, label: d.id, type: "dialog", onBoard: onBoard(d.id),
  }));
  return [
    { type: "menu", items: menus },
    { type: "command", items: commands },
    { type: "dialog", items: dialogs },
  ];
}
