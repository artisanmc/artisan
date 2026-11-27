import { KIT_PREFIX, KIT_SLOTS, kitFootprint } from "@/lib/pack/kit";
import { describe, expect, it } from "vitest";
import { TRIAL_MENU } from "./kitPieces";

describe("kit pieces", () => {
  it("places every piece but the window and the cell on the trial menu, none over another", () => {
    const placed = KIT_SLOTS.filter((s) => !s.id.startsWith("window.") && s.id !== "cell");
    const taken = new Set<string>();
    for (const slot of placed) {
      const at = TRIAL_MENU[slot.id];
      if (!at) throw new Error(`${slot.id} is not placed`);
      const size = kitFootprint(KIT_PREFIX + slot.id)!;
      expect(at.column + size.width).toBeLessThanOrEqual(9);
      expect(at.row + size.height).toBeLessThanOrEqual(6);
      for (let x = 0; x < size.width; x++)
        for (let y = 0; y < size.height; y++) {
          const key = `${at.column + x},${at.row + y}`;
          expect(taken.has(key), `${slot.id} at ${key}`).toBe(false);
          taken.add(key);
        }
    }
  });
});
