import type { ElementId, Layer } from "@/domain/types";
import { parsePositions } from "@/lib/positions";

export interface SlotEntry {
  elementId: ElementId;
  position: number;
  /** `undefined` when the element has no material — phantom-slot placeholder. */
  material: string | undefined;
  count?: number;
  appearanceIndex: number;
}

/**
 * Pure positional fanout: for each non-iterating element in the given layers,
 * expand its position string into one SlotEntry per slot. Elements with no
 * material in the first appearance are included as phantom-slot entries
 * (`material: undefined`) so their positions still render as dashed-outline
 * placeholders in the canvas.
 *
 * Elements that use `iterates` or `places` (placement mode) are intentionally
 * excluded — their expansion depends on live data-source state (store reads,
 * placeholder resolution) and must remain in the component that owns those hooks.
 */
export function fanoutElements(layers: Layer[]): SlotEntry[] {
  const out: SlotEntry[] = [];
  for (const layer of layers) {
    for (const el of layer.elements) {
      if (el.iterates || el.places) continue;
      const appearance = el.appearances[0];
      if (!appearance) continue;
      const positions = parsePositions(el.positions);
      for (const pos of positions) {
        out.push({
          elementId: el.id,
          position: pos,
          material: appearance.material || undefined,
          count: appearance.material ? appearance.count : undefined,
          appearanceIndex: 0,
        });
      }
    }
  }
  return out;
}
