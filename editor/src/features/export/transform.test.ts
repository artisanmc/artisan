import { commandId, dialogId, elementId, layerId, menuId, packId } from "@/domain/ids";
import type { Appearance, AssetId, Condition, Dialog, I18nKey, Pack } from "@/domain/types";
import { parse } from "yaml";
import { describe, expect, it } from "vitest";
import { parseTitleNode, transform } from "./transform";

const makePack = (overrides: Partial<Pack> = {}): Pack =>
  ({
    id: packId("p_test"),
    name: "Test",
    description: "",
    source: "user_created",
    defaultLang: "en",
    createdAt: "",
    updatedAt: "",
    i18nKeys: {},
    menus: [],
    commands: [],
    dialogs: [],
    assets: [],
    templates: [],
    canvasLayout: {},
    ...overrides,
  }) as Pack;

describe("transform", () => {
  it("emits manifest.yaml with menu and command ids", () => {
    const pack = makePack({
      menus: [
        { id: menuId("shop"), packId: packId("p_test"), rows: 3, title: [{ kind: "text", value: { key: "k" as I18nKey }, x: 8, y: 5 }], layers: [] },
      ],
      commands: [
        { id: commandId("heal"), packId: packId("p_test"), name: "heal", arguments: [], steps: [] },
      ],
    });
    const files = transform(pack);
    const manifest = parse(files["plugins/Interfaze/packs/p_test/manifest.yaml"]!);
    expect(manifest.schema).toBe("manifest/v1");
    expect(manifest.pack_id).toBe("p_test");
    expect(manifest.files.menus).toContain("shop");
    expect(manifest.files.commands).toContain("heal");
  });

  it("emits a menu yaml with title array containing the text layer", () => {
    const pack = makePack({
      i18nKeys: { "menus.shop.title": { en: "Shop" } } as Pack["i18nKeys"],
      menus: [
        {
          id: menuId("shop"),
          packId: packId("p_test"),
          rows: 3,
          title: [{ kind: "text", value: { key: "menus.shop.title" as I18nKey }, x: 8, y: 5 }],
          layers: [],
        },
      ],
    });
    const files = transform(pack);
    const menu = parse(files["plugins/Interfaze/packs/p_test/menus/shop.yaml"]!);
    expect(menu.schema).toBe("menu/v1");
    expect(menu.id).toBe("shop");
    expect(menu.size).toBe(27);
    expect(Array.isArray(menu.title)).toBe(true);
    expect(menu.title).toHaveLength(1);
    expect(menu.title[0]).toEqual({
      kind: "text",
      value: { key: "menus.shop.title" },
      x: 8,
      y: 5,
    });
  });

  it("emits element appearance with title, lore, and click steps", () => {
    const pack = makePack({
      i18nKeys: {
        "menus.shop.title": { en: "Shop" },
        "menus.shop.elements.btn.default.title": { en: "Buy" },
        "menus.shop.elements.btn.default.lore": { en: "Click here" },
        "menus.shop.elements.btn.default.click.left.message": { en: "Hello" },
      } as Pack["i18nKeys"],
      menus: [
        {
          id: menuId("shop"),
          packId: packId("p_test"),
          rows: 3,
          title: [{ kind: "text", value: { key: "menus.shop.title" as I18nKey }, x: 8, y: 5 }],
          layers: [
            {
              id: layerId("l1"),
              name: "default",
              elements: [
                {
                  id: elementId("btn"),
                  positions: "13",
                  appearances: [
                    {
                      title: { key: "menus.shop.elements.btn.default.title" as I18nKey },
                      lore: { key: "menus.shop.elements.btn.default.lore" as I18nKey },
                      click: {
                        left: {
                          steps: [
                            {
                              kind: "action",
                              action: {
                                type: "send_message",
                                text: { key: "menus.shop.elements.btn.default.click.left.message" as I18nKey },
                              },
                            },
                          ],
                        },
                      },
                    },
                  ],
                },
              ],
            },
          ],
        },
      ],
    });
    const files = transform(pack);
    const menu = parse(files["plugins/Interfaze/packs/p_test/menus/shop.yaml"]!);
    const app = menu.layers[0].elements[0].appearances[0];
    expect(app.title).toBe("{i18n:menus.shop.elements.btn.default.title}");
    expect(app.lore).toEqual(["{i18n:menus.shop.elements.btn.default.lore}"]);
    expect(app.click.left.steps[0].action.type).toBe("send_message");
    expect(app.click.left.steps[0].action.text).toBe("{i18n:menus.shop.elements.btn.default.click.left.message}");
  });

  it("serializes open_menu action with snake_case fields", () => {
    const targetId = menuId("profile");
    const pack = makePack({
      i18nKeys: { "menus.shop.title": { en: "Shop" } } as Pack["i18nKeys"],
      menus: [
        {
          id: menuId("shop"),
          packId: packId("p_test"),
          rows: 3,
          title: [{ kind: "text", value: { key: "menus.shop.title" as I18nKey }, x: 8, y: 5 }],
          layers: [
            {
              id: layerId("l1"),
              name: "default",
              elements: [
                {
                  id: elementId("btn"),
                  positions: "0",
                  appearances: [
                    {
                      click: {
                        left: {
                          steps: [
                            {
                              kind: "action",
                              action: { type: "open_menu", menuId: targetId, clearContext: true },
                            },
                          ],
                        },
                      },
                    },
                  ],
                },
              ],
            },
          ],
        },
      ],
    });
    const files = transform(pack);
    const menu = parse(files["plugins/Interfaze/packs/p_test/menus/shop.yaml"]!);
    const action = menu.layers[0].elements[0].appearances[0].click.left.steps[0].action;
    expect(action.type).toBe("open_menu");
    expect(action.menu_id).toBe("profile");
    expect(action.clear_context).toBe(true);
    expect(action.menuId).toBeUndefined();
  });

  it("emits a command yaml", () => {
    const pack = makePack({
      commands: [
        {
          id: commandId("heal"),
          packId: packId("p_test"),
          name: "heal",
          aliases: ["h"],
          arguments: [{ name: "target", type: "player", required: true }],
          steps: [],
        },
      ],
    });
    const files = transform(pack);
    const cmd = parse(files["plugins/Interfaze/packs/p_test/commands/heal.yaml"]!);
    expect(cmd.schema).toBe("command/v1");
    expect(cmd.id).toBe("heal");
    expect(cmd.name).toBe("heal");
    expect(cmd.aliases).toEqual(["h"]);
    expect(cmd.arguments[0].name).toBe("target");
  });

  it("emits one lang file per language with only referenced keys", () => {
    const pack = makePack({
      defaultLang: "en",
      i18nKeys: {
        "menus.shop.title": { en: "Shop", fr: "Boutique" },
        lt_orphan: { en: "Orphan" },
        greeting: { en: "Welcome" },
      } as Pack["i18nKeys"],
      menus: [
        {
          id: menuId("shop"),
          packId: packId("p_test"),
          rows: 3,
          title: [{ kind: "text", value: { key: "menus.shop.title" as I18nKey }, x: 8, y: 5 }],
          layers: [],
        },
      ],
    });
    const files = transform(pack);
    const en = parse(files["plugins/Interfaze/packs/p_test/lang/en.yaml"]!);
    const fr = parse(files["plugins/Interfaze/packs/p_test/lang/fr.yaml"]!);
    expect(en["menus.shop.title"]).toBe("Shop");
    expect(fr["menus.shop.title"]).toBe("Boutique");
    expect(en["lt_orphan"]).toBeUndefined();
    expect(en["greeting"]).toBeUndefined();
    expect(files["plugins/Interfaze/packs/p_test/translations.yaml"]).toBeUndefined();
  });

  it("manifest includes default_lang and languages", () => {
    const pack = makePack({
      defaultLang: "en",
      i18nKeys: {
        "menus.shop.title": { en: "Shop", fr: "Boutique" },
      } as Pack["i18nKeys"],
    });
    const files = transform(pack);
    const manifest = parse(files["plugins/Interfaze/packs/p_test/manifest.yaml"]!);
    expect(manifest.default_lang).toBe("en");
    expect(manifest.languages).toContain("en");
    expect(manifest.languages).toContain("fr");
  });

  it("emits meta.yaml with pack_id", () => {
    const pack = makePack();
    const files = transform(pack);
    const meta = parse(files["plugins/Interfaze/packs/p_test/meta.yaml"]!);
    expect(meta.pack_id).toBe("p_test");
    expect(typeof meta.exported_at).toBe("string");
  });
});

