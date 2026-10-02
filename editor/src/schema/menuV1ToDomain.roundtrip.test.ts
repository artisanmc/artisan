import { addressedAppearances } from "@/domain/element";
import { assetId, dialogId, elementId, layerId, menuId, projectId } from "@/domain/ids";
import type {
  Appearance,
  Element,
  I18nKey,
  Layer,
  Menu,
  MenuTitleLayer,
  Project,
  SourceRef,
} from "@/domain/types";
import { serializeMenuToV1, transform } from "@/features/export/transform";
import { describe, expect, it } from "vitest";
import { parse } from "yaml";
import { menuV1ToDomain } from "./menuV1ToDomain";
import { validateMenuV1 } from "./validateMenuV1";

/**
 * Round-trip oracle: domain Menu → export (menu/v1 YAML) → re-import → assert
 * the re-imported menu is structurally and semantically equivalent.
 *
 * Constraints (per the converter contract):
 *  - Appearance `if` uses AND-joins only. An OR appearance `if` does NOT
 *    round-trip structurally: the export wraps a pure-OR list into a single
 *    `{type:"or", of:[...]}` condition, so re-import yields one composite
 *    condition with `ifJoins` all "and". We keep AND-joins in the fixture so
 *    the structure round-trips exactly.
 *  - Only domain-subset actions/conditions appear, so `unsupported` stays empty.
 *  - `translations` is fed `project.i18nKeys` so the export's `{i18n:}` refs
 *    re-resolve to the same keys + values.
 */

const PACK = projectId("p_rt");
const LANG = "en";

function lt(project: Project, value: string): { key: I18nKey } {
  const key = `lt_${Object.keys(project.i18nKeys).length}` as I18nKey;
  project.i18nKeys[key] = { en: value };
  return { key };
}

