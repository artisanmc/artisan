import type { ElementId, Layer } from "@/domain/types";
import { parsePositions } from "@/lib/positions";

export interface SlotEntry {
  elementId: ElementId;
  position: number;
  material: string;
  count?: number;
  appearanceIndex: number;
}

/**
 * Pure positional fanout: for each non-iterating element in the given layers,
 * expand its position string into one SlotEntry per slot. Elements with no
 * material in the first appearance are skipped.
 *
 * Elements that use `iterates` are intentionally excluded — their expansion
 * depends on live data-source state (store reads, placeholder resolution) and
 * must remain in the component that owns those hooks.
 */
export function fanoutElements(layers: Layer[]): SlotEntry[] {
  const out: SlotEntry[] = [];
  for (const layer of layers) {
    for (const el of layer.elements) {
      if (el.iterates) continue;
      const appearance = el.appearances[0];
      if (!appearance?.material) continue;
      const positions = parsePositions(el.positions);
      for (const pos of positions) {
        out.push({
          elementId: el.id,
          position: pos,
          material: appearance.material,
          count: appearance.count,
          appearanceIndex: 0,
        });
      }
    }
  }
  return out;
}
