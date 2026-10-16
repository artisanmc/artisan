import { expect, it } from "vitest";
import { normalizeCanvasGroups } from "./canvasGroups";

it("retains valid colors and discards invalid colors and legacy folding", () => {
  const group = { id: "g", name: "Crafts", nodeIds: ["a"], collapsed: true };
  expect(normalizeCanvasGroups([{ ...group, color: "#a855f7" }], ["a"])).toEqual([
    { id: "g", name: "Crafts", nodeIds: ["a"], color: "#a855f7" },
  ]);
  for (const color of ["red", "#xyzxyz", "#fff", 42, null]) {
    expect(normalizeCanvasGroups([{ ...group, color }], ["a"])).toEqual([
      { id: "g", name: "Crafts", nodeIds: ["a"] },
    ]);
  }
});

it("reads the legacy menuIds field, prunes stale members and any Document kind is live", () => {
  expect(
    normalizeCanvasGroups(
      [{ id: "g", name: "Crafts", menuIds: ["c1", "gone", "d1"] }],
      ["c1", "d1"],
    ),
  ).toEqual([{ id: "g", name: "Crafts", nodeIds: ["c1", "d1"] }]);
});
