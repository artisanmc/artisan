import type { Project, ProjectId } from "@/domain/types";
import { describe, expect, it } from "vitest";
import { expandMenuComponents, findComponent } from "../../../docs/schema/menu/v1/components";
import vector from "../../../testdata/component-expansion.json";
import { menuV1FromDomain } from "./menuV1FromDomain";
import { menuV1ToDomain } from "./menuV1ToDomain";
import { validateMenuV1 } from "./validateMenuV1";

describe("components", () => {
  for (const c of vector.cases) {
    it(c.name, () => {
      const files = c.components as Record<string, Record<string, unknown>>;
      const find = (name: string) =>
        findComponent(c.module, name, (module, bare) => files[module]?.[bare]);
      expect(expandMenuComponents(c.menu, find)).toEqual(c.expanded);
    });
  }

  it("returns the same menu when no look names a component", () => {
    const menu = { elements: [{ id: "a", positions: "0", material: "STONE", states: [{}] }] };
    expect(expandMenuComponents(menu, () => null)).toBe(menu);
  });

  const wire = (element: Record<string, unknown>) => ({
    schema: "menu/v1",
    id: "shop",
    title: [],
    size: 27,
    elements: [{ id: "buy", positions: "0-2", ...element }],
  });

  it("validates a look that names a component, and says what it cannot be", () => {
    const args = { name: "artisan:confirm", text: { en: "Buy", fr: "Acheter" }, count: 3 };
    expect(validateMenuV1(wire({ component: "confirm" }))).toEqual({ valid: true, errors: [] });
    expect(validateMenuV1(wire({ component: args }))).toEqual({ valid: true, errors: [] });
    const errors = (element: Record<string, unknown>) =>
      validateMenuV1(wire(element)).errors.join("\n");
    expect(errors({ component: "confirm", parts: [{ image: "a" }] })).toMatch(/keep the component/);
    expect(errors({ component: "confirm", material: "STONE" })).toMatch(/keep one of the two/);
    expect(errors({ component: "a:b:c" })).toMatch(/is named/);
    expect(errors({ component: "confirm", iterates: { source: "rows", alias: "row" } })).toMatch(
      /iterates or places/,
    );
    expect(validateMenuV1(wire({ component: { text: "Buy" } })).valid).toBe(false);
  });

  it("round-trips a look's component as it is written", () => {
    for (const component of ["confirm", { name: "shop:price", amount: 12, text: { en: "Buy" } }]) {
      const { menu, i18nKeys } = menuV1ToDomain(wire({ component }), {
        projectId: "p" as ProjectId,
        lang: "en",
      });
      const project = { id: "p", defaultLang: "en", i18nKeys } as Project;
      const out = menuV1FromDomain(menu, project);
      expect((out.elements as Record<string, unknown>[])[0]).toEqual({
        id: "buy",
        positions: "0-2",
        component,
      });
      // An image set in the editor since replaces the component.
      menu.layers[0]!.elements[0]!.display.image = { asset: "buy", fit: "native" };
      const replaced = (menuV1FromDomain(menu, project).elements as Record<string, unknown>[])[0];
      expect(replaced).not.toHaveProperty("component");
      expect(replaced).toMatchObject({ image: { asset: "buy" } });
    }
  });
});
