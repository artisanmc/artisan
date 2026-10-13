import { describe, expect, it } from "vitest";

import { isResolvedContext } from "./resolvedContexts";

/**
 * A call context is computed by resolving the link's arguments against the
 * caller's rows. When the source has no data — server not linked, so no
 * snapshot — there is no row to iterate and the templates come out verbatim:
 * `{cat}`, `{cat.id}`. Offering them as a context gives a banner reading
 * "Seen from: shop_main › {cat}" and a choice that changes nothing.
 */
describe("isResolvedContext", () => {
  it("accepts genuinely resolved values", () => {
    expect(isResolvedContext({ category: "les_cles", category_name: "Les Clés" })).toBe(true);
  });

  it("accepts a non-text value (the whole row passed as is)", () => {
    expect(isResolvedContext({ cat: { id: "les_cles", name: "Les Clés" } })).toBe(true);
  });

  it("rejects a template left raw", () => {
    expect(isResolvedContext({ category: "{cat.id}" })).toBe(false);
    expect(isResolvedContext({ cat: "{cat}" })).toBe(false);
  });

  /** A single unresolved argument is enough: the resulting screen would be wrong. */
  it("rejects as soon as one argument out of two is raw", () => {
    expect(isResolvedContext({ category: "les_cles", category_name: "{cat.name}" })).toBe(false);
  });

  it("accepts a brace that is not a template", () => {
    expect(isResolvedContext({ label: "Pack {rare}" })).toBe(false);
    expect(isResolvedContext({ label: "100% coton" })).toBe(true);
  });
});