function buildProject(): Project {
  const project: Project = {
    id: PACK,
    name: "Round-trip",
    source: "user_created",
    createdAt: "2026-06-08T00:00:00.000Z",
    updatedAt: "2026-06-08T00:00:00.000Z",
    menus: [],
    commands: [],
    assets: [],
    dataSources: [],
    importedConnectors: [],
    i18nKeys: {},
    defaultLang: LANG,
    dialogs: [],
    canvasLayout: {},
  };

  const titleLayers: MenuTitleLayer[] = [
    { kind: "background", assetId: assetId("bg") },
    { kind: "glyph", assetId: assetId("g"), x: 4, y: 6 },
    {
      kind: "text",
      value: lt(project, "Shop Title"),
      x: 8,
      y: 5,
      color: "#ffffff",
      fontAssetId: assetId("font"),
      size: 16,
    },
    {
      kind: "textarea",
      value: lt(project, "Line A\nLine B"),
      x: 0,
      y: 20,
      width: 168,
      lineHeight: 10,
      alignment: "center",
    },
    { kind: "external_glyph", provider: "nexo", glyphName: "deco", x: 2, y: 2 },
  ];

  // Element 1: multi-appearance with AND-joined `if`, title + lore + click.
  const buttonAppearances: Appearance[] = [
    {
      if: [
        { type: "has_permission", perm: "vip" },
        { type: "has_money", amount: 100 },
      ],
      ifJoins: ["and"],
      material: "DIAMOND",
      count: 1,
      title: lt(project, "VIP Button"),
      lore: lt(project, "Costs money"),
      enchants: [
        { id: "sharpness", level: 5 },
        { id: "unbreaking", level: 3 },
      ],
      customModelData: "42",
      unbreakable: true,
      hide: ["attributes", "enchants"],
      nbt: "{Foo:1b}",
      click: {
        left: {
          steps: [
            {
              kind: "if",
              cases: [
                {
                  conditions: [{ type: "placeholder_equals", placeholder: "%foo%", value: "bar" }],
                  steps: [
                    { kind: "action", action: { type: "take_money", amount: 100 } },
                    {
                      kind: "action",
                      action: { type: "send_message", text: lt(project, "Purchased!") },
                    },
                  ],
                },
              ],
              else: [{ kind: "action", action: { type: "close_menu" } }],
            },
            {
              kind: "action",
              action: { type: "open_menu", menuId: menuId("other"), clearContext: true },
            },
          ],
        },
        right: {
          steps: [
            {
              kind: "action",
              action: {
                type: "show_title",
                title: lt(project, "Hi"),
                subtitle: lt(project, "There"),
                fadeIn: 5,
                stay: 20,
                fadeOut: 5,
              },
            },
          ],
        },
      },
    },
    {
      material: "PLAYER_HEAD",
      head: "playerhead:%player%",
      title: lt(project, "Fallback"),
    },
  ];

  // Element 2: iterating grid with pagination + nested condition action.
  const gridAppearances: Appearance[] = [
    {
      if: [
        { type: "expression", expr: "1 == 1" },
        { type: "has_item", material: "PAPER", count: 2 },
        { type: "time_is", range: { from_ticks: 0, to_ticks: 6000 } },
        { type: "cooldown_passed", cooldown_id: "grid_cd" },
        { type: "player_in_region", region: "shop_zone" },
        { type: "pagination_at_first", elementId: "grid" },
      ],
      material: "PAPER",
      title: lt(project, "{item.name}"),
      lore: lt(project, "Multi\nLine\nLore"),
      click: {
        left: {
          steps: [
            {
              kind: "action",
              action: { type: "paginate", direction: "next", targetElementId: elementId("grid") },
            },
            { kind: "action", action: { type: "set_arg", arg: "page", value: "2" } },
            { kind: "action", action: { type: "run_command", command: "say hi", as: "console" } },
            { kind: "action", action: { type: "open_dialog", dialogId: dialogId("confirm") } },
            { kind: "action", action: { type: "broadcast", text: lt(project, "Big news!") } },
            {
              kind: "action",
              action: {
                type: "play_sound",
                sound: "ENTITY_PLAYER_LEVELUP",
                volume: 0.5,
                pitch: 1.5,
              },
            },
            { kind: "action", action: { type: "give_money", amount: 50 } },
            { kind: "action", action: { type: "give_xp", amount: 5 } },
            { kind: "action", action: { type: "give_level", amount: 1 } },
            { kind: "action", action: { type: "take_item", material: "PAPER", count: 1 } },
            {
              kind: "action",
              action: { type: "teleport", world: "spawn", x: 0.5, y: 64, z: -3, yaw: 90 },
            },
          ],
        },
      },
    },
  ];

  const elements: Element[] = [
    {
      id: elementId("button"),
      positions: "0",
      display: buttonAppearances[1]!,
      states: [buttonAppearances[0]!],
      tags: ["featured"],
    },
    {
      id: elementId("grid"),
      positions: "9-17",
      display: { material: "PAPER", title: lt(project, "{item.name}") },
      states: [gridAppearances[0]!],
      iterates: { source: "items", alias: "item" },
    },
  ];

  const layers: Layer[] = [{ id: layerId("main"), name: "Main", elements }];

  const menu: Menu = {
    id: menuId("shop"),
    projectId: PACK,
    title: titleLayers,
    rows: 3,
    permission: "menu.shop",
    notes: "zMenu 'deposit' action had no equivalent — dropped on import.",
    layers,
    contextInputs: [
      { kind: "primitive", name: "page", type: "integer", default: "0" },
      { kind: "sourceRef", name: "items", ref: "pack:shop_items" as SourceRef },
    ],
  };

  project.menus.push(menu);
  return project;
}

/** Resolve an LText key against the import result's keys, then the project's. */
function resolve(
  importedKeys: Record<string, Record<string, string>>,
  projectKeys: Record<string, Record<string, string>>,
  key: string,
): string | undefined {
  return importedKeys[key]?.[LANG] ?? projectKeys[key]?.[LANG];
}