describe("transform — dialogs", () => {
  it("emits dialog yaml file", () => {
    const dialog: Dialog = {
      id: dialogId("d_test"),
      packId: packId("p_test"),
      title: { key: "dialogs.d_test.title" as I18nKey },
      canCloseWithEscape: true,
      body: [],
      inputs: [],
      buttons: [{ id: "btn_confirm", label: { key: "dialogs.d_test.buttons.btn_confirm.label" as I18nKey }, steps: [] }],
    };
    const files = transform(makePack({ dialogs: [dialog] }));
    expect(files["plugins/Interfaze/packs/p_test/dialogs/d_test.yaml"]).toBeDefined();
  });

  it("dialog yaml contains schema, id, title, can_close_with_escape", () => {
    const dialog: Dialog = {
      id: dialogId("d_test"),
      packId: packId("p_test"),
      title: { key: "dialogs.d_test.title" as I18nKey },
      canCloseWithEscape: false,
      body: [],
      inputs: [],
      buttons: [{ id: "btn_confirm", label: { key: "dialogs.d_test.buttons.btn_confirm.label" as I18nKey }, steps: [] }],
    };
    const files = transform(makePack({ dialogs: [dialog] }));
    const yaml = files["plugins/Interfaze/packs/p_test/dialogs/d_test.yaml"]!;
    expect(yaml).toContain("schema: dialog/v1");
    expect(yaml).toContain("id: d_test");
    expect(yaml).toContain("can_close_with_escape: false");
    expect(yaml).toContain("{i18n:dialogs.d_test.title}");
  });

  it("manifest includes dialogs list", () => {
    const dialog: Dialog = {
      id: dialogId("d_test"),
      packId: packId("p_test"),
      title: { key: "dialogs.d_test.title" as I18nKey },
      canCloseWithEscape: true,
      body: [],
      inputs: [],
      buttons: [{ id: "btn_confirm", label: { key: "dialogs.d_test.buttons.btn_confirm.label" as I18nKey }, steps: [] }],
    };
    const files = transform(makePack({ dialogs: [dialog] }));
    const manifest = files["plugins/Interfaze/packs/p_test/manifest.yaml"]!;
    expect(manifest).toContain("d_test");
  });

  it("button actions are serialized flat", () => {
    const dialog: Dialog = {
      id: dialogId("d_test"),
      packId: packId("p_test"),
      title: { key: "dialogs.d_test.title" as I18nKey },
      canCloseWithEscape: true,
      body: [],
      inputs: [],
      buttons: [{
        id: "btn_close",
        label: { key: "dialogs.d_test.buttons.btn_confirm.label" as I18nKey },
        steps: [{ kind: "action", action: { type: "close_dialog" } }],
      }],
    };
    const files = transform(makePack({ dialogs: [dialog] }));
    const yaml = files["plugins/Interfaze/packs/p_test/dialogs/d_test.yaml"]!;
    expect(yaml).toContain("close_dialog");
  });

  it("open_dialog action uses snake_case dialog_id", () => {
    const packWithDialog = (dialog: Dialog) => makePack({ dialogs: [dialog] });
    const pid = packId;
    const dialog: Dialog = {
      id: dialogId("d_test"),
      packId: pid("p_test"),
      title: { key: "dialogs.d_test.title" as I18nKey },
      canCloseWithEscape: true,
      body: [],
      inputs: [],
      buttons: [{
        id: "btn_open",
        label: { key: "dialogs.d_test.buttons.btn_confirm.label" as I18nKey },
        steps: [{ kind: "action", action: { type: "open_dialog", dialogId: dialogId("d_other") } }],
      }],
    };
    const files = transform(packWithDialog(dialog));
    const yaml = files["plugins/Interfaze/packs/p_test/dialogs/d_test.yaml"]!;
    expect(yaml).toContain("dialog_id: d_other");
    expect(yaml).not.toContain("dialogId");
  });
});

