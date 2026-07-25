// P3 files-first (ADR files-first-source-of-truth): the file tree is the
// canonical, lossless Project representation. This suite locks the editor-side
// full-project importer `projectFromFiles` as the exact inverse of
// `transform()` — domain → files → domain → files must be a fixed point
// (total — the export is a pure function of the Project, no timestamps).
import type {
  DataModelId,
  DataSourceId,
  ItemTemplateId,
  MenuId,
  Project,
  ProjectId,
} from "@/domain/types";
import { transform } from "@/features/export/transform";
import { describe, expect, it } from "vitest";
import { projectFromFiles } from "./projectFromFiles";

const PID = "p_roundtrip" as ProjectId;
const base = `plugins/Artisan/projects/${PID}`;

function fixture(): Project {
  const now = "2026-07-24T00:00:00.000Z";
  const p = {
    id: PID,
    name: "Round Trip",
    source: "imported",
    createdAt: now,
    updatedAt: now,
    defaultLang: "en",
    i18nKeys: {
      "menus.m1.title": { en: "Shop", fr: "Boutique" },
      k_row_title: { en: "Grid row" },
      k_sword_name: { en: "Sword", fr: "Épée" },
      k_onbuy_text: { en: "Bought!" },
      k_weekly_name: { en: "Weekly" },
      k_motd: { en: "Welcome", fr: "Bienvenue" },
      k_tpl_title: { en: "{item.name}" },
      "dialogs.d1.title": { en: "Confirm" },
      k_btn_ok: { en: "OK" },
    },
    menus: [
      {
        id: "m1" as MenuId,
        projectId: PID,
        title: [{ kind: "plain", value: { key: "menus.m1.title" } }],
        rows: 3,
        contextInputs: [{ kind: "sourceRef", name: "items", ref: "pack:ds_items" }],
        layers: [
          {
            id: "l1" as never,
            name: "default",
            elements: [
              {
                id: "grid",
                positions: "10-16",
                appearances: [
                  {
                    material: "STONE",
                    title: { key: "k_row_title" },
                    click: { left: { steps: [{ kind: "action", action: { type: "open_menu", menuId: "m1" } }] } },
                  },
                ],
              },
              {
                id: "tplbound",
                positions: "20",
                appearances: [],
                iterates: { source: "items", alias: "", templateId: "tpl1" as ItemTemplateId },
              },
            ],
          },
        ],
      },
    ],
    commands: [
      {
        id: "c1" as never,
        projectId: PID,
        name: "shop",
        arguments: [{ name: "target", type: "player", required: true }],
        steps: [{ kind: "action", action: { type: "open_menu", menuId: "m1" } }],
      },
    ],
    dialogs: [
      {
        id: "d1" as never,
        projectId: PID,
        title: { key: "dialogs.d1.title" },
        canCloseWithEscape: true,
        body: [],
        inputs: [],
        buttons: [{ id: "ok", label: { key: "k_btn_ok" }, steps: [] }],
      },
    ],
    templates: [],
    itemTemplates: [
      {
        id: "tpl1" as ItemTemplateId,
        projectId: PID,
        name: "Item tile",
        sourceRef: "pack:ds_items",
        alias: "item",
        keyField: "id",
        appearances: [{ material: "{item.icon}", title: { key: "k_tpl_title" } }],
      },
    ],
    capturedItems: [
      {
        id: "ci_key" as never,
        name: "Clé Luxury",
        stackYaml: "==: org.bukkit.inventory.ItemStack\nid: minecraft:tripwire_hook\ncount: 1\n",
        display: { material: "nexo:arcanist_key", enchanted: true },
      },
    ],
    assets: [],
    dataModels: [
      {
        id: "mdl1" as DataModelId,
        name: "Shop item",
        keyField: "id",
        fields: [
          { name: "id", type: { kind: "string" } },
          { name: "name", type: { kind: "ltext" } },
          { name: "desc", type: { kind: "minimessage" } },
          { name: "price", type: { kind: "number" } },
          { name: "tags", type: { kind: "list", of: { kind: "string" } } },
          { name: "rarity", type: { kind: "enum", values: ["common", "epic"] } },
          {
            name: "on_buy",
            type: {
              kind: "union",
              tag: "type",
              variants: [
                { name: "message", fields: [{ name: "text", type: { kind: "ltext" } }] },
                { name: "command", fields: [{ name: "run", type: { kind: "string" } }] },
              ],
            },
          },
          { name: "prices", type: { kind: "map", of: { kind: "number" } } },
        ],
      },
    ],
    dataSources: [
      {
        id: "ds_items" as DataSourceId,
        name: "Shop items",
        shape: "table",
        modelId: "mdl1" as DataModelId,
        rows: [
          {
            id: "sword",
            name: { key: "k_sword_name" },
            desc: "<b>sharp</b>",
            price: 100,
            tags: ["melee"],
            rarity: "epic",
            on_buy: { type: "message", text: { key: "k_onbuy_text" } },
            prices: { gold: 100, gems: 3 },
          },
        ],
      },
      {
        id: "ds_cats" as DataSourceId,
        name: "Categories",
        shape: "table",
        modelId: "mdl1" as DataModelId,
        granularity: "row",
        rows: [
          {
            id: "weekly",
            name: { key: "k_weekly_name" },
            desc: "",
            price: 0,
            tags: [],
            rarity: "common",
            on_buy: { type: "command", run: "say weekly" },
            prices: {},
          },
        ],
      },
      {
        id: "ds_cfg" as DataSourceId,
        name: "Settings",
        shape: "config",
        fields: [
          { name: "motd", type: { kind: "ltext" } },
          { name: "discount", type: { kind: "number" } },
        ],
        value: { motd: { key: "k_motd" }, discount: 5 },
      },
    ],
    canvasLayout: { ["m1" as MenuId]: { x: 40, y: 80 } },
    canvasEdges: { "m1->d1": { from: { side: "right", t: 0.5 } } },
    moduleData: {
      shopmod: { __files: { "shop.yaml": "schema: shopmod/v1\nitems: []\n" } },
    },
  };
  return p as unknown as Project;
}

