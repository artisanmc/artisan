import { projectId } from "@/domain/ids";
import type { Project } from "@/domain/types";
import { serializeMenuToV1 } from "@/features/export/transform";
import { describe, expect, it } from "vitest";
import { menuV1ToDomain } from "./menuV1ToDomain";

/**
 * ADR `element-display-and-states` — an Element carries ONE display appearance,
 * written flat on the element, plus guarded `states`. A state is a whole
 * appearance, never a patch: what it omits is absent, not inherited.
 */

const opts = { projectId: projectId("p"), lang: "en" };

function wireMenu(el: Record<string, unknown>) {
  return {
    schema: "menu/v1",
    id: "shop",
    title: [],
    size: 27,
    layers: [{ id: "l1", name: "default", elements: [{ id: "e1", positions: "0", ...el }] }],
  };
}

describe("reading — flat display + states", () => {
  it("reads the element's own fields as its display", () => {
    const { menu } = menuV1ToDomain(
      wireMenu({ material: "ARROW", title: "Retour", lore: ["ligne"] }) as never,
      opts,
    );
    const el = menu.layers[0]!.elements[0]!;
    expect(el.display.material).toBe("ARROW");
    expect(el.display.title).toBeDefined();
    expect(el.display.lore).toBeDefined();
    expect(el.states).toEqual([]);
  });

  it("reads guarded states in order, each a whole appearance", () => {
    const { menu } = menuV1ToDomain(
      wireMenu({
        material: "DIAMOND",
        states: [
          { if: [{ type: "has_permission", perm: "vip" }], material: "EMERALD" },
          { if: [{ type: "has_money", amount: 100 }], material: "BARRIER" },
        ],
      }) as never,
      opts,
    );
    const el = menu.layers[0]!.elements[0]!;
    expect(el.display.material).toBe("DIAMOND");
    expect(el.states.map((s) => s.material)).toEqual(["EMERALD", "BARRIER"]);
    expect(el.states[0]!.if).toHaveLength(1);
  });

  it("does not inherit display fields into a state", () => {
    const { menu } = menuV1ToDomain(
      wireMenu({
        material: "DIAMOND",
        title: "Acheter",
        states: [{ if: [{ type: "has_money", amount: 100 }], material: "BARRIER" }],
      }) as never,
      opts,
    );
    const state = menu.layers[0]!.elements[0]!.states[0]!;
    expect(state.material).toBe("BARRIER");
    expect(state.title).toBeUndefined();
  });

  it("ignores the retired `appearances` list", () => {
    const { menu } = menuV1ToDomain(
      wireMenu({ appearances: [{ material: "GOLD_INGOT" }] }) as never,
      opts,
    );
    expect(menu.layers[0]!.elements[0]!.display.material).toBeUndefined();
  });

  it("keeps the structural keys off the display", () => {
    const { menu } = menuV1ToDomain(wireMenu({ material: "ARROW", tags: ["deco"] }) as never, opts);
    const el = menu.layers[0]!.elements[0]!;
    expect(el.positions).toBe("0");
    expect(el.tags).toEqual(["deco"]);
    expect(el.display).not.toHaveProperty("positions");
    expect(el.display).not.toHaveProperty("tags");
  });
});

describe("writing — flat display + states", () => {
  function roundTrip(el: Record<string, unknown>): Record<string, unknown> {
    const { menu, i18nKeys } = menuV1ToDomain(wireMenu(el) as never, opts);
    const project = {
      id: projectId("p"),
      name: "p",
      menus: [menu],
      commands: [],
      dialogs: [],
      assets: [],
      dataSources: [],
      dataModels: [],
      i18nKeys,
      defaultLang: "en",
      langs: ["en"],
    } as unknown as Project;
    const wire = serializeMenuToV1(menu, project);
    return (wire.elements as Record<string, unknown>[])[0]!;
  }

  it("writes the display flat, with no `appearances` key", () => {
    const el = roundTrip({ material: "ARROW", title: "Retour" });
    expect(el).not.toHaveProperty("appearances");
    expect(el.material).toBe("ARROW");
  });

  it("writes states under `states`", () => {
    const el = roundTrip({
      material: "DIAMOND",
      states: [{ if: [{ type: "has_money", amount: 100 }], material: "BARRIER" }],
    });
    expect(el.material).toBe("DIAMOND");
    expect((el.states as Record<string, unknown>[])[0]!.material).toBe("BARRIER");
  });

  it("omits `states` entirely when there are none", () => {
    expect(roundTrip({ material: "ARROW" })).not.toHaveProperty("states");
  });
});
