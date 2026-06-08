import { describe, expect, it } from "vitest";
import canonicalButton from "../../../docs/schema/menu/v1/examples/canonical-button.json";
import canonicalConditional from "../../../docs/schema/menu/v1/examples/canonical-conditional.json";
import { validateMenuV1 } from "./validateMenuV1";

describe("validateMenuV1", () => {
  it("accepts the canonical button example", () => {
    const r = validateMenuV1(canonicalButton);
    expect(r.errors).toEqual([]);
    expect(r.valid).toBe(true);
  });

  it("accepts the canonical conditional example", () => {
    expect(validateMenuV1(canonicalConditional).valid).toBe(true);
  });

  it("rejects a menu with a bad size", () => {
    const bad = { ...(canonicalButton as object), size: 13 };
    const r = validateMenuV1(bad);
    expect(r.valid).toBe(false);
    expect(r.errors.join(" ")).toMatch(/size/);
  });

  it("rejects a string title (legacy form is no longer canonical)", () => {
    const bad = { ...(canonicalButton as object), title: "Shop" };
    expect(validateMenuV1(bad).valid).toBe(false);
  });

  it("rejects a click with flat actions instead of steps", () => {
    const bad = JSON.parse(JSON.stringify(canonicalButton));
    bad.layers[0].elements[0].appearances[0].click.left = { actions: [] };
    expect(validateMenuV1(bad).valid).toBe(false);
  });
});
