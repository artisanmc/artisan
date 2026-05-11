import { commandId, elementId, layerId, menuId } from "@/domain/ids";
import type { Command, I18nKey, Menu, MenuTitleLayer, Pack } from "@/domain/types";
import { describe, expect, it } from "vitest";
import {
  clickHandlerKeyPrefix,
  commandKeyPrefix,
  elementLoreKey,
  elementTitleKey,
  menuTitleKey,
  messageKeyAt,
  rekeyCommandLTexts,
  rekeyMenuLTexts,
  stateLabel,
} from "./i18nKeys";

describe("key generators", () => {
  it("stateLabel returns 'default' for index 0", () => {
    expect(stateLabel(0)).toBe("default");
  });

  it("stateLabel returns 'stateN' for N > 0", () => {
    expect(stateLabel(1)).toBe("state1");
    expect(stateLabel(3)).toBe("state3");
  });

  it("menuTitleKey", () => {
    expect(menuTitleKey("shop_main")).toBe("menus.shop_main.title");
  });

  it("elementTitleKey", () => {
    expect(elementTitleKey("shop_main", "btn_buy", 0)).toBe(
      "menus.shop_main.elements.btn_buy.default.title",
    );
    expect(elementTitleKey("shop_main", "btn_buy", 2)).toBe(
      "menus.shop_main.elements.btn_buy.state2.title",
    );
  });

  it("elementLoreKey", () => {
    expect(elementLoreKey("shop_main", "btn_buy", 0)).toBe(
      "menus.shop_main.elements.btn_buy.default.lore",
    );
  });

  it("clickHandlerKeyPrefix", () => {
    expect(clickHandlerKeyPrefix("shop_main", "btn_buy", 0, "LEFT")).toBe(
      "menus.shop_main.elements.btn_buy.default.click.LEFT",
    );
  });

  it("commandKeyPrefix", () => {
    expect(commandKeyPrefix("shop_open")).toBe("commands.shop_open");
  });

  it("messageKeyAt index 0 omits suffix", () => {
    expect(messageKeyAt("commands.heal", 0)).toBe("commands.heal.message");
  });

  it("messageKeyAt index > 0 appends counter", () => {
    expect(messageKeyAt("commands.heal", 1)).toBe("commands.heal.message_1");
    expect(messageKeyAt("commands.heal", 2)).toBe("commands.heal.message_2");
  });
});

const makePack = (overrides: Partial<Pack> = {}): Pack =>
  ({
    id: "p_test" as Pack["id"],
    name: "Test",
    description: "",
    source: "user_created",
    defaultLang: "en",
    createdAt: "",
    updatedAt: "",
    i18nKeys: {},
    menus: [],
    commands: [],
    assets: [],
    templates: [],
    canvasLayout: {},
    ...overrides,
  }) as Pack;

