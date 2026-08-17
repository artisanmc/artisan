import { describe, expect, it } from "vitest";
import schema from "../../../docs/schema/menu/v1/schema.json";
import vector from "../../../testdata/element-structural-keys.json";

/**
 * Flattening the display onto the element put the element's own keys and the
 * appearance's fields in ONE namespace. Nothing prevents a future appearance
 * field from shadowing a structural key except noticing — so the namespace is
 * written down once, in `testdata/element-structural-keys.json`, and checked
 * here and in the plugin suite (`ElementStructuralKeysTest`).
 * Cf. ADR `element-display-and-states`.
 */

const defs = (schema as { $defs: Record<string, { properties?: Record<string, unknown> }> }).$defs;

describe("element key namespace", () => {
  it("the two key sets are disjoint", () => {
    const overlap = vector.structural.filter((k) => (vector.appearance as string[]).includes(k));
    expect(overlap).toEqual([]);
  });

  it("the schema's Element declares exactly the structural keys", () => {
    const declared = Object.keys(defs.Element!.properties ?? {});
    expect(declared.sort()).toEqual([...vector.structural].sort());
  });

  it("no appearance field can shadow a structural key", () => {
    const fields = Object.keys(defs.AppearanceFields!.properties ?? {});
    const shadowing = fields.filter((k) => (vector.structural as string[]).includes(k));
    expect(shadowing).toEqual([]);
  });

  it("the vector lists every appearance field the schema declares", () => {
    const fields = Object.keys(defs.AppearanceFields!.properties ?? {});
    const missing = fields.filter((k) => !(vector.appearance as string[]).includes(k));
    expect(missing).toEqual([]);
  });
});
