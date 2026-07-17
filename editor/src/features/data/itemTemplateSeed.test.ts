import { describe, expect, it } from "vitest";
import type { Element, I18nKey, ItemTemplateId, Project, ProjectId } from "@/domain/types";
import { findSeedElement, seedTemplateFromElement, seedTemplateFromSchema } from "./itemTemplateSeed";

const PID = "p1" as ProjectId;
const TPL = "tpl_shop" as ItemTemplateId;

const base = {
  id: TPL,
  projectId: PID,
  name: "Vue boutique",
  sourceRef: "boutique:items",
  alias: "item",
  keyField: "id",
};

function makePack(overrides: Partial<Project> = {}): Project {
  return {
    id: PID,
    name: "p",
    source: "user_created",
    createdAt: "",
    updatedAt: "",
    menus: [],
    commands: [],
    templates: [],
    assets: [],
    dataSources: [],
    importedConnectors: [],
    i18nKeys: {},
    defaultLang: "en",
    dialogs: [],
    canvasLayout: {},
    ...overrides,
  } as Project;
}

describe("seedTemplateFromSchema", () => {
  it("derives material/title/lore from icon/name/price fields with canonical i18n keys", () => {
    const { template, i18n } = seedTemplateFromSchema(base, "en", [
      { name: "id", type: "string", description: null },
      { name: "name", type: "string", description: null },
      { name: "icon", type: "string", description: null },
      { name: "final_price", type: "integer", description: null },
    ]);
    const app = template.appearances[0]!;
    expect(app.material).toBe("{item.icon}");
    expect(app.title!.key).toBe("item_templates.tpl_shop.default.title");
    expect(app.lore!.key).toBe("item_templates.tpl_shop.default.lore");
    expect(i18n["item_templates.tpl_shop.default.title" as I18nKey]).toEqual({ en: "{item.name}" });
    expect(i18n["item_templates.tpl_shop.default.lore" as I18nKey]).toEqual({
      en: "{item.final_price}",
    });
  });

  it("falls back to CHEST + no lore when the schema declares nothing usable", () => {
    const { template, i18n } = seedTemplateFromSchema(base, "en", [
      { name: "id", type: "string", description: null },
    ]);
    const app = template.appearances[0]!;
    expect(app.material).toBe("CHEST");
    expect(app.title!.key).toBe("item_templates.tpl_shop.default.title");
    expect(i18n["item_templates.tpl_shop.default.title" as I18nKey]).toEqual({ en: "{item.id}" });
    expect(app.lore).toBeUndefined();
  });
});

describe("seedTemplateFromElement", () => {
  it("clones the element's appearances onto canonical keys, copying all languages", () => {
    const el: Element = {
      id: "grid" as never,
      positions: "10-43",
      iterates: { source: "items", alias: "row" },
      appearances: [
        {
          material: "{row.icon}",
          title: { key: "k_title" as I18nKey },
          lore: { key: "k_lore" as I18nKey },
          click: {
            left: {
              steps: [
                { kind: "action", action: { type: "run_command", command: "boutique:buy" } as never },
              ],
            },
          },
        },
      ],
    };
    const pack = makePack({
      i18nKeys: {
        ["k_title" as I18nKey]: { en: "{row.name}", fr: "{row.name} !" },
        ["k_lore" as I18nKey]: { en: "Price: {row.final_price}" },
      },
    });
    const { template, i18n } = seedTemplateFromElement(pack, el, base);
    const app = template.appearances[0]!;
    // Alias is forced to the element's own alias so placeholders keep resolving.
    expect(template.alias).toBe("row");
    expect(app.material).toBe("{row.icon}");
    expect(app.title!.key).toBe("item_templates.tpl_shop.default.title");
    expect(i18n["item_templates.tpl_shop.default.title" as I18nKey]).toEqual({
      en: "{row.name}",
      fr: "{row.name} !",
    });
    expect(i18n["item_templates.tpl_shop.default.lore" as I18nKey]).toEqual({
      en: "Price: {row.final_price}",
    });
    // Behaviour rides along — the click chain is part of the template.
    expect(app.click?.left?.steps).toHaveLength(1);
    // Source element is untouched (deep clone).
    expect(el.appearances[0]!.title!.key).toBe("k_title");
  });
});

describe("findSeedElement", () => {
  it("finds an element whose iterates/places resolves to the source ref via contextInputs", () => {
    const el: Element = {
      id: "grid" as never,
      positions: "",
      iterates: { source: "items", alias: "item" },
      appearances: [{ material: "{item.icon}" }],
    };
    const pack = makePack({
      menus: [
        {
          id: "shop" as never,
          projectId: PID,
          title: [],
          rows: 6,
          contextInputs: [{ kind: "sourceRef", name: "items", ref: "boutique:items" as never }],
          layers: [{ id: "l1" as never, name: "main", elements: [el] }],
        } as never,
      ],
    });
    expect(findSeedElement(pack, "boutique:items")?.element.id).toBe("grid");
    expect(findSeedElement(pack, "boutique:categories")).toBeNull();
  });

  it("skips elements with empty appearances", () => {
    const pack = makePack({
      menus: [
        {
          id: "shop" as never,
          projectId: PID,
          title: [],
          rows: 6,
          contextInputs: [{ kind: "sourceRef", name: "items", ref: "boutique:items" as never }],
          layers: [
            {
              id: "l1" as never,
              name: "main",
              elements: [
                { id: "empty" as never, positions: "", iterates: { source: "items", alias: "i" }, appearances: [] },
              ],
            },
          ],
        } as never,
      ],
    });
    expect(findSeedElement(pack, "boutique:items")).toBeNull();
  });
});
