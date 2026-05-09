import type { Pack } from "@/domain/types";

/** Deterministic auto-layout: lays nodes out in a grid for any node missing a saved position. */
export function autoLayout(pack: Pack): Record<string, { x: number; y: number }> {
  const layout: Record<string, { x: number; y: number }> = { ...pack.canvasLayout };
  const cellW = 220;
  const cellH = 160;
  const cols = 4;
  const ids = [...(pack.menus ?? []).map((m) => m.id), ...(pack.commands ?? []).map((c) => c.id), ...(pack.dialogs ?? []).map((d) => d.id)];
  let i = 0;
  for (const id of ids) {
    if (layout[id]) continue;
    const x = (i % cols) * cellW + 40;
    const y = Math.floor(i / cols) * cellH + 40;
    layout[id] = { x, y };
    i++;
  }
  return layout;
}
