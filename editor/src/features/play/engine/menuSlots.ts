import { resolveDisplayRef } from "@/domain/capturedItems";
import { formatEnchant } from "@/domain/itemAdvanced";
import type { Appearance, ClickType, Element, Menu, Project } from "@/domain/types";
import { humanizeMaterial } from "@/features/canvas/ItemTooltip";
import { previewItem } from "@/features/canvas/itemValuePreview";
import { paginationContext } from "@/features/canvas/menuSlots";
import { matchPlacementRow } from "@/features/canvas/placement";
import { lookupPath } from "@/lib/placeholders";
import { parsePositions } from "@/lib/positions";
import { type ConditionEnv, caseMatches } from "./conditions";

/** A slot of the open menu, resolved as the player sees it. */
export interface PlaySlot {
  position: number;
  element: Element;
  /** The appearance shown: the first state whose `if` passes, else `display`. */
  appearance: Appearance;
  /** The slot's scope: the menu's, plus the row an iterating or placing element binds. */
  scope: Record<string, unknown>;
  material?: string;
  head?: string;
  count?: number;
  enchanted?: boolean;
  /** For the tooltip. */
  title: string;
  /** True when the title is the material's name (white, as the game shows it). */
  materialTitle: boolean;
  lore: string[];
  enchants: string[];
}

/**
 * The open menu's slots for the test player: each element's state chosen by its conditions,
 * iterating elements bound to the rows of the current page, placed rows on their slots.
 * Later layers win a shared slot, as on the canvas.
 */
export function playMenuSlots(opts: {
  menu: Menu;
  project: Project;
  scope: Record<string, unknown>;
  pages: Record<string, number>;
  lang: string;
  env: (scope: Record<string, unknown>) => ConditionEnv;
  render: (template: string, scope: Record<string, unknown>) => string;
}): Map<number, PlaySlot> {
  const { menu, project, pages, lang } = opts;
  const scope = { ...opts.scope, pagination: paginationContext(menu, opts.scope, pages) };
  const slots = new Map<number, PlaySlot>();
  const place = (element: Element, position: number, slotScope: Record<string, unknown>) => {
    const env = opts.env(slotScope);
    const appearance =
      element.states.find((s) => caseMatches(s.if, s.ifJoins, env)) ?? element.display;
    if (!appearance || appearance.image) return;
    const item = previewItem(appearance, slotScope, project, lang);
    const display = item.material ? resolveDisplayRef(project, item.material) : { material: "" };
    const materialTitle = !item.title;
    slots.set(position, {
      position,
      element,
      appearance,
      scope: slotScope,
      material: display.material || undefined,
      head: appearance.head ?? display.head,
      count: item.count ?? appearance.count,
      enchanted:
        appearance.enchanted === true || (item.enchants?.length ?? 0) > 0 || display.enchanted,
      title: materialTitle
        ? humanizeMaterial(display.material ?? "")
        : opts.render(item.title ?? "", slotScope),
      materialTitle,
      lore: item.lore,
      enchants: (item.enchants ?? []).map(formatEnchant),
    });
  };

  for (const layer of menu.layers) {
    for (const element of layer.elements) {
      if (element.iterates) {
        const positions = parsePositions(element.positions);
        const list = lookupPath(scope, element.iterates.source);
        const rows = Array.isArray(list) ? list : [];
        const per = Math.max(1, positions.length);
        const totalPages = Math.max(1, Math.ceil(rows.length / per));
        const page = Math.min(pages[element.id] ?? 0, totalPages - 1);
        positions.forEach((position, k) => {
          const row = rows[page * per + k];
          if (row !== undefined)
            place(element, position, { ...scope, [element.iterates!.alias]: row });
        });
        continue;
      }
      if (element.places) {
        const { places } = element;
        const rows = lookupPath(scope, places.source);
        const page = pages[element.id] ?? 0;
        for (const placement of places.placements) {
          if (placement.page !== page) continue;
          const row = matchPlacementRow(rows, places.keyField, placement.key);
          if (row) place(element, placement.position, { ...scope, [places.alias]: row });
        }
        continue;
      }
      for (const position of parsePositions(element.positions)) place(element, position, scope);
    }
  }
  return slots;
}

/** The click types a mouse gives: left, shift-left, right, shift-right, middle. */
export function clickTypeOf(button: number, shift: boolean): ClickType {
  if (button === 1) return "middle";
  if (button === 2) return shift ? "shift_right" : "right";
  return shift ? "shift_left" : "left";
}

/** The chain a click type runs; none when the slot does not handle it (the plugin has no fallback). */
export const clickSteps = (appearance: Appearance, click: ClickType) =>
  appearance.click?.[click]?.steps ?? null;
