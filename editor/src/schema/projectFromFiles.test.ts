// P3 files-first (ADR files-first-source-of-truth): the file tree is the
// canonical, lossless Project representation. This suite locks the editor-side
// full-project importer `projectFromFiles` as the exact inverse of
// `transform()` — domain → files → domain → files must be a fixed point
// (total — the export is a pure function of the Project, no timestamps).
import type {
  DataModelId,
  DataSourceId,
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
                appearances: [{ material: "{item.icon}", title: { key: "k_tpl_title" } }],
                iterates: { source: "items", alias: "item" },
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
        masterDetail: true,
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
          {
            name: "gate",
            type: { kind: "conditions" },
            label: "Visibility",
            help: "Shown when these pass",
            section: "Display",
          },
          { name: "slot_id", type: { kind: "string" }, locked: true, required: true, pattern: "^s_" },
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
            on_buy: { type: "message", text: { key: "sources.ds_items.sword.on_buy.text" } },
            prices: { gold: 100, gems: 3 },
            gate: [{ type: "has_permission", perm: "shop.see" }],
            slot_id: "s_1",
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
            gate: [],
            slot_id: "s_2",
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
    // ltext node keys are canonicalized to their key-site address at import
    // (ADR bare-data-files ④ — the literal in the file + lang/ entries at the
    // address reconnect here).
    expect(table.rows).toEqual([
      {
        id: "sword",
        name: { key: "sources.ds_items.sword.name" },
        desc: "<b>sharp</b>",
        price: 100,
        tags: ["melee"],
        rarity: "epic",
        on_buy: { type: "message", text: { key: "sources.ds_items.sword.on_buy.text" } },
        prices: { gold: 100, gems: 3 },
        gate: [{ type: "has_permission", perm: "shop.see" }],
        slot_id: "s_1",
      },
    ]);
    // ltext row values pull their translations back into i18nKeys (under the
    // canonical address).
    expect(p2.i18nKeys["sources.ds_items.sword.name" as never]).toEqual({ en: "Sword", fr: "Épée" });
  });

  it("reconstructs config sources with LText values", () => {
    const p2 = projectFromFiles(PID, transform(fixture()), { name: "Round Trip" });
    const cfg = p2.dataSources.find((d) => d.id === ("ds_cfg" as DataSourceId));
    if (cfg?.shape !== "config") throw new Error("expected config shape");
    expect(cfg.name).toBe("Settings");
    expect(cfg.value).toEqual({ motd: { key: "sources.ds_cfg.motd" }, discount: 5 });
    expect(cfg.fields).toEqual([
      { name: "motd", type: { kind: "ltext" } },
      { name: "discount", type: { kind: "number" } },
    ]);
  });

  it("preserves data models verbatim (minimessage kind survives via models/)", () => {
    const p2 = projectFromFiles(PID, transform(fixture()), { name: "Round Trip" });
    // The config source's beside-doc also imports as a model (ADR
    // bare-data-files) — the fixture's models must survive verbatim among them.
    for (const m of fixture().dataModels ?? []) {
      expect(p2.dataModels).toContainEqual(m);
    }
  });

  it("preserves captured item name + display through .artisan/editor.yaml", () => {
    const p2 = projectFromFiles(PID, transform(fixture()), { name: "Round Trip" });
    expect(p2.capturedItems).toEqual(fixture().capturedItems);
  });

  it("restores board state and the element's own iteration binding", () => {
    const p2 = projectFromFiles(PID, transform(fixture()), { name: "Round Trip" });
    expect(p2.canvasLayout).toEqual({ m1: { x: 40, y: 80 } });
    expect(p2.canvasEdges).toEqual({ "m1->d1": { from: { side: "right", t: 0.5 } } });
    const el = p2.menus[0]!.layers.flatMap((l) => l.elements).find((e) => e.id === "tplbound")!;
    expect(el.iterates).toEqual({ source: "items", alias: "item" });
    expect(el.appearances[0]!.material).toBe("{item.icon}");
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

  /** Hand-added files go through the same reader as the capture panel — the
   *  serialized stack is the ground truth, not a set of regexes over it. */
  function handAdded(stackYaml: string) {
    const files: Record<string, string> = {
      [`${base}/manifest.yaml`]:
        "schema: manifest/v1\nproject_id: p_roundtrip\ndefault_lang: en\nlanguages: [en]\nfiles:\n  menus: []\n  commands: []\n  dialogs: []\n",
      [`${base}/items/ci_hand.yml`]: stackYaml,
    };
    return projectFromFiles(PID, files, { name: "X" }).capturedItems?.[0];
  }

  it("derives the glint from a hand-added enchanted stack", () => {
    // The real Paper shape: components encoded as a JSON string.
    const ci = handAdded(`item:
  ==: org.bukkit.inventory.ItemStack
  DataVersion: 4671
  id: minecraft:diamond_sword
  count: 1
  components:
    minecraft:enchantments: '{"minecraft:bane_of_arthropods":1}'
`);
    expect(ci?.display).toEqual({ material: "DIAMOND_SWORD", enchanted: true });
  });

  it("derives the head texture of a hand-added player head", () => {
    const ci = handAdded(`item:
  id: minecraft:player_head
  components:
    minecraft:profile: '{"properties":[{"name":"textures","value":"eyJ0ZXh0In0="}]}'
`);
    expect(ci?.display).toEqual({ material: "PLAYER_HEAD", headTexture: "eyJ0ZXh0In0=" });
  });

  it("reads a legacy Bukkit stack, name included", () => {
    const ci = handAdded(`item:
  ==: org.bukkit.inventory.ItemStack
  type: DIAMOND_SWORD
  amount: 3
  meta:
    display-name: '{"text":"Épée du roi"}'
    enchants:
      DAMAGE_ALL: 5
`);
    expect(ci?.display).toEqual({
      material: "DIAMOND_SWORD",
      count: 3,
      name: "Épée du roi",
      enchanted: true,
    });
    expect(ci?.name).toBe("Épée du roi");
  });

  it("keeps the .artisan meta authoritative over the derived descriptor", () => {
    // The editor channel records what the capture panel showed; it wins so a
    // plugin-enriched material (nexo reverse-lookup) isn't downgraded on import.
    const files = transform(fixture());
    const p2 = projectFromFiles(PID, files, { name: "Round Trip" });
    expect(p2.capturedItems?.[0]?.display).toEqual({
      material: "nexo:arcanist_key",
      enchanted: true,
    });
  });
});

