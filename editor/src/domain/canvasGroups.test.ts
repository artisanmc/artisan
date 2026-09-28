import { expect, it } from "vitest";
import { normalizeCanvasGroups } from "./canvasGroups";

it("retains valid colors and discards invalid colors and legacy folding", () => {
  const group = { id: "g", name: "Crafts", menuIds: ["a"], collapsed: true };
  expect(normalizeCanvasGroups([{ ...group, color: "#a855f7" }], ["a"])).toEqual([
    { id: "g", name: "Crafts", menuIds: ["a"], color: "#a855f7" },
  ]);
  for (const color of ["red", "#xyzxyz", "#fff", 42, null]) {
    expect(normalizeCanvasGroups([{ ...group, color }], ["a"])).toEqual([
      { id: "g", name: "Crafts", menuIds: ["a"] },
    ]);
  }
});