describe("rekeyMenuLTexts", () => {
  it("renames menu title key to semantic key", () => {
    const pack = makePack({ i18nKeys: { lt_abc: { en: "Shop" } } as Pack["i18nKeys"] });
    const titleLayer: MenuTitleLayer = { kind: "text", value: { key: "lt_abc" as I18nKey }, x: 8, y: 5 };
    const menu: Menu = {
      id: menuId("shop_main"),
      packId: pack.id,
      rows: 3,
      title: [titleLayer],
      layers: [],
    };

    rekeyMenuLTexts(pack, menu);

    const first = menu.title[0];
    expect(first?.kind).toBe("text");
    if (first?.kind === "text") expect(first.value.key).toBe("menus.shop_main.title");
    expect(pack.i18nKeys["menus.shop_main.title" as I18nKey]).toEqual({ en: "Shop" });
    expect(pack.i18nKeys["lt_abc" as I18nKey]).toBeUndefined();
  });

  it("renames element title and lore keys", () => {
    const pack = makePack({
      i18nKeys: {
        lt_title: { en: "Buy" },
        lt_lore: { en: "Click to buy" },
      } as Pack["i18nKeys"],
    });
    const menu: Menu = {
      id: menuId("shop"),
      packId: pack.id,
      rows: 3,
      title: [],
      layers: [
        {
          id: layerId("layer1"),
          name: "default",
          elements: [
            {
              id: elementId("btn_buy"),
              positions: "0",
              appearances: [
                {
                  title: { key: "lt_title" as I18nKey },
                  lore: { key: "lt_lore" as I18nKey },
                },
              ],
            },
          ],
        },
      ],
    };

    rekeyMenuLTexts(pack, menu);

    const el = menu.layers[0]!.elements[0]!;
    const app = el.appearances[0]!;
    expect(app.title?.key).toBe("menus.shop.elements.btn_buy.default.title");
    expect(app.lore?.key).toBe("menus.shop.elements.btn_buy.default.lore");
    expect(pack.i18nKeys["lt_title" as I18nKey]).toBeUndefined();
    expect(pack.i18nKeys["lt_lore" as I18nKey]).toBeUndefined();
  });

  it("is idempotent when key is already semantic", () => {
    const semanticKey = "menus.shop_main.title" as I18nKey;
    const pack = makePack({ i18nKeys: { [semanticKey]: { en: "Shop" } } as Pack["i18nKeys"] });
    const titleLayer: MenuTitleLayer = { kind: "text", value: { key: semanticKey }, x: 8, y: 5 };
    const menu: Menu = {
      id: menuId("shop_main"),
      packId: pack.id,
      rows: 3,
      title: [titleLayer],
      layers: [],
    };

    rekeyMenuLTexts(pack, menu);

    const first = menu.title[0];
    expect(first?.kind).toBe("text");
    if (first?.kind === "text") expect(first.value.key).toBe(semanticKey);
    expect(pack.i18nKeys[semanticKey]).toEqual({ en: "Shop" });
  });

  it("renames send_message keys in click handlers", () => {
    const pack = makePack({ i18nKeys: { lt_msg: { en: "Hello!" } } as Pack["i18nKeys"] });
    const menu: Menu = {
      id: menuId("shop"),
      packId: pack.id,
      rows: 3,
      title: [],
      layers: [
        {
          id: layerId("layer1"),
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
                        { kind: "action", action: { type: "send_message", text: { key: "lt_msg" as I18nKey } } },
                      ],
                    },
                  },
                },
              ],
            },
          ],
        },
      ],
    };

    rekeyMenuLTexts(pack, menu);

    const action = menu.layers[0]!.elements[0]!.appearances[0]!.click!.left!.steps[0]!;
    if (action.kind !== "action" || action.action.type !== "send_message") throw new Error("unexpected");
    expect(action.action.text.key).toBe("menus.shop.elements.btn.default.click.left.message");
    expect(pack.i18nKeys["lt_msg" as I18nKey]).toBeUndefined();
  });
});

describe("rekeyCommandLTexts", () => {
  it("renames send_message keys to semantic command prefix", () => {
    const pack = makePack({ i18nKeys: { lt_msg: { en: "Healed!" } } as Pack["i18nKeys"] });
    const cmd: Command = {
      id: commandId("heal"),
      packId: pack.id,
      name: "heal",
      arguments: [],
      steps: [
        { kind: "action", action: { type: "send_message", text: { key: "lt_msg" as I18nKey } } },
      ],
    };

    rekeyCommandLTexts(pack, cmd);

    const action = cmd.steps[0]!;
    if (action.kind !== "action" || action.action.type !== "send_message") throw new Error();
    expect(action.action.text.key).toBe("commands.heal.message");
    expect(pack.i18nKeys["commands.heal.message" as I18nKey]).toEqual({ en: "Healed!" });
    expect(pack.i18nKeys["lt_msg" as I18nKey]).toBeUndefined();
  });

  it("disambiguates multiple send_message steps with counter suffix", () => {
    const pack = makePack({
      i18nKeys: {
        lt_1: { en: "First" },
        lt_2: { en: "Second" },
      } as Pack["i18nKeys"],
    });
    const cmd: Command = {
      id: commandId("greet"),
      packId: pack.id,
      name: "greet",
      arguments: [],
      steps: [
        { kind: "action", action: { type: "send_message", text: { key: "lt_1" as I18nKey } } },
        { kind: "action", action: { type: "send_message", text: { key: "lt_2" as I18nKey } } },
      ],
    };

    rekeyCommandLTexts(pack, cmd);

    const a0 = cmd.steps[0]!;
    const a1 = cmd.steps[1]!;
    if (a0.kind !== "action" || a0.action.type !== "send_message") throw new Error();
    if (a1.kind !== "action" || a1.action.type !== "send_message") throw new Error();
    expect(a0.action.text.key).toBe("commands.greet.message");
    expect(a1.action.text.key).toBe("commands.greet.message_1");
    expect(pack.i18nKeys["commands.greet.message" as I18nKey]).toEqual({ en: "First" });
    expect(pack.i18nKeys["commands.greet.message_1" as I18nKey]).toEqual({ en: "Second" });
  });
});