describe("transform — title layers", () => {
  const menuWithTitle = (title: Pack["menus"][number]["title"]): Pack =>
    makePack({
      menus: [
        {
          id: menuId("shop"),
          packId: packId("p_test"),
          rows: 3,
          title,
          layers: [],
        },
      ],
    });

  it("serializes a background layer to { kind, asset_id }", () => {
    const files = transform(
      menuWithTitle([{ kind: "background", assetId: "asset_a1b2c3" as AssetId }]),
    );
    const menu = parse(files["plugins/Interfaze/packs/p_test/menus/shop.yaml"]!);
    expect(menu.title).toEqual([
      { kind: "background", asset_id: "asset_a1b2c3" },
    ]);
  });

  it("serializes a glyph layer to { kind, asset_id, x, y }", () => {
    const files = transform(
      menuWithTitle([
        { kind: "glyph", assetId: "asset_d4e5f6" as AssetId, x: 32, y: 4 },
      ]),
    );
    const menu = parse(files["plugins/Interfaze/packs/p_test/menus/shop.yaml"]!);
    expect(menu.title).toEqual([
      { kind: "glyph", asset_id: "asset_d4e5f6", x: 32, y: 4 },
    ]);
  });

  it("serializes a text layer with only required fields when color/font are absent", () => {
    const files = transform(
      menuWithTitle([
        { kind: "text", value: { key: "k_text" as I18nKey }, x: 8, y: 5 },
      ]),
    );
    const menu = parse(files["plugins/Interfaze/packs/p_test/menus/shop.yaml"]!);
    expect(menu.title).toEqual([
      { kind: "text", value: { key: "k_text" }, x: 8, y: 5 },
    ]);
    expect(menu.title[0]).not.toHaveProperty("color");
    expect(menu.title[0]).not.toHaveProperty("font_asset_id");
  });

  it("emits color and font_asset_id on a text layer when set", () => {
    const files = transform(
      menuWithTitle([
        {
          kind: "text",
          value: { key: "k_text" as I18nKey },
          x: 8,
          y: 5,
          color: "#FFAA00",
          fontAssetId: "asset_font_xyz" as AssetId,
        },
      ]),
    );
    const menu = parse(files["plugins/Interfaze/packs/p_test/menus/shop.yaml"]!);
    expect(menu.title[0]).toEqual({
      kind: "text",
      value: { key: "k_text" },
      x: 8,
      y: 5,
      color: "#FFAA00",
      font_asset_id: "asset_font_xyz",
    });
  });

  it("serializes an external_glyph layer to { kind, provider, glyph_name, x, y }", () => {
    const files = transform(
      menuWithTitle([
        { kind: "external_glyph", provider: "oraxen", glyphName: "g_coin", x: 12, y: 6 },
      ]),
    );
    const menu = parse(files["plugins/Interfaze/packs/p_test/menus/shop.yaml"]!);
    expect(menu.title).toEqual([
      { kind: "external_glyph", provider: "oraxen", glyph_name: "g_coin", x: 12, y: 6 },
    ]);
  });

  it("preserves layer order across multi-layer titles", () => {
    const files = transform(
      menuWithTitle([
        { kind: "background", assetId: "asset_bg" as AssetId },
        { kind: "glyph", assetId: "asset_g1" as AssetId, x: 10, y: 2 },
        { kind: "text", value: { key: "k_title" as I18nKey }, x: 8, y: 5, color: "#FFAA00" },
      ]),
    );
    const menu = parse(files["plugins/Interfaze/packs/p_test/menus/shop.yaml"]!);
    expect(menu.title).toEqual([
      { kind: "background", asset_id: "asset_bg" },
      { kind: "glyph", asset_id: "asset_g1", x: 10, y: 2 },
      { kind: "text", value: { key: "k_title" }, x: 8, y: 5, color: "#FFAA00" },
    ]);
  });

  it("emits title: [] for menus with no title layers", () => {
    const files = transform(menuWithTitle([]));
    const menu = parse(files["plugins/Interfaze/packs/p_test/menus/shop.yaml"]!);
    expect(menu.title).toEqual([]);
  });

  it("round-trips through YAML stringify+parse preserving structure", () => {
    const files = transform(
      menuWithTitle([
        { kind: "background", assetId: "asset_a1b2c3" as AssetId },
        { kind: "glyph", assetId: "asset_d4e5f6" as AssetId, x: 32, y: 4 },
        { kind: "text", value: { key: "k_xyz" as I18nKey }, x: 8, y: 5, color: "#FFAA00" },
      ]),
    );
    const yaml = files["plugins/Interfaze/packs/p_test/menus/shop.yaml"]!;
    // Spot-check the YAML body explicitly for the layered shape.
    expect(yaml).toContain("title:");
    expect(yaml).toContain("kind: background");
    expect(yaml).toContain("asset_id: asset_a1b2c3");
    expect(yaml).toContain("kind: glyph");
    expect(yaml).toContain("kind: text");
    expect(yaml).toContain("key: k_xyz");
    expect(yaml).toContain("color");
    expect(yaml).toContain("#FFAA00");

    const parsed = parse(yaml);
    expect(parsed.title).toEqual([
      { kind: "background", asset_id: "asset_a1b2c3" },
      { kind: "glyph", asset_id: "asset_d4e5f6", x: 32, y: 4 },
      { kind: "text", value: { key: "k_xyz" }, x: 8, y: 5, color: "#FFAA00" },
    ]);
  });
});

