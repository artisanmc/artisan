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
   * Ce test disait l'inverse jusqu'au 2026-08-29 : `appearances` devait être
   * IGNORÉ, sans repli de lecture. La décision reposait sur une prémisse —
   * `menu/v1` était pré-prod, les fichiers seraient réinitialisés — que la
   * production a démentie : des menus écrits avant le changement y vivaient
   * encore, et l'éditeur les rendait vides sans rien dire.
   *
   * Ce qui reste intact de la décision d'origine : rien n'est jamais RÉÉCRIT
   * dans l'ancienne forme, et un état ne s'hérite pas. Seule la lecture cède.
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
 * Les fichiers écrits AVANT le 17 août portent `appearances:` — une liste, le
 * premier élément faisant office de display. Le changement de format les avait
 * laissés derrière lui : plus aucun champ reconnu, donc un display vide, des
 * items invisibles et un template sans contenu. Sans message, et sur des
 * fichiers parfaitement valides — c'est ce qui a cassé les menus Boutique en
 * production, dix jours après coup.
 *
 * On les lit donc encore. On ne les réécrit jamais : l'écriture reste
 * canonique, donc le premier enregistrement remet le fichier à l'endroit.
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
    // Le format courant fait foi : la liste est un vestige, pas une alternative.
    expect(menu.layers[0]!.elements[0]!.display.material).toBe("ARROW");
  });
});

/**
 * Les fichiers d'avant portent aussi du texte STRUCTURÉ — `{ kind: plain, value:
 * { key: … } }`, la forme des calques de titre. Le lecteur de lore les passait à
 * `String()`, ce qui donne littéralement « [object Object] » dans l'infobulle et
 * en jeu : un lore illisible, sur un fichier que rien ne signale.
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
