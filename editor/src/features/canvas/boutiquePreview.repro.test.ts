import { projectId } from "@/domain/ids";
import { getText } from "@/lib/i18n";
import { projectFromFiles } from "@/schema/projectFromFiles";
import { describe, expect, it } from "vitest";
import { buildPreviewScope } from "./menuPreviewScope";
import { matchPlacementRow, placementAtSlot, resolvePlacementSlot } from "./placement";
import { sourceIsContextFiltered } from "./placementScope";
import { menusOf } from "@/domain/documents";

/**
 * Reproduction of a boutique preview bug: slots showed `{item.name}` /
 * `{item.lore}` / `{item.price_display}` instead of the real values.
 *
 * The menu is PARAMETERISED: its placements cover every category, but its
 * `category` input holds only one (`les_cles` by default) and the source
 * filter applies. The preview can therefore resolve only one category — the
 * question is what it does with the others.
 */
const MENU = [
  "schema: menu/v1",
  "id: shop_category",
  "size: 54",
  "inputs:",
  "- name: category",
  "  type: string",
  "  default: les_cles",
  "- source:",
  "    ref: boutique:items",
  "    filter:",
  "      category: '{category}'",
  "  name: items",
  "  type: list",
  "elements:",
  "- id: grid",
  "  places:",
  "    source: items",
  "    alias: item",
  "    key_field: id",
  "    placements:",
  "    - key: cle_legendaire",
  "      page: 0",
  "      position: 20",
  "    - key: spawner_a_poule",
  "      page: 0",
  "      position: 21",
  "  material: '{item.icon}'",
  "  title: '{item.name}'",
  "  lore:",
  "  - '{item.lore}'",
  "  - '{item.price_display}'",
  "",
].join("\n");

/** Two rows as the server really renders them. */
const ROWS = [
  {
    id: "cle_legendaire",
    name: "Clé légendaire",
    icon: "item:ci_cle",
    category: "les_cles",
    price: 100,
    final_price: 100,
    price_display: "&f➥ &l100 Primals",
    lore: ">> Une clé\n>> Rare",
  },
  {
    id: "spawner_a_poule",
    name: "Spawner à poule",
    icon: "SPAWNER",
    category: "spawners",
    price: 50,
    final_price: 50,
    price_display: "&f➥ &l50 Primals",
    lore: ">> Un spawner",
  },
];

function load() {
  const files = {
    "plugins/Artisan/projects/boutique_shop/manifest.yaml":
      "schema: manifest/v1\nproject_id: boutique_shop\nmodule: boutique\ndefault_lang: fr\nlanguages: [fr]\n",
    "plugins/Artisan/projects/boutique_shop/menus/shop_category.yaml": MENU,
  };
  const project = projectFromFiles(projectId("boutique_shop"), files, { name: "Boutique" });
  return { project, menu: menusOf(project)[0]! };
}

describe("shop preview — placements outside the preview context", () => {
  it("the input filter only lets the previewed category through", () => {
    const { project, menu } = load();
    const scope = buildPreviewScope(menu, project, { "boutique:items": ROWS });
    // The `category: '{category}'` filter interpolates with the `les_cles` default.
    expect((scope.items as unknown[]).map((r) => (r as { id: string }).id)).toEqual([
      "cle_legendaire",
    ]);
  });

  it("a placement whose row is not in the context is PENDING, not raw", () => {
    const { project, menu } = load();
    const scope = buildPreviewScope(menu, project, { "boutique:items": ROWS });
    const element = menu.layers[0]!.elements[0]!;
    const places = element.places!;
    const appearance = element.display!;
    const rows = scope[places.source] as unknown;

    const inContext = resolvePlacementSlot({
      places,
      appearance,
      placement: places.placements[0]!,
      row: matchPlacementRow(rows, places.keyField, "cle_legendaire"),
      rowsAvailable: Array.isArray(rows),
      baseCtx: scope,
      project,
      activeLang: "fr",
      elementId: element.id,
    });
    expect(inContext.title).toBe("Clé légendaire");

    // One from another category: the slot must not show the template.
    const outOfContext = resolvePlacementSlot({
      places,
      appearance,
      placement: places.placements[1]!,
      row: matchPlacementRow(rows, places.keyField, "spawner_a_poule"),
      rowsAvailable: Array.isArray(rows),
      baseCtx: scope,
      project,
      activeLang: "fr",
      elementId: element.id,
    });
    expect(outOfContext.dangling).toBe(true);
    expect(outOfContext.title ?? "").not.toContain("{item.");
  });

  /**
   * Follow-up of that bug: the menu showed up covered in dashed slots, "as in
   * pagination mode", while it is in pure placement mode. It was not a reserved
   * area — it was the placements of the OTHER categories, dangling, occupying
   * their slots.
   *
   * A source filtered by the context renders only a slice of the whole: a
   * missing key proves nothing there, so it must leave no trace on screen.
   * Without a context filter, the same absence is a real hole and must show.
   */
  it("out of context, a placement leaves no dotted slot", () => {
    const { menu } = load();
    expect(sourceIsContextFiltered(menu, menu.layers[0]!.elements[0]!.places!.source)).toBe(true);
  });

  it("the shared slot renders the placement OF the context, not the first in the list", () => {
    // The core of the bug: a parameterised menu reuses the same slots from one
    // category to another. Taking the first placement at the position missed
    // as soon as the preview showed another category — no row bound, and the
    // hover showed `{item.name}` verbatim.
    const { project, menu } = load();
    const places = menu.layers[0]!.elements[0]!.places!;

    // Two placements on the SAME position, two different categories.
    const shared = [
      { key: "cle_legendaire", page: 0, position: 20 },
      { key: "spawner_a_poule", page: 0, position: 20 },
    ] as typeof places.placements;
    const twoOnOneSlot = { ...places, placements: shared };

    const scope = buildPreviewScope(menu, project, { "boutique:items": ROWS });
    const rows = scope[places.source];
    expect(placementAtSlot(twoOnOneSlot, rows, 0, 20)?.key).toBe("cle_legendaire");

    // And if the other category is previewed, the other one wins.
    const spawners = buildPreviewScope(
      menu,
      project,
      { "boutique:items": ROWS },
      {
        category: "spawners",
      },
    );
    expect(placementAtSlot(twoOnOneSlot, spawners[places.source], 0, 20)?.key).toBe(
      "spawner_a_poule",
    );
  });

  it("the appearance's lore is readable (and not an object)", () => {
    const { project, menu } = load();
    const appearance = menu.layers[0]!.elements[0]!.display!;
    // This is what the tooltip reads. If it renders "" or an object, the hover lies.
    const loreRaw = appearance.lore ? getText(project, appearance.lore, "fr") : "";
    expect(typeof loreRaw).toBe("string");
    expect(loreRaw).toContain("{item.lore}");
    expect(loreRaw).toContain("{item.price_display}");
  });
});