describe("projectFromFiles (files → domain, inverse of transform)", () => {
  it("is a fixed point: domain → files → domain → files", () => {
    const files1 = transform(fixture());
    const p2 = projectFromFiles(PID, transform(fixture()), { name: "Round Trip" });
    const files2 = transform(p2);
    expect(files2).toEqual(files1);
  });

  it("reconstructs table sources with model identity and LText rows", () => {
    const p2 = projectFromFiles(PID, transform(fixture()), { name: "Round Trip" });
    const table = p2.dataSources.find((d) => d.id === ("ds_items" as DataSourceId));
    expect(table).toBeDefined();
    if (table?.shape !== "table") throw new Error("expected table shape");
    expect(table.name).toBe("Shop items");
    expect(table.modelId).toBe("mdl1");
    expect(table.rows).toEqual([
      {
        id: "sword",
        name: { key: "k_sword_name" },
        desc: "<b>sharp</b>",
        price: 100,
        tags: ["melee"],
        rarity: "epic",
        on_buy: { type: "message", text: { key: "k_onbuy_text" } },
        prices: { gold: 100, gems: 3 },
      },
    ]);
    // ltext row values pull their translations back into i18nKeys.
    expect(p2.i18nKeys.k_sword_name).toEqual({ en: "Sword", fr: "Épée" });
  });

  it("reconstructs config sources with LText values", () => {
    const p2 = projectFromFiles(PID, transform(fixture()), { name: "Round Trip" });
    const cfg = p2.dataSources.find((d) => d.id === ("ds_cfg" as DataSourceId));
    if (cfg?.shape !== "config") throw new Error("expected config shape");
    expect(cfg.name).toBe("Settings");
    expect(cfg.value).toEqual({ motd: { key: "k_motd" }, discount: 5 });
    expect(cfg.fields).toEqual([
      { name: "motd", type: { kind: "ltext" } },
      { name: "discount", type: { kind: "number" } },
    ]);
  });

  it("preserves data models verbatim (minimessage kind survives via models/)", () => {
    const p2 = projectFromFiles(PID, transform(fixture()), { name: "Round Trip" });
    expect(p2.dataModels).toEqual(fixture().dataModels);
  });

  it("preserves captured item name + display through .artisan/editor.yaml", () => {
    const p2 = projectFromFiles(PID, transform(fixture()), { name: "Round Trip" });
    expect(p2.capturedItems).toEqual(fixture().capturedItems);
  });

  it("restores board state and template bindings", () => {
    const p2 = projectFromFiles(PID, transform(fixture()), { name: "Round Trip" });
    expect(p2.canvasLayout).toEqual({ m1: { x: 40, y: 80 } });
    expect(p2.canvasEdges).toEqual({ "m1->d1": { from: { side: "right", t: 0.5 } } });
    const el = p2.menus[0]!.layers.flatMap((l) => l.elements).find((e) => e.id === "tplbound")!;
    expect(el.iterates).toEqual({ source: "items", alias: "", templateId: "tpl1" });
    expect(p2.itemTemplates).toEqual(fixture().itemTemplates);
  });

  it("re-emits unclaimed module files verbatim via moduleData.__files", () => {
    const p2 = projectFromFiles(PID, transform(fixture()), { name: "Round Trip" });
    expect(p2.moduleData).toEqual({
      shopmod: { __files: { "shop.yaml": "schema: shopmod/v1\nitems: []\n" } },
    });
  });

  it("imports per-row Tables (granularity kept, rows ordered, hand-added file appended)", () => {
    const p2 = projectFromFiles(PID, transform(fixture()), { name: "Round Trip" });
    const cats = p2.dataSources.find((d) => d.id === ("ds_cats" as DataSourceId));
    if (cats?.shape !== "table") throw new Error("expected table shape");
    expect(cats.granularity).toBe("row");
    expect(cats.rows.map((r) => r.id)).toEqual(["weekly"]);

    // A row file dropped in by hand (FTP/agent), absent from _source.yaml's
    // order, is still imported — appended after the declared order.
    const files = transform(fixture());
    files[`${base}/data/ds_cats/handmade.yaml`] =
      "id: handmade\nname: sources.categories.handmade.name\ndesc: ''\nprice: 1\ntags: []\nrarity: common\non_buy: { type: command, run: say hi }\nprices: {}\n";
    const p3 = projectFromFiles(PID, files, { name: "Round Trip" });
    const cats3 = p3.dataSources.find((d) => d.id === ("ds_cats" as DataSourceId));
    if (cats3?.shape !== "table") throw new Error("expected table shape");
    expect(cats3.rows.map((r) => r.id)).toEqual(["weekly", "handmade"]);
  });

  it("derives captured item display from the stack when no .artisan meta exists (hand-added file)", () => {
    const files: Record<string, string> = {
      [`${base}/manifest.yaml`]: "schema: manifest/v1\nproject_id: p_roundtrip\ndefault_lang: en\nlanguages: [en]\nfiles:\n  menus: []\n  commands: []\n  dialogs: []\n",
      [`${base}/items/ci_hand.yml`]:
        "==: org.bukkit.inventory.ItemStack\nid: minecraft:diamond_sword\ncount: 2\n",
    };
    const p2 = projectFromFiles(PID, files, { name: "X" });
    expect(p2.capturedItems).toEqual([
      {
        id: "ci_hand",
        name: "ci_hand",
        stackYaml: files[`${base}/items/ci_hand.yml`],
        display: { material: "DIAMOND_SWORD", count: 2 },
      },
    ]);
  });
});
