import { commandId, dialogId, elementId, layerId, menuId, packId } from "@/domain/ids";
import type { Dialog, I18nKey, Pack } from "@/domain/types";
import { parse } from "yaml";
import { describe, expect, it } from "vitest";
import { transform } from "./transform";

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

  it("emits a menu yaml with i18n ref for title", () => {
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
    expect(menu.title).toBe("{i18n:menus.shop.title}");
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