describe("transform — textarea title layer", () => {
  const menuWithTitle = (title: Pack["menus"][number]["title"]): Pack =>
    makePack({
      menus: [
        {
          id: menuId("shop"),
          packId: packId("p_test"),
          rows: 3,
          title,
          layers: [],
        },
      ],
    });

  it("serializeTitleLayer emits snake_case fields for textarea with all fields", () => {
    const files = transform(
      menuWithTitle([
        {
          kind: "textarea",
          value: { key: "k_ta" as I18nKey },
          x: 12,
          y: 8,
          width: 120,
          lineHeight: 11,
          alignment: "center",
          fontAssetId: "font_a" as AssetId,
        },
      ]),
    );
    const menu = parse(files["plugins/Interfaze/packs/p_test/menus/shop.yaml"]!);
    expect(menu.title).toHaveLength(1);
    expect(menu.title[0]).toEqual({
      kind: "textarea",
      value: { key: "k_ta" },
      x: 12,
      y: 8,
      width: 120,
      line_height: 11,
      alignment: "center",
      font_asset_id: "font_a",
    });
  });

  it("serializeTitleLayer omits font_asset_id when not set", () => {
    const files = transform(
      menuWithTitle([
        {
          kind: "textarea",
          value: { key: "k_ta" as I18nKey },
          x: 0,
          y: 0,
          width: 168,
          lineHeight: 10,
          alignment: "left",
        },
      ]),
    );
    const menu = parse(files["plugins/Interfaze/packs/p_test/menus/shop.yaml"]!);
    expect(menu.title[0]).not.toHaveProperty("font_asset_id");
    expect(menu.title[0].line_height).toBe(10);
    expect(menu.title[0].alignment).toBe("left");
  });

  it("textarea i18n key is exported to lang/<lang>.yaml (regression: was silently dropped)", () => {
    // Without `textarea` in getTitleTextLayers, the key wasn't in
    // referencedKeys and the lang file came out empty — plugin then rendered
    // `<i18nKey>` literally as the title text.
    const pack = makePack({
      defaultLang: "en",
      i18nKeys: {
        k_ta: { en: "Hello\nWorld" },
      } as Pack["i18nKeys"],
      menus: [
        {
          id: menuId("shop"),
          packId: packId("p_test"),
          rows: 3,
          title: [
            {
              kind: "textarea",
              value: { key: "k_ta" as I18nKey },
              x: 8,
              y: 6,
              width: 168,
              lineHeight: 10,
              alignment: "left",
            },
          ],
          layers: [],
        },
      ],
    });
    const files = transform(pack);
    const lang = parse(files["plugins/Interfaze/packs/p_test/lang/en.yaml"]!);
    expect(lang).toEqual({ k_ta: "Hello\nWorld" });
  });
});

