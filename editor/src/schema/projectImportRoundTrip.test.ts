// Conformance test: the BACKEND importer (backend/src/lib/projectImport.ts,
// imported here via relative path — it only depends on `yaml`) must produce a
// Project the editor can re-export without corrupting the seeded content.
// Fixtures are the ACTUAL Boutique add-on bootstrap files
// (Boutique/src/main/resources/bootstrap/), inlined verbatim.
import type { Project } from "@/domain/types";
import { transform } from "@/features/export/transform";
import { describe, expect, it } from "vitest";
import { parse } from "yaml";
import { importProjectFromFiles } from "../../../backend/src/lib/projectImport";

const PROJECT_ID = "boutique_shop";
const base = `plugins/Artisan/projects/${PROJECT_ID}`;

const MANIFEST = `schema: manifest/v1
project_id: boutique_shop
default_lang: fr
languages: [fr]
files:
  menus: [shop_main, shop_category]
  commands: [boutique]
  dialogs: [confirm_purchase]
`;

const LANG_FR = `boutique.shop_main.title: "Boutique"
boutique.shop_category.title: "Boutique — {category_name}"
`;

const MENU_SHOP_MAIN = `schema: menu/v1
id: shop_main
title:
  - kind: plain
    value: { key: "boutique.shop_main.title" }
size: 54
context_inputs:
  - name: cats
    type: list
    source: { ref: "boutique:categories" }
layers:
  - id: main
    name: Main
    elements:
      - id: grid
        positions: "10-43"
        iterates: { source: cats, alias: cat }
        appearances:
          - material: "{cat.icon}"
            title: "{cat.name}"
            click:
              left:
                steps: 'open_menu shop_category with category="{cat.id}" category_name="{cat.name}"'
`;

const MENU_SHOP_CATEGORY = `schema: menu/v1
id: shop_category
title:
  - kind: plain
    value: { key: "boutique.shop_category.title" }
size: 54
context_inputs:
  - name: category
    type: string
  - name: category_name
    type: string
    default: ""
  - name: items
    type: list
    source: { ref: "boutique:items", filter: { category: "{category}" } }
layers:
  - id: main
    name: Main
    elements:
      - id: grid
        positions: "10-43"
        iterates: { source: items, alias: item }
        appearances:
          - material: "{item.icon}"
            title: "{item.name}"
            lore:
              - "{item.lore}"
              - "§ePrix : {item.final_price} tokens"
            click:
              left:
                steps: 'open_dialog confirm_purchase with item_id="{item.id}" item_name="{item.name}" item_price="{item.final_price}"'
      - id: back
        positions: "49"
        appearances:
          - material: ARROW
            title: "§7Retour"
            click:
              left:
                steps: "open_menu shop_main"
`;

const COMMAND_BOUTIQUE = `schema: command/v1
id: boutique
name: boutique
description: "Ouvre la boutique"
steps: "open_menu shop_main"
`;

const DIALOG_CONFIRM = `schema: dialog/v1
id: confirm_purchase
title: "Confirmer l'achat"
can_close_with_escape: true
body:
  - { type: text, text: "Acheter {item_name} pour {item_price} tokens ?" }
buttons:
  - id: confirm
    label: "§aConfirmer"
    actions: 'run_command "boutique:buy {item_id}" as player'
  - id: cancel
    label: "§cAnnuler"
    actions: "open_menu shop_category"
`;

const SHOP_YAML = `schema: boutique/v1
whole_shop_discount: 0
categories:
  - id: weapons
    name: Armes
    icon: DIAMOND_SWORD
    discount: 0
    items:
      - id: diamond_sword
        name: Épée en diamant
        icon: DIAMOND_SWORD
        price: 100
        discount: 0
        buy_commands: ["give %player% diamond_sword 1"]
`;

const bootstrapFiles: Record<string, string> = {
  [`${base}/manifest.yaml`]: MANIFEST,
  [`${base}/lang/fr.yaml`]: LANG_FR,
  [`${base}/menus/shop_main.yaml`]: MENU_SHOP_MAIN,
  [`${base}/menus/shop_category.yaml`]: MENU_SHOP_CATEGORY,
  [`${base}/commands/boutique.yaml`]: COMMAND_BOUTIQUE,
  [`${base}/dialogs/confirm_purchase.yaml`]: DIALOG_CONFIRM,
  [`${base}/boutique/shop.yaml`]: SHOP_YAML,
};