describe("menuV1ToDomain — round-trip oracle", () => {
  const project = buildProject();
  const original = project.menus[0]!;
  const files = transform(project);
  const menuYaml = files[`plugins/Artisan/projects/${PACK}/menus/shop.yaml`]!;
  const wire = parse(menuYaml) as Record<string, unknown>;
  // L'identité vient du NOM DE FICHIER : `projectFromFiles` l'injecte, ce test
  // court-circuite le chargement, il doit donc le faire aussi.
  const result = menuV1ToDomain(
    { ...wire, id: "shop" },
    {
      projectId: PACK,
      lang: LANG,
      translations: project.i18nKeys as Record<string, Record<string, string>>,
    },
  );
  const imported = result.menu;

  it("produces no unsupported constructs", () => {
    expect(result.unsupported).toEqual([]);
  });

  it("exports a wire object that passes the canonical menu/v1 schema", () => {
    // This is the same ajv gate the AI assistant's upsert_menu uses — if the
    // editor's own export fails it, a get_menu → upsert_menu round-trip breaks.
    const v = validateMenuV1(wire);
    expect(v.errors).toEqual([]);
    expect(v.valid).toBe(true);
  });

  it("round-trips top-level menu fields", () => {
    expect(imported.id).toBe(original.id);
    expect(imported.rows).toBe(original.rows);
    expect(imported.permission).toBe(original.permission);
    expect(imported.layers).toHaveLength(original.layers.length);
  });

  it("round-trips context inputs", () => {
    expect(imported.contextInputs).toEqual(original.contextInputs);
  });

  it("round-trips menu notes (the KB tells the AI to record drops there)", () => {
    expect(imported.notes).toBe(original.notes);
    expect(imported.notes).toContain("deposit");
  });

  it("round-trips title layer structure (kinds + non-i18n fields)", () => {
    expect(imported.title.map((l) => l.kind)).toEqual(original.title.map((l) => l.kind));
    // Spot-check a few un-snaked fields.
    const txt = imported.title.find((l) => l.kind === "text") as Extract<
      MenuTitleLayer,
      { kind: "text" }
    >;
    expect(txt.x).toBe(8);
    expect(txt.color).toBe("#ffffff");
    expect(txt.fontAssetId).toBe("font");
    expect(txt.size).toBe(16);
    const area = imported.title.find((l) => l.kind === "textarea") as Extract<
      MenuTitleLayer,
      { kind: "textarea" }
    >;
    expect(area.lineHeight).toBe(10);
    expect(area.alignment).toBe("center");
    const ext = imported.title.find((l) => l.kind === "external_glyph") as Extract<
      MenuTitleLayer,
      { kind: "external_glyph" }
    >;
    expect(ext.glyphName).toBe("deco");
  });

  it("round-trips element structure (ids, positions, iterates, tags)", () => {
    const oel = original.layers[0]!.elements;
    const iel = imported.layers[0]!.elements;
    expect(iel.map((e) => e.id)).toEqual(oel.map((e) => e.id));
    expect(iel.map((e) => e.positions)).toEqual(oel.map((e) => e.positions));
    expect(iel[1]!.iterates).toEqual(oel[1]!.iterates);
    expect(iel[0]!.tags).toEqual(oel[0]!.tags);
  });

  it("round-trips appearance conditions and ifJoins (AND-only)", () => {
    const oapp = original.layers[0]!.elements[0]!.states[0]!;
    const iapp = imported.layers[0]!.elements[0]!.states[0]!;
    expect(iapp.if).toEqual(oapp.if);
    expect(iapp.ifJoins).toEqual(oapp.ifJoins);
    expect(iapp.material).toBe("DIAMOND");
    expect(iapp.count).toBe(1);
  });

  it("round-trips the advanced item details", () => {
    const oapp = original.layers[0]!.elements[0]!.states[0]!;
    const iapp = imported.layers[0]!.elements[0]!.states[0]!;
    expect(iapp.enchants).toEqual(oapp.enchants);
    expect(iapp.customModelData).toBe("42");
    expect(iapp.unbreakable).toBe(true);
    expect(iapp.hide).toEqual(["attributes", "enchants"]);
    expect(iapp.nbt).toBe("{Foo:1b}");
  });

  it("writes enchants as a hand-writable id → level map", () => {
    const app = (wire.elements as Record<string, unknown>[])[0]!;
    const state = (app.states as Record<string, unknown>[])[0]!;
    expect(state.enchants).toEqual({ sharpness: 5, unbreaking: 3 });
  });

  it("round-trips click step-trees including if-case + else", () => {
    const oclick = original.layers[0]!.elements[0]!.states[0]!.click!;
    const iclick = imported.layers[0]!.elements[0]!.states[0]!.click!;
    // Strip LText keys (they're identity, asserted separately) by comparing the
    // structural skeleton of the left handler's first (if) step.
    const oif = oclick.left!.steps[0]!;
    const iif = iclick.left!.steps[0]!;
    expect(iif.kind).toBe("if");
    expect(oif.kind).toBe("if");
    if (iif.kind === "if" && oif.kind === "if") {
      expect(iif.cases[0]!.conditions).toEqual(oif.cases[0]!.conditions);
      expect(iif.cases[0]!.steps.map((s) => s.kind)).toEqual(
        oif.cases[0]!.steps.map((s) => s.kind),
      );
      expect(iif.else?.map((s) => s.kind)).toEqual(oif.else?.map((s) => s.kind));
    }
    // The trailing open_menu action round-trips exactly.
    expect(iclick.left!.steps[1]).toEqual(oclick.left!.steps[1]);
  });

  it("round-trips the grid pagination / set_arg / run_command / open_dialog actions", () => {
    const ihandler = imported.layers[0]!.elements[1]!.states[0]!.click!.left!;
    const ohandler = original.layers[0]!.elements[1]!.states[0]!.click!.left!;
    // Text keys are re-minted on import — compare resolved text, not key identity.
    const norm = (steps: unknown) =>
      JSON.parse(
        JSON.stringify(steps, (k, v) =>
          k === "key" && typeof v === "string"
            ? (resolve(result.i18nKeys, project.i18nKeys, v) ?? v)
            : v,
        ),
      );
    expect(norm(ihandler.steps)).toEqual(norm(ohandler.steps));
  });

  it("resolves every imported LText to the original literal value", () => {
    // Walk the imported menu's text-bearing fields and assert each resolves to
    // the same string the original project stored under that domain key.
    const pairs: Array<[string, string]> = [];

    function collectTitle(layers: MenuTitleLayer[], srcLayers: MenuTitleLayer[]) {
      for (let i = 0; i < layers.length; i++) {
        const l = layers[i]!;
        const s = srcLayers[i]!;
        if ("value" in l && "value" in s) {
          const want = resolve(
            {},
            project.i18nKeys as Record<string, Record<string, string>>,
            s.value.key,
          )!;
          const got = resolve(
            result.i18nKeys,
            project.i18nKeys as Record<string, Record<string, string>>,
            l.value.key,
          )!;
          pairs.push([got, want]);
        }
      }
    }
    collectTitle(imported.title, original.title);

    function collectApp(iapp: Appearance, oapp: Appearance) {
      if (iapp.title && oapp.title) {
        pairs.push([
          resolve(
            result.i18nKeys,
            project.i18nKeys as Record<string, Record<string, string>>,
            iapp.title.key,
          )!,
          resolve({}, project.i18nKeys as Record<string, Record<string, string>>, oapp.title.key)!,
        ]);
      }
      if (iapp.lore && oapp.lore) {
        pairs.push([
          resolve(
            result.i18nKeys,
            project.i18nKeys as Record<string, Record<string, string>>,
            iapp.lore.key,
          )!,
          resolve({}, project.i18nKeys as Record<string, Record<string, string>>, oapp.lore.key)!,
        ]);
      }
    }
    for (let li = 0; li < imported.layers.length; li++) {
      const iels = imported.layers[li]!.elements;
      const oels = original.layers[li]!.elements;
      for (let ei = 0; ei < iels.length; ei++) {
        const iapps = addressedAppearances(iels[ei]!);
        const oapps = addressedAppearances(oels[ei]!);
        for (let ai = 0; ai < iapps.length; ai++) {
          collectApp(iapps[ai]!, oapps[ai]!);
        }
      }
    }

    expect(pairs.length).toBeGreaterThan(0);
    for (const [got, want] of pairs) {
      expect(got).toBe(want);
    }
  });
});