describe("parseTitleNode — textarea", () => {
  it("round-trips a textarea with all fields", () => {
    const result = parseTitleNode([
      {
        kind: "textarea",
        value: { key: "k_ta" },
        x: 12,
        y: 8,
        width: 120,
        line_height: 11,
        alignment: "center",
        font_asset_id: "font_a",
      },
    ]);
    expect(result).toEqual([
      {
        kind: "textarea",
        value: { key: "k_ta" },
        x: 12,
        y: 8,
        width: 120,
        lineHeight: 11,
        alignment: "center",
        fontAssetId: "font_a",
      },
    ]);
  });

  it("applies defaults when line_height and alignment are absent", () => {
    const result = parseTitleNode([
      {
        kind: "textarea",
        value: { key: "k_ta" },
        x: 0,
        y: 0,
      },
    ]);
    expect(result).toHaveLength(1);
    expect(result[0]).toMatchObject({ width: 168, lineHeight: 10, alignment: "left" });
  });

  it("falls back to left for unknown alignment value", () => {
    const result = parseTitleNode([
      {
        kind: "textarea",
        value: { key: "k_ta" },
        x: 0,
        y: 0,
        width: 168,
        line_height: 10,
        alignment: "junk",
      },
    ]);
    expect(result).toHaveLength(1);
    expect((result[0] as { alignment: string }).alignment).toBe("left");
  });

  it("rejects textarea without value.key and filters it out", () => {
    const result = parseTitleNode([
      {
        kind: "textarea",
        x: 0,
        y: 0,
        width: 168,
        line_height: 10,
        alignment: "left",
      },
    ]);
    expect(result).toEqual([]);
  });

  it("clamps line_height to [1, 32] — below minimum becomes 1", () => {
    const result = parseTitleNode([
      {
        kind: "textarea",
        value: { key: "k_ta" },
        x: 0,
        y: 0,
        width: 168,
        line_height: 0,
        alignment: "left",
      },
    ]);
    expect(result).toHaveLength(1);
    expect((result[0] as { lineHeight: number }).lineHeight).toBe(1);
  });

  it("clamps line_height to [1, 32] — above maximum becomes 32", () => {
    const result = parseTitleNode([
      {
        kind: "textarea",
        value: { key: "k_ta" },
        x: 0,
        y: 0,
        width: 168,
        line_height: 999,
        alignment: "left",
      },
    ]);
    expect(result).toHaveLength(1);
    expect((result[0] as { lineHeight: number }).lineHeight).toBe(32);
  });

  it("parseTitleNode round-trips a textarea with width", () => {
    const node = [
      {
        kind: "textarea",
        value: { key: "k1" },
        x: 0,
        y: 0,
        width: 120,
        line_height: 10,
        alignment: "left",
      },
    ];
    const layers = parseTitleNode(node);
    expect(layers[0]).toMatchObject({ kind: "textarea", width: 120 });
  });

  it("parseTitleNode defaults textarea width to 168 when absent", () => {
    const node = [
      {
        kind: "textarea",
        value: { key: "k1" },
        x: 0,
        y: 0,
        line_height: 10,
        alignment: "left",
      },
    ];
    const layers = parseTitleNode(node);
    expect(layers[0]).toMatchObject({ kind: "textarea", width: 168 });
  });

  it("parseTitleNode clamps textarea width to [8, 256]", () => {
    const tooSmall = parseTitleNode([{ kind: "textarea", value: { key: "k" }, x: 0, y: 0, width: 0 }]);
    expect(tooSmall[0]).toMatchObject({ width: 8 });
    const tooLarge = parseTitleNode([{ kind: "textarea", value: { key: "k" }, x: 0, y: 0, width: 9999 }]);
    expect(tooLarge[0]).toMatchObject({ width: 256 });
  });
});