// biome-ignore lint/suspicious/noExplicitAny: parsed YAML assertions
type Json = Record<string, any>;

function roundTrip(): { project: Project; out: Record<string, Json>; rawOut: Record<string, string> } {
  const project = importProjectFromFiles(PROJECT_ID, bootstrapFiles) as unknown as Project;
  const rawOut = transform(project);
  const out: Record<string, Json> = {};
  for (const [path, content] of Object.entries(rawOut)) {
    if (path.endsWith(".yaml")) out[path.slice(base.length + 1)] = parse(content) as Json;
  }
  return { project, out, rawOut };
}

describe("projectImport round-trip (Boutique bootstrap → import → transform)", () => {
  it("preserves title layer i18n keys", () => {
    const { out } = roundTrip();
    expect(out["menus/shop_main.yaml"]!.title).toEqual([
      { kind: "plain", value: { key: "boutique.shop_main.title" } },
    ]);
    expect(out["menus/shop_category.yaml"]!.title).toEqual([
      { kind: "plain", value: { key: "boutique.shop_category.title" } },
    ]);
  });

  it("preserves every context_input (name/type/source ref + filter)", () => {
    const { out } = roundTrip();
    expect(out["menus/shop_main.yaml"]!.context_inputs).toEqual([
      { name: "cats", type: "list", source: { ref: "boutique:categories" } },
    ]);
    expect(out["menus/shop_category.yaml"]!.context_inputs).toEqual([
      { name: "category", type: "string" },
      { name: "category_name", type: "string", default: "" },
      {
        name: "items",
        type: "list",
        source: { ref: "boutique:items", filter: { category: "{category}" } },
      },
    ]);
  });

  it("preserves open_menu/open_dialog/run_command targets and context", () => {
    const { out } = roundTrip();

    // Steps re-export as Action DSL strings (Phase 2). Targets + context tails
    // survive the structured→domain→DSL round-trip.
    const mainGrid = out["menus/shop_main.yaml"]!.layers[0].elements[0];
    expect(mainGrid.iterates).toEqual({ source: "cats", alias: "cat" });
    expect(mainGrid.appearances[0].click.left.steps).toBe(
      'open_menu shop_category with category="{cat.id}" category_name="{cat.name}"',
    );

    const catLayers = out["menus/shop_category.yaml"]!.layers[0].elements;
    expect(catLayers[0].appearances[0].click.left.steps).toBe(
      'open_dialog confirm_purchase with item_id="{item.id}" item_name="{item.name}" item_price="{item.final_price}"',
    );
    expect(catLayers[1].appearances[0].click.left.steps).toBe("open_menu shop_main");

    expect(out["commands/boutique.yaml"]!.steps).toBe("open_menu shop_main");

    const buttons = out["dialogs/confirm_purchase.yaml"]!.buttons;
    expect(buttons[0].actions).toBe('run_command "boutique:buy {item_id}" as player');
    expect(buttons[1].actions).toBe("open_menu shop_category");
  });

  it("re-emits lang/fr.yaml with both bootstrap keys", () => {
    const { out } = roundTrip();
    const fr = out["lang/fr.yaml"]!;
    expect(fr["boutique.shop_main.title"]).toBe("Boutique");
    expect(fr["boutique.shop_category.title"]).toBe("Boutique — {category_name}");
  });

  it("keeps literal appearance text resolvable through the default lang file", () => {
    const { out } = roundTrip();
    const fr = out["lang/fr.yaml"]!;
    // Literal titles get minted keys; the fr lang file must resolve them back
    // to the original literal (placeholders intact).
    const title = out["menus/shop_main.yaml"]!.layers[0].elements[0].appearances[0].title as string;
    const key = /^\{i18n:(.+)\}$/.exec(title)?.[1];
    expect(key).toBeDefined();
    expect(fr[key!]).toBe("{cat.name}");
  });

  it("re-emits unclaimed module files (boutique/shop.yaml) verbatim", () => {
    const { rawOut } = roundTrip();
    expect(rawOut[`${base}/boutique/shop.yaml`]).toBe(SHOP_YAML);
  });
});
