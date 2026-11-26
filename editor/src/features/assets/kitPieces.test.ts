import { KIT_PREFIX, KIT_SLOTS, kitFootprint } from "@/lib/pack/kit";
import { describe, expect, it } from "vitest";
import { KIT_FAMILIES, TRIAL_MENU, kitPiecesOf } from "./kitPieces";

describe("kit pieces", () => {
  it("sorts every piece of the base in one family", () => {
    const sorted = KIT_FAMILIES.flatMap((family) => kitPiecesOf(family).map((s) => s.id));
    expect(sorted.sort()).toEqual(KIT_SLOTS.map((s) => s.id).sort());
    expect(kitPiecesOf("buttons").map((s) => s.id)).toContain("button.3x1");
    expect(kitPiecesOf("controls").map((s) => s.id)).toContain("close.1x1");
    expect(kitPiecesOf("frames").map((s) => s.id)).toContain("window.6");
  });

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