describe("parseTitleNode — legacy reader", () => {
  it("normalises null to []", () => {
    expect(parseTitleNode(null)).toEqual([]);
  });

  it("normalises undefined to []", () => {
    expect(parseTitleNode(undefined)).toEqual([]);
  });

  it("treats a bare string as one plain (vanilla) layer", () => {
    const result = parseTitleNode("Hello");
    expect(result).toEqual([{ kind: "plain", value: { key: "Hello" } }]);
  });

  it("parses a single-layer map by wrapping it in an array", () => {
    const result = parseTitleNode({
      kind: "glyph",
      asset_id: "asset_g1",
      x: 10,
      y: 2,
    });
    expect(result).toEqual([
      { kind: "glyph", assetId: "asset_g1", x: 10, y: 2 },
    ]);
  });

  it("parses an array of layered maps preserving order", () => {
    const result = parseTitleNode([
      { kind: "background", asset_id: "asset_bg" },
      { kind: "glyph", asset_id: "asset_g1", x: 10, y: 2 },
      {
        kind: "text",
        value: { key: "k_title" },
        x: 8,
        y: 5,
        color: "#FFAA00",
        font_asset_id: "asset_font",
      },
      { kind: "external_glyph", provider: "nexo", glyph_name: "g_x", x: 1, y: 1 },
    ]);
    expect(result).toEqual([
      { kind: "background", assetId: "asset_bg" },
      { kind: "glyph", assetId: "asset_g1", x: 10, y: 2 },
      {
        kind: "text",
        value: { key: "k_title" },
        x: 8,
        y: 5,
        color: "#FFAA00",
        fontAssetId: "asset_font",
      },
      { kind: "external_glyph", provider: "nexo", glyphName: "g_x", x: 1, y: 1 },
    ]);
  });

  it("drops layers with unknown kind", () => {
    const result = parseTitleNode([
      { kind: "background", asset_id: "asset_bg" },
      { kind: "mystery", foo: "bar" },
    ]);
    expect(result).toEqual([{ kind: "background", assetId: "asset_bg" }]);
  });

  it("drops layers missing required fields", () => {
    const result = parseTitleNode([
      { kind: "background" }, // no asset_id
      { kind: "text" }, // no value.key
    ]);
    expect(result).toEqual([]);
  });
});

