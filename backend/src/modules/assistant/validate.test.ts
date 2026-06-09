import { describe, expect, it } from "bun:test";
import { validateMenuV1 } from "./validate";

const good = {
  schema: "menu/v1", id: "shop", title: [{ kind: "plain", value: { key: "k" } }], size: 27,
  layers: [{ id: "l1", name: "default", elements: [{ id: "e1", positions: "0", appearances: [{ material: "STONE" }] }] }],
};

describe("validateMenuV1 (backend gate)", () => {
  it("accepts a canonical menu", () => {
    expect(validateMenuV1(good)).toEqual({ valid: true, errors: [] });
  });
  it("rejects a bad size (ajv)", () => {
    const r = validateMenuV1({ ...good, size: 13 });
    expect(r.valid).toBe(false);
    expect(r.errors.join(" ")).toMatch(/size/);
  });
  it("rejects duplicate element ids (validateMenuLayout)", () => {
    const r = validateMenuV1({
      ...good,
      layers: [{ id: "l1", name: "d", elements: [
        { id: "dup", positions: "0", appearances: [{ material: "STONE" }] },
        { id: "dup", positions: "1", appearances: [{ material: "STONE" }] },
      ] }],
    });
    expect(r.valid).toBe(false);
    expect(r.errors.join(" ")).toMatch(/dup/);
  });
  it("rejects an out-of-bounds position (validateMenuLayout)", () => {
    const r = validateMenuV1({
      ...good,
      layers: [{ id: "l1", name: "d", elements: [{ id: "e1", positions: "99", appearances: [{ material: "STONE" }] }] }],
    });
    expect(r.valid).toBe(false);
    expect(r.errors.join(" ")).toMatch(/bounds|out of/i);
  });
});
