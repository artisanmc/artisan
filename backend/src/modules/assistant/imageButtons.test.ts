import { expect, test } from "bun:test";
import { validateMenuV1 } from "./validate";

test("the backend accepts rectangular image buttons and rejects overlaps", () => {
  const menu = { schema: "menu/v1", id: "shop", size: 27, title: [], elements: [
    { id: "buy", positions: "0-2,9-11", image: { asset: "buy", fit: "contain" } },
  ] };
  expect(validateMenuV1(menu)).toEqual({ valid: true, errors: [] });
  expect(validateMenuV1({ ...menu, elements: [...menu.elements, { id: "other", positions: 10, material: "STONE" }] }).valid).toBe(false);
});