describe("transform — appearance conditions", () => {
  const baseMenu = (appearances: Partial<Appearance>[]) => ({
    id: menuId("shop"),
    packId: packId("p_test"),
    rows: 3 as const,
    title: [{ kind: "text" as const, value: { key: "t" as I18nKey }, x: 8, y: 5 }],
    layers: [
      {
        id: layerId("l1"),
        name: "default",
        elements: [
          {
            id: elementId("btn"),
            positions: "0",
            appearances: appearances as Appearance[],
          },
        ],
      },
    ],
  });

  const getApp = (files: Record<string, string>) => {
    const menu = parse(files["plugins/Interfaze/packs/p_test/menus/shop.yaml"]!);
    return menu.layers[0].elements[0].appearances[0];
  };

  it("single condition is written as a map, not an array", () => {
    const pack = makePack({ menus: [baseMenu([{ if: [{ type: "has_permission", perm: "vip" }] }])] });
    const app = getApp(transform(pack));
    expect(Array.isArray(app.if)).toBe(false);
    expect(app.if).toEqual({ type: "has_permission", perm: "vip" });
  });

  it("two conditions with 'and' join are wrapped in { type: 'and', all: [...] }", () => {
    const pack = makePack({
      menus: [
        baseMenu([
          {
            if: [
              { type: "has_permission", perm: "vip" } as Condition,
              { type: "has_money", amount: 100 } as Condition,
            ],
            ifJoins: ["and"],
          },
        ]),
      ],
    });
    const app = getApp(transform(pack));
    expect(app.if).toEqual({
      type: "and",
      all: [{ type: "has_permission", perm: "vip" }, { type: "has_money", amount: 100 }],
    });
    expect(app.if_joins).toBeUndefined();
  });

  it("two conditions with 'or' join are wrapped in { type: 'or', any: [...] }", () => {
    const pack = makePack({
      menus: [
        baseMenu([
          {
            if: [
              { type: "has_permission", perm: "vip" } as Condition,
              { type: "has_permission", perm: "admin" } as Condition,
            ],
            ifJoins: ["or"],
          },
        ]),
      ],
    });
    const app = getApp(transform(pack));
    expect(app.if).toEqual({
      type: "or",
      any: [{ type: "has_permission", perm: "vip" }, { type: "has_permission", perm: "admin" }],
    });
  });

  it("composite 'and' condition uses 'all' key, not 'of'", () => {
    const inner: Condition = { type: "has_permission", perm: "vip" };
    const pack = makePack({
      menus: [baseMenu([{ if: [{ type: "and", of: [inner] }] }])],
    });
    const app = getApp(transform(pack));
    expect(app.if.all).toBeDefined();
    expect(app.if.of).toBeUndefined();
  });

  it("composite 'or' condition uses 'any' key, not 'of'", () => {
    const inner: Condition = { type: "has_permission", perm: "vip" };
    const pack = makePack({
      menus: [baseMenu([{ if: [{ type: "or", of: [inner] }] }])],
    });
    const app = getApp(transform(pack));
    expect(app.if.any).toBeDefined();
    expect(app.if.of).toBeUndefined();
  });
});