describe("serializeMenuToV1 inventory_type", () => {
  const project = {
    id: "p",
    i18nKeys: {},
    defaultLang: "en",
    menus: [],
    commands: [],
    dialogs: [],
    // biome-ignore lint/suspicious/noExplicitAny: minimal fixture for serializer
  } as any;

  it("omits inventory_type for chest and uses size = rows*9", () => {
    // biome-ignore lint/suspicious/noExplicitAny: minimal fixture for serializer
    const menu = { id: "m", projectId: "p", title: [], rows: 3, layers: [] } as any;
    const out = serializeMenuToV1(menu, project);
    expect(out.inventory_type).toBeUndefined();
    expect(out.size).toBe(27);
  });
  it("emits inventory_type=hopper with size 5", () => {
    const menu = {
      id: "m",
      projectId: "p",
      title: [],
      rows: 1,
      inventoryType: "hopper",
      layers: [],
      // biome-ignore lint/suspicious/noExplicitAny: minimal fixture for serializer
    } as any;
    const out = serializeMenuToV1(menu, project);
    expect(out.inventory_type).toBe("hopper");
    expect(out.size).toBe(5);
  });
  it("emits inventory_type=dropper with size 9", () => {
    const menu = {
      id: "m",
      projectId: "p",
      title: [],
      rows: 3,
      inventoryType: "dropper",
      layers: [],
      // biome-ignore lint/suspicious/noExplicitAny: minimal fixture for serializer
    } as any;
    const out = serializeMenuToV1(menu, project);
    expect(out.inventory_type).toBe("dropper");
    expect(out.size).toBe(9);
  });
});