// A project's disk id (the server's directory name) is unique per server only,
// so it can differ from the platform-unique internal id. Files always carry the
// DISK id: reading must not depend on the two matching, and writing must keep
// emitting the disk id or the plugin would receive a tree under a directory it
// does not use (incident 2026-08-12).
describe("disk id ≠ internal id", () => {
  const DISK = "boutique_shop";
  const INTERNAL = "proj_58967c930e9e";

  const files = {
    [`plugins/Artisan/projects/${DISK}/manifest.yaml`]:
      "schema: manifest/v1\ndefault_lang: fr\nfiles:\n  menus:\n    - shop\n",
    [`plugins/Artisan/projects/${DISK}/menus/shop.yaml`]:
      "schema: menu/v1\nid: shop\ntitle: Boutique\nsize: 27\n",
  };

  it("reads a tree prefixed with the disk id under a different internal id", () => {
    const project = projectFromFiles(INTERNAL as never, files, {
      name: "boutique_shop",
      diskId: DISK,
    });
    expect(project.id).toBe(INTERNAL);
    expect(project.diskId).toBe(DISK);
    // The menu is found — before the prefix normalisation the tree parsed empty.
    expect(project.menus.map((m) => m.id)).toEqual(["shop"]);
  });

  it("writes back under the disk id, not the internal id", () => {
    const project = projectFromFiles(INTERNAL as never, files, {
      name: "boutique_shop",
      diskId: DISK,
    });
    const out = transform(project);
    const keys = Object.keys(out.files ?? out);
    expect(keys.every((k) => k.startsWith(`plugins/Artisan/projects/${DISK}/`))).toBe(true);
    expect(keys.some((k) => k.includes(INTERNAL))).toBe(false);
  });
});
