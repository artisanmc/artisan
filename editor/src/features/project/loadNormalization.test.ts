import { describe, expect, it } from "vitest";
import { absorbIntoInitialTree } from "./loadNormalization";

describe("absorbIntoInitialTree", () => {
  it("moves the files left as loaded, keeps the user's edits as edits", () => {
    const initial = { "a.yml": "a0", "b.yml": "b0", "gone.yml": "g" };
    // The user already edited b; the transformation rewrites a and b, adds c, drops gone.
    const before = { "a.yml": "a0", "b.yml": "b-edited", "gone.yml": "g" };
    const after = { "a.yml": "a1", "b.yml": "b1", "c.yml": "c1" };
    expect(absorbIntoInitialTree(initial, before, after)).toEqual({
      "a.yml": "a1",
      "b.yml": "b0",
      "c.yml": "c1",
    });
  });
});