describe("inventory_type round-trip (domain -> v1 -> domain)", () => {
  const project = {
    id: "p",
    i18nKeys: {},
    defaultLang: "en",
    menus: [],
    commands: [],
    dialogs: [],
    // biome-ignore lint/suspicious/noExplicitAny: minimal fixture for round-trip
  } as any;
  for (const [type, rows, size] of [
    ["hopper", 1, 5],
    ["dropper", 3, 9],
    ["chest", 4, 36],
  ] as const) {
    it(`stable for ${type}`, () => {
      const menu = {
        id: "m",
        projectId: "p",
        title: [],
        rows,
        ...(type !== "chest" ? { inventoryType: type } : {}),
        layers: [{ id: "l", name: "L", elements: [] }],
        // biome-ignore lint/suspicious/noExplicitAny: minimal fixture for round-trip
      } as any;
      const v1 = serializeMenuToV1(menu, project);
      expect(v1.size).toBe(size);
      // biome-ignore lint/suspicious/noExplicitAny: wire object re-fed to importer
      const back = menuV1ToDomain(v1 as any, { projectId: projectId("p"), lang: "en" }).menu;
      expect(back.inventoryType).toBe(type === "chest" ? undefined : type);
      expect(back.rows).toBe(rows);
    });
  }
});

describe("player_inventory", () => {
  const project = {
    id: "p",
    i18nKeys: {},
    defaultLang: "en",
    menus: [],
    commands: [],
    dialogs: [],
    // biome-ignore lint/suspicious/noExplicitAny: minimal fixture for serializer
  } as any;

  it("round-trips hidden and omits the visible default", () => {
    const menu = menuV1ToDomain(
      { schema: "menu/v1", id: "m", title: [], size: 27, player_inventory: "hidden", elements: [] },
      { projectId: projectId("p"), lang: "en" },
    ).menu;
    expect(menu.playerInventory).toBe("hidden");
    expect(serializeMenuToV1(menu, project).player_inventory).toBe("hidden");

    const visible = menuV1ToDomain(
      {
        schema: "menu/v1",
        id: "m",
        title: [],
        size: 27,
        player_inventory: "visible",
        elements: [],
      },
      { projectId: projectId("p"), lang: "en" },
    ).menu;
    expect(visible.playerInventory).toBeUndefined();
    expect(serializeMenuToV1(visible, project).player_inventory).toBeUndefined();
  });
});

describe("vanilla_texture", () => {
  const project = {
    id: "p",
    i18nKeys: {},
    defaultLang: "en",
    menus: [],
    commands: [],
    dialogs: [],
    // biome-ignore lint/suspicious/noExplicitAny: minimal fixture for serializer
  } as any;
  const read = (extra: Record<string, unknown>) =>
    menuV1ToDomain(
      { schema: "menu/v1", id: "m", title: [], size: 27, elements: [], ...extra },
      { projectId: projectId("p"), lang: "en" },
    ).menu;

  it("round-trips a texture turned off and omits the default", () => {
    const off = read({ vanilla_texture: false });
    expect(off.vanillaTexture).toBe(false);
    expect(serializeMenuToV1(off, project).vanilla_texture).toBe(false);
    const on = read({ vanilla_texture: true });
    expect(on.vanillaTexture).toBeUndefined();
    expect(serializeMenuToV1(on, project).vanilla_texture).toBeUndefined();
  });
});
