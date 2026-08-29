import { projectId } from "@/domain/ids";
import { getText } from "@/lib/i18n";
import { projectFromFiles } from "@/schema/projectFromFiles";
import { describe, expect, it } from "vitest";
import { buildPreviewScope } from "./menuPreviewScope";
import { matchPlacementRow, placementAtSlot, resolvePlacementSlot } from "./placement";
import { sourceIsContextFiltered } from "./placementScope";

/**
 * Reproduction du bug d'aperçu signalé en prod le 2026-08-17 sur la boutique :
 * des slots affichent `{item.name}` / `{item.lore}` / `{item.price_display}`
 * au lieu des vraies valeurs.
 *
 * Le menu est PARAMÉTRÉ : ses placements couvrent toutes les catégories, mais
 * son input `category` n'en vaut qu'une (`les_cles` par défaut) et le filtre de
 * la source s'applique. L'aperçu ne peut donc résoudre qu'une catégorie — reste
 * à savoir ce qu'il fait des autres.
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

/** Deux lignes comme le serveur les rend vraiment (vérifié en prod). */
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
  return { project, menu: project.menus[0]! };
}

describe("aperçu boutique — placements hors du contexte d'aperçu", () => {
  it("le filtre de l'input ne laisse passer que la catégorie prévisualisée", () => {
    const { project, menu } = load();
    const scope = buildPreviewScope(menu, project, { "boutique:items": ROWS });
    // Le filtre `category: '{category}'` s'interpole avec le défaut `les_cles`.
    expect((scope.items as unknown[]).map((r) => (r as { id: string }).id)).toEqual([
      "cle_legendaire",
    ]);
  });

  it("un placement dont la ligne n'est pas dans le contexte est PENDANT, pas brut", () => {
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

    // Celui d'une autre catégorie : le slot ne doit pas afficher le gabarit.
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
   * La suite de ce bug, signalée le 2026-08-29 : le menu s'affichait couvert de
   * cases pointillées, « comme en mode pagination », alors qu'il est en
   * placement pur. Ce n'était pas un territoire réservé — c'étaient les
   * placements des AUTRES catégories, pendants, occupant leurs slots.
   *
   * Une source filtrée par le contexte ne rend qu'une tranche du tout : une clé
   * absente n'y prouve rien, donc elle ne doit pas laisser de trace à l'écran.
   * Sans filtre contextuel, la même absence est un vrai trou et doit se voir.
   */
  it("hors contexte, un placement ne laisse pas de case pointillée", () => {
    const { menu } = load();
    expect(sourceIsContextFiltered(menu, menu.layers[0]!.elements[0]!.places!.source)).toBe(true);
  });

  it("le slot partagé rend le placement DU contexte, pas le premier de la liste", () => {
    // Le cœur du bug de prod : un menu paramétré réutilise les mêmes slots
    // d'une catégorie à l'autre. Prendre le premier placement de la position
    // tombait à côté dès que l'aperçu montrait une autre catégorie — aucune
    // ligne liée, et le survol affichait `{item.name}` tel quel.
    const { project, menu } = load();
    const places = menu.layers[0]!.elements[0]!.places!;

    // Deux placements sur la MÊME position, deux catégories différentes.
    const shared = [
      { key: "cle_legendaire", page: 0, position: 20 },
      { key: "spawner_a_poule", page: 0, position: 20 },
    ] as typeof places.placements;
    const twoOnOneSlot = { ...places, placements: shared };

    const scope = buildPreviewScope(menu, project, { "boutique:items": ROWS });
    const rows = scope[places.source];
    expect(placementAtSlot(twoOnOneSlot, rows, 0, 20)?.key).toBe("cle_legendaire");

    // Et si c'est l'autre catégorie qui est prévisualisée, c'est l'autre qui gagne.
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

  it("le lore de l'apparence est bien lisible (et pas un objet)", () => {
    const { project, menu } = load();
    const appearance = menu.layers[0]!.elements[0]!.display!;
    // C'est ce que le tooltip lit. Si ça rend "" ou un objet, le survol ment.
    const loreRaw = appearance.lore ? getText(project, appearance.lore, "fr") : "";
    expect(typeof loreRaw).toBe("string");
    expect(loreRaw).toContain("{item.lore}");
    expect(loreRaw).toContain("{item.price_display}");
  });
});
