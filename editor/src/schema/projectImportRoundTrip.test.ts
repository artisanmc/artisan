// Conformance test: importing HAND-WRITTEN project files (legacy spellings:
// `{key}` title objects, `context_inputs`, `layers` wrapping, `{steps}` click
// objects) must produce a Project the editor can re-export without corrupting
// the seeded content. Fixtures are the ACTUAL Boutique add-on bootstrap files
// (Boutique/src/main/resources/bootstrap/), inlined verbatim.
import type { Project, ProjectId } from "@/domain/types";
import { flattenLangTree } from "@/lib/langTree";
import { describe, expect, it } from "vitest";
import { parse } from "yaml";
import { projectFromFiles } from "./projectFromFiles";
import { projectToFiles } from "./projectToFiles";

const PROJECT_ID = "boutique_shop";
const base = `plugins/Artisan/projects/${PROJECT_ID}`;

const MANIFEST = `schema: module/v1
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
        material: "{cat.icon}"
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
        material: "{item.icon}"
        title: "{item.name}"
        lore:
          - "{item.lore}"
          - "§ePrix : {item.final_price} tokens"
        click:
          left:
            steps: 'open_dialog confirm_purchase with item_id="{item.id}" item_name="{item.name}" item_price="{item.final_price}"'
      - id: back
        positions: "49"
        material: ARROW
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
  [`${base}/artisan-module.yml`]: MANIFEST,
  [`${base}/lang/fr.yml`]: LANG_FR,
  [`${base}/menus/shop_main.yml`]: MENU_SHOP_MAIN,
  [`${base}/menus/shop_category.yml`]: MENU_SHOP_CATEGORY,
  [`${base}/commands/boutique.yml`]: COMMAND_BOUTIQUE,
  [`${base}/dialogs/confirm_purchase.yml`]: DIALOG_CONFIRM,
  [`${base}/boutique/shop.yml`]: SHOP_YAML,
};

// biome-ignore lint/suspicious/noExplicitAny: parsed YAML assertions
type Json = Record<string, any>;

function roundTrip(): {
  project: Project;
  out: Record<string, Json>;
  rawOut: Record<string, string>;
} {
  const project = projectFromFiles(PROJECT_ID as ProjectId, bootstrapFiles);
  const rawOut = projectToFiles(project);
  const out: Record<string, Json> = {};
  for (const [path, content] of Object.entries(rawOut)) {
    if (!path.endsWith(".yml")) continue;
    const rel = path.slice(base.length + 1);
    // lang files are emitted as YAML trees — flatten them back to dotted keys
    // so the assertions below read domain addresses, not file shape (the shape
    // itself is locked by the `nested tree` test).
    out[rel] = /^lang\//.test(rel) ? flattenLangTree(parse(content)) : (parse(content) as Json);
  }
  return { project, out, rawOut };
}

describe("projectImport round-trip (Boutique bootstrap → import → projectToFiles)", () => {
  it("moves structural title text into the document (field-local)", () => {
    const { out } = roundTrip();
    // A single plain layer whose value is a bare string re-exports as that string.
    expect(out["menus/shop_main.yml"]!.title).toBe("Boutique");
    expect(out["menus/shop_category.yml"]!.title).toBe("Boutique — {category_name}");
  });

  it("preserves every input (name/type/source ref + filter) under the canonical `inputs` key", () => {
    const { out } = roundTrip();
    expect(out["menus/shop_main.yml"]!.inputs).toEqual([
      { name: "cats", type: "list", source: { ref: "boutique:categories" } },
    ]);
    expect(out["menus/shop_category.yml"]!.inputs).toEqual([
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

    // Steps re-export structured (ADR structured-action-wire). Targets + context
    // survive the structured→domain→structured round-trip.
    const mainGrid = out["menus/shop_main.yml"]!.elements[0];
    expect(mainGrid.iterates).toEqual({ source: "cats", alias: "cat" });
    expect(mainGrid.click.left).toEqual([
      {
        open_menu: {
          menu_id: "shop_category",
          context: { category: "{cat.id}", category_name: "{cat.name}" },
        },
      },
    ]);

    const catLayers = out["menus/shop_category.yml"]!.elements;
    expect(catLayers[0].click.left).toEqual([
      {
        open_dialog: {
          dialog_id: "confirm_purchase",
          context: {
            item_id: "{item.id}",
            item_name: "{item.name}",
            item_price: "{item.final_price}",
          },
        },
      },
    ]);
    expect(catLayers[1].click.left).toEqual([{ open_menu: "shop_main" }]);

    expect(out["commands/boutique.yml"]!.actions).toEqual([{ open_menu: "shop_main" }]);

    const buttons = out["dialogs/confirm_purchase.yml"]!.buttons;
    expect(buttons[0].actions).toEqual([{ run_command: "boutique:buy {item_id}" }]);
    expect(buttons[1].actions).toEqual([{ open_menu: "shop_category" }]);
  });

  it("keeps only siteless presentation keys in lang/fr.yml", () => {
    const { out } = roundTrip();
    const fr = out["lang/fr.yml"] ?? {};
    // Structural bootstrap keys moved field-local into the documents.
    expect(fr["boutique.shop_main.title"]).toBeUndefined();
    expect(fr["boutique.shop_category.title"]).toBeUndefined();
    // `fr` is the default language, so its file is seeded with the presentation
    // defaults — and nothing else.
    expect(Object.keys(fr).every((k) => k.startsWith("artisan."))).toBe(true);
  });

  it("keeps lang/fr.yml a nested tree, not one dotted key per line", () => {
    const { rawOut } = roundTrip();
    const raw = rawOut[`${base}/lang/fr.yml`]!;
    expect(raw).toMatch(/^artisan:$/m);
    expect(raw).not.toMatch(/^boutique\./m);
    expect((parse(raw) as Json).artisan.duration.days).toBe("{n}d");
  });

  it("keeps literal appearance text field-local in the document", () => {
    const { out } = roundTrip();
    // A literal element title is inlined as-is (placeholders intact), not keyed.
    expect(out["menus/shop_main.yml"]!.elements[0].title).toBe("{cat.name}");
  });

  it("re-emits unclaimed module files (boutique/shop.yml) verbatim", () => {
    const { rawOut } = roundTrip();
    expect(rawOut[`${base}/boutique/shop.yml`]).toBe(SHOP_YAML);
  });
});

describe("manifest lore_max_width", () => {
  it("round-trips, and stays absent when unset", () => {
    const withWidth = {
      ...bootstrapFiles,
      [`${base}/artisan-module.yml`]: `${MANIFEST}\nlore_max_width: 240\n`,
    };
    const project = projectFromFiles(PROJECT_ID as ProjectId, withWidth);
    expect(project.loreMaxWidth).toBe(240);
    expect(parse(projectToFiles(project)[`${base}/artisan-module.yml`]!).lore_max_width).toBe(240);
    expect(parse(roundTrip().rawOut[`${base}/artisan-module.yml`]!)).not.toHaveProperty(
      "lore_max_width",
    );
  });
});

describe("manifest escape_goes_back", () => {
  it("round-trips, and stays absent when unset", () => {
    const withBack = {
      ...bootstrapFiles,
      [`${base}/artisan-module.yml`]: `${MANIFEST}
escape_goes_back: true
`,
    };
    const project = projectFromFiles(PROJECT_ID as ProjectId, withBack);
    expect(project.escapeGoesBack).toBe(true);
    expect(parse(projectToFiles(project)[`${base}/artisan-module.yml`]!).escape_goes_back).toBe(
      true,
    );
    expect(parse(roundTrip().rawOut[`${base}/artisan-module.yml`]!)).not.toHaveProperty(
      "escape_goes_back",
    );
  });
});
