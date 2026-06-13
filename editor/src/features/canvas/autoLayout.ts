import type { Pack } from "@/domain/types";

/**
 * Board layout = appartenance. Ne retourne que les positions EXPLICITES de
 * pack.canvasLayout. Un élément absent de canvasLayout n'est pas sur la planche.
 * (Le grid-fill historique vit désormais dans gridArrange, appelé à la demande.)
 */
export function autoLayout(pack: Pack): Record<string, { x: number; y: number }> {
  return { ...pack.canvasLayout };
}

/** Grille déterministe sur TOUS les éléments — pour le bouton « Tout arranger ». */
export function gridArrange(pack: Pack): Record<string, { x: number; y: number }> {
  const layout: Record<string, { x: number; y: number }> = {};
  const cellW = 220;
  const cellH = 160;
  const cols = 4;
  const ids = [
    ...(pack.menus ?? []).map((m) => m.id),
    ...(pack.commands ?? []).map((c) => c.id),
    ...(pack.dialogs ?? []).map((d) => d.id),
  ];
  let i = 0;
  for (const id of ids) {
    layout[id] = { x: (i % cols) * cellW + 40, y: Math.floor(i / cols) * cellH + 40 };
    i++;
  }
  return layout;
}
