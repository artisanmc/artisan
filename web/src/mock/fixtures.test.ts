import { assertPackHermetic } from "@/domain/invariants";
import { describe, expect, it } from "vitest";
import { mockAccount } from "./fixtures";

describe("mockAccount fixture", () => {
  it("contains three packs in order", () => {
    const account = mockAccount();
    expect(account.packs).toHaveLength(3);
    expect(account.packs.map((p) => p.name)).toEqual(["Personal", "Shop System", "Daily Quests"]);
  });

  it("every pack passes the hermetic invariant", () => {
    for (const pack of mockAccount().packs) {
      expect(() => assertPackHermetic(pack), `pack ${pack.name}`).not.toThrow();
    }
  });
});
