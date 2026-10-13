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

  /**
   * This test used to say the opposite: `appearances` was to be IGNORED, with
   * no read fallback. That decision rested on a premise — `menu/v1` was
   * pre-production, files would be reset — that production disproved: menus
   * written before the change still lived there, and the editor rendered them
   * empty without a word.
   *
   * What remains of the original decision: nothing is ever REWRITTEN in the old
   * form, and a state is not inherited. Only reading gives way.
   */
  it("lit encore une liste `appearances` héritée, faute de quoi le fichier serait invisible", () => {
    const { menu } = menuV1ToDomain(
      wireMenu({ appearances: [{ material: "GOLD_INGOT" }] }) as never,
      opts,
    );
    expect(menu.layers[0]!.elements[0]!.display.material).toBe("GOLD_INGOT");
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

/**
 * Older files carry `appearances:` — a list whose first item acts as the
 * display. The format change had left them behind: no recognised field any
 * more, so an empty display, invisible items and a template without content.
 * With no message, on perfectly valid files — that is what broke the Boutique
 * menus in production, ten days later.
 *
 * So they are still read. They are never rewritten that way: writing stays
 * canonical, so the first save puts the file right.
 */
describe("reading — le format `appearances:` d'avant reste lisible", () => {
  it("prend la première appearance comme display, les suivantes comme states", () => {
    const { menu } = menuV1ToDomain(
      wireMenu({
        appearances: [
          { material: "DIAMOND", title: "Acheter" },
          { if: [{ type: "has_permission", perm: "vip" }], material: "EMERALD" },
        ],
      }) as never,
      opts,
    );
    const el = menu.layers[0]!.elements[0]!;
    expect(el.display.material).toBe("DIAMOND");
    expect(el.display.title).toBeDefined();
    expect(el.states).toHaveLength(1);
    expect(el.states[0]!.material).toBe("EMERALD");
  });

  it("réécrit au format courant : le fichier se répare au premier enregistrement", () => {
    const { menu } = menuV1ToDomain(
      wireMenu({ appearances: [{ material: "DIAMOND" }] }) as never,
      opts,
    );
    const project = { id: projectId("p"), defaultLang: "en", i18nKeys: {} } as unknown as Project;
    const out = serializeMenuToV1(menu, project);
    expect(JSON.stringify(out)).not.toContain("appearances");
    expect(JSON.stringify(out)).toContain("DIAMOND");
  });

  it("un display à plat l'emporte sur une liste `appearances` résiduelle", () => {
    const { menu } = menuV1ToDomain(
      wireMenu({ material: "ARROW", appearances: [{ material: "DIAMOND" }] }) as never,
      opts,
    );
    // The current format wins: the list is a leftover, not an alternative.
    expect(menu.layers[0]!.elements[0]!.display.material).toBe("ARROW");
  });
});

/**
 * Older files also carry STRUCTURED text — `{ kind: plain, value:
 * { key: … } }`, the title layer shape. The lore reader passed them to
 * `String()`, which literally gives "[object Object]" in the tooltip and in
 * game: unreadable lore, on a file nothing flags.
 */
describe("reading — du texte structuré dans le lore ne donne jamais [object Object]", () => {
  it("résout une ligne portant une référence i18n", () => {
    const { menu } = menuV1ToDomain(
      wireMenu({ material: "DIAMOND", lore: [{ key: "boutique.item.lore" }] }) as never,
      opts,
    );
    expect(menu.layers[0]!.elements[0]!.display.lore!.key).toBe("boutique.item.lore");
  });

  it("aplatit un calque `{ kind: plain, value }`", () => {
    const { menu, i18nKeys } = menuV1ToDomain(
      wireMenu({
        material: "DIAMOND",
        lore: [{ kind: "plain", value: "Une ligne" }, "Une autre"],
      }) as never,
      opts,
    );
    const lore = menu.layers[0]!.elements[0]!.display.lore!;
    expect(i18nKeys[lore.key]!.en).toBe("Une ligne\nUne autre");
  });

  it("un objet inconnu se voit, au lieu de se déguiser en [object Object]", () => {
    const { menu, i18nKeys } = menuV1ToDomain(
      wireMenu({ material: "DIAMOND", lore: [{ inattendu: 1 }] }) as never,
      opts,
    );
    const lore = menu.layers[0]!.elements[0]!.display.lore!;
    expect(i18nKeys[lore.key]!.en).not.toContain("[object Object]");
    expect(i18nKeys[lore.key]!.en).toContain("inattendu");
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
