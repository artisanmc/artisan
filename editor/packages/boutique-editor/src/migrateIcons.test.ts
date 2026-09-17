import { describe, expect, it } from "vitest";
import type { Project } from "../../../src/domain/types";
import { previewItem } from "../../../src/features/canvas/itemValuePreview";
import { migrateIcons } from "./migrateIcons";

function fixture(lore = "{item.lore}\nPrice: {item.price}"): Project {
  return {
    id: "p",
    defaultLang: "en",
    i18nKeys: { menuLore: { en: lore, fr: lore } },
    dataModels: [
      {
        id: "boutique:item",
        fields: [
          { name: "icon", type: { kind: "item" } },
          { name: "lore", type: { kind: "list", of: { kind: "ltext" } } },
        ],
      },
    ],
    dataSources: [
      {
        id: "categories",
        shape: "table",
        rows: [
          {
            id: "weapons",
            items: [
              {
                name: "Sword",
                price: 10,
                icon: { material: "STONE", lore: ["Original"] },
                lore: ["Rare"],
              },
            ],
          },
        ],
      },
    ],
    menus: [
      {
        layers: [
          {
            elements: [
              {
                iterates: { source: "products", alias: "item" },
                display: { item: "{item.icon}", lore: { key: "menuLore" } },
                states: [],
              },
            ],
          },
        ],
      },
    ],
  } as unknown as Project;
}
describe("catalogue icon migration", () => {
  it("removes empty legacy lore without adding an inheritance layer", () => {
    const project = fixture();
    const rows = (project.dataSources[0] as { rows: { items: Record<string, unknown>[] }[] })
      .rows[0]!.items;
    rows.push({ icon: "DIAMOND", lore: [] });
    migrateIcons(project);
    expect(rows[1]).toEqual({ icon: "DIAMOND" });
  });
  it("moves lore and preserves the standard template rendering, idempotently", () => {
    const project = fixture();
    const category = project.dataSources![0]! as { rows: { items: Record<string, unknown>[] }[] };
    const row = category.rows[0]!.items[0]!;
    const app = project.menus[0]!.layers[0]!.elements[0]!.display!;
    const before = previewItem(app, { item: { ...row, lore: "Rare" } }, project, "en");
    migrateIcons(project);
    expect(row.lore).toBeUndefined();
    expect(previewItem(app, { item: row }, project, "en").lore).toEqual(before.lore);
    expect(project.dataModels![0]!.fields.map((f) => f.name)).toEqual(["icon"]);
    const once = JSON.stringify(project);
    migrateIcons(project);
    expect(JSON.stringify(project)).toBe(once);
  });
  it("adapts custom consumers to explicitly place the complete icon lore", () => {
    const project = fixture("Before\n{item.lore}");
    migrateIcons(project);
    const row = (project.dataSources[0] as { rows: { items: Record<string, unknown>[] }[] })
      .rows[0]!.items[0]!;
    const app = project.menus[0]!.layers[0]!.elements[0]!.display!;
    expect(row.lore).toBeUndefined();
    expect(previewItem(app, { item: row }, project, "en").lore).toEqual([
      "Before",
      "Original",
      "Rare",
    ]);
  });
  it("moves legacy lore in a live catalogue without loaded menus", () => {
    const project = fixture();
    project.menus = [];
    migrateIcons(project);
    const row = (project.dataSources[0] as { rows: { items: Record<string, unknown>[] }[] })
      .rows[0]!.items[0]!;
    expect(row.lore).toBeUndefined();
    expect((row.icon as { lore: string[] }).lore).toEqual(["Rare"]);
    expect(project.dataModels![0]!.fields.map((f) => f.name)).toEqual(["icon"]);
  });
});
