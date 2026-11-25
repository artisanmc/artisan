import { KIT_SLOTS } from "@/lib/pack/kit";
import { describe, expect, it } from "vitest";
import { KIT_FAMILIES, kitPiecesOf } from "./kitPieces";

describe("kit pieces", () => {
  it("sorts every piece of the base in one family", () => {
    const sorted = KIT_FAMILIES.flatMap((family) => kitPiecesOf(family).map((s) => s.id));
    expect(sorted.sort()).toEqual(KIT_SLOTS.map((s) => s.id).sort());
    expect(kitPiecesOf("buttons").map((s) => s.id)).toContain("button.3x1");
    expect(kitPiecesOf("controls").map((s) => s.id)).toContain("close.1x1");
    expect(kitPiecesOf("frames").map((s) => s.id)).toContain("window.6");
  });
});
