import { rekeyCommand, rekeyMenu } from "@/domain/i18nSites";
import { commandId, elementId, layerId, menuId } from "@/domain/ids";
import type { Command, I18nKey, Menu, MenuTitleLayer, Project } from "@/domain/types";
import { describe, expect, it } from "vitest";
import {
  clickHandlerKeyPrefix,
  commandKeyPrefix,
  elementLoreKey,
  elementTitleKey,
  menuTitleKey,
  messageKeyAt,
  showSubtitleKeyAt,
  showTitleKeyAt,
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

  it("showTitleKeyAt index 0 omits suffix", () => {
    expect(showTitleKeyAt("commands.heal", 0)).toBe("commands.heal.show_title");
  });

  it("showTitleKeyAt index > 0 appends counter", () => {
    expect(showTitleKeyAt("commands.heal", 1)).toBe("commands.heal.show_title_1");
    expect(showTitleKeyAt("commands.heal", 2)).toBe("commands.heal.show_title_2");
  });

  it("showSubtitleKeyAt index 0 omits suffix", () => {
    expect(showSubtitleKeyAt("commands.heal", 0)).toBe("commands.heal.show_subtitle");
  });

  it("showSubtitleKeyAt index > 0 appends counter", () => {
    expect(showSubtitleKeyAt("commands.heal", 1)).toBe("commands.heal.show_subtitle_1");
  });
});

const makeProject = (overrides: Partial<Project> = {}): Project =>
  ({
    id: "p_test" as Project["id"],
    name: "Test",
    description: "",
    source: "user_created",
    defaultLang: "en",
    createdAt: "",
    updatedAt: "",
    i18nKeys: {},
    documents: {
      menu: [],
      command: [],
    },
    assets: [],
    canvasLayout: {},
    ...overrides,
  }) as Project;

describe("rekeyMenu", () => {
  it("renames menu title key to semantic key", () => {
    const project = makeProject({ i18nKeys: { lt_abc: { en: "Shop" } } as Project["i18nKeys"] });
    const titleLayer: MenuTitleLayer = {
      kind: "text",
      value: { key: "lt_abc" as I18nKey },
      x: 8,
      y: 5,
    };
    const menu: Menu = {
      id: menuId("shop_main"),
      projectId: project.id,
      rows: 3,
      title: [titleLayer],
      layers: [],
    };

    rekeyMenu(project, menu);

    const first = menu.title[0];
    expect(first?.kind).toBe("text");
    if (first?.kind === "text") expect(first.value.key).toBe("menus.shop_main.title");
    expect(project.i18nKeys["menus.shop_main.title" as I18nKey]).toEqual({ en: "Shop" });
    expect(project.i18nKeys["lt_abc" as I18nKey]).toBeUndefined();
  });

  it("renames element title and lore keys", () => {
    const project = makeProject({
      i18nKeys: {
        lt_title: { en: "Buy" },
        lt_lore: { en: "Click to buy" },
      } as Project["i18nKeys"],
    });
    const menu: Menu = {
      id: menuId("shop"),
      projectId: project.id,
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
              display: {
                title: { key: "lt_title" as I18nKey },
                lore: { key: "lt_lore" as I18nKey },
              },
              states: [],
            },
          ],
        },
      ],
    };

    rekeyMenu(project, menu);

    const el = menu.layers[0]!.elements[0]!;
    const app = el.display!;
    expect(app.title?.key).toBe("menus.shop.elements.btn_buy.default.title");
    expect(app.lore?.key).toBe("menus.shop.elements.btn_buy.default.lore");
    expect(project.i18nKeys["lt_title" as I18nKey]).toBeUndefined();
    expect(project.i18nKeys["lt_lore" as I18nKey]).toBeUndefined();
  });

  it("is idempotent when key is already semantic", () => {
    const semanticKey = "menus.shop_main.title" as I18nKey;
    const project = makeProject({
      i18nKeys: { [semanticKey]: { en: "Shop" } } as Project["i18nKeys"],
    });
    const titleLayer: MenuTitleLayer = { kind: "text", value: { key: semanticKey }, x: 8, y: 5 };
    const menu: Menu = {
      id: menuId("shop_main"),
      projectId: project.id,
      rows: 3,
      title: [titleLayer],
      layers: [],
    };

    rekeyMenu(project, menu);

    const first = menu.title[0];
    expect(first?.kind).toBe("text");
    if (first?.kind === "text") expect(first.value.key).toBe(semanticKey);
    expect(project.i18nKeys[semanticKey]).toEqual({ en: "Shop" });
  });

  it("renames send_message keys in click handlers", () => {
    const project = makeProject({ i18nKeys: { lt_msg: { en: "Hello!" } } as Project["i18nKeys"] });
    const menu: Menu = {
      id: menuId("shop"),
      projectId: project.id,
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
              display: {
                click: {
                  left: {
                    steps: [
                      {
                        kind: "action",
                        action: { name: "send_message", value: { key: "lt_msg" as I18nKey } },
                      },
                    ],
                  },
                },
              },
              states: [],
            },
          ],
        },
      ],
    };

    rekeyMenu(project, menu);

    const action = menu.layers[0]!.elements[0]!.display!.click!.left!.steps[0]!;
    if (action.kind !== "action" || action.action.name !== "send_message")
      throw new Error("unexpected");
    expect((action.action.value as { key: string }).key).toBe(
      "menus.shop.elements.btn.default.click.left.message",
    );
    expect(project.i18nKeys["lt_msg" as I18nKey]).toBeUndefined();
  });
});

describe("rekeyCommand", () => {
  it("renames send_message keys to semantic command prefix", () => {
    const project = makeProject({ i18nKeys: { lt_msg: { en: "Healed!" } } as Project["i18nKeys"] });
    const cmd: Command = {
      id: commandId("heal"),
      projectId: project.id,
      name: "heal",
      arguments: [],
      steps: [
        { kind: "action", action: { name: "send_message", value: { key: "lt_msg" as I18nKey } } },
      ],
    };

    rekeyCommand(project, cmd);

    const action = cmd.steps[0]!;
    if (action.kind !== "action" || action.action.name !== "send_message") throw new Error();
    expect((action.action.value as { key: string }).key).toBe("commands.heal.message");
    expect(project.i18nKeys["commands.heal.message" as I18nKey]).toEqual({ en: "Healed!" });
    expect(project.i18nKeys["lt_msg" as I18nKey]).toBeUndefined();
  });

  it("disambiguates multiple send_message steps with counter suffix", () => {
    const project = makeProject({
      i18nKeys: {
        lt_1: { en: "First" },
        lt_2: { en: "Second" },
      } as Project["i18nKeys"],
    });
    const cmd: Command = {
      id: commandId("greet"),
      projectId: project.id,
      name: "greet",
      arguments: [],
      steps: [
        { kind: "action", action: { name: "send_message", value: { key: "lt_1" as I18nKey } } },
        { kind: "action", action: { name: "send_message", value: { key: "lt_2" as I18nKey } } },
      ],
    };

    rekeyCommand(project, cmd);

    const a0 = cmd.steps[0]!;
    const a1 = cmd.steps[1]!;
    if (a0.kind !== "action" || a0.action.name !== "send_message") throw new Error();
    if (a1.kind !== "action" || a1.action.name !== "send_message") throw new Error();
    expect((a0.action.value as { key: string }).key).toBe("commands.greet.message");
    expect((a1.action.value as { key: string }).key).toBe("commands.greet.message_1");
    expect(project.i18nKeys["commands.greet.message" as I18nKey]).toEqual({ en: "First" });
    expect(project.i18nKeys["commands.greet.message_1" as I18nKey]).toEqual({ en: "Second" });
  });

  it("rekeyCommand assigns canonical show_title and show_subtitle keys", () => {
    const project = makeProject({
      i18nKeys: {
        "stale.title": { en: "Welcome" },
        "stale.subtitle": { en: "to the shop" },
      } as Project["i18nKeys"],
    });
    const cmd: Command = {
      id: commandId("heal"),
      projectId: project.id,
      name: "heal",
      arguments: [],
      steps: [
        {
          kind: "action",
          action: {
            name: "show_title",
            value: {
              title: { key: "stale.title" as I18nKey },
              subtitle: { key: "stale.subtitle" as I18nKey },
            },
          },
        },
      ],
    };

    rekeyCommand(project, cmd);

    const a0 = cmd.steps[0]!;
    if (a0.kind !== "action" || a0.action.name !== "show_title") throw new Error();
    expect((a0.action.value as { title: { key: string } }).title.key).toBe(
      "commands.heal.show_title",
    );
    expect((a0.action.value as { subtitle: { key: string } }).subtitle.key).toBe(
      "commands.heal.show_subtitle",
    );
    expect(project.i18nKeys["commands.heal.show_title" as I18nKey]).toEqual({ en: "Welcome" });
    expect(project.i18nKeys["commands.heal.show_subtitle" as I18nKey]).toEqual({
      en: "to the shop",
    });
    expect(project.i18nKeys["stale.title" as I18nKey]).toBeUndefined();
    expect(project.i18nKeys["stale.subtitle" as I18nKey]).toBeUndefined();
  });

  it("rekeyCommand counts show_title and send_message independently", () => {
    const project = makeProject({
      i18nKeys: {
        lt_m1: { en: "M1" },
        lt_t1: { en: "T1" },
        lt_m2: { en: "M2" },
        lt_t2: { en: "T2" },
      } as Project["i18nKeys"],
    });
    const cmd: Command = {
      id: commandId("x"),
      projectId: project.id,
      name: "x",
      arguments: [],
      steps: [
        { kind: "action", action: { name: "send_message", value: { key: "lt_m1" as I18nKey } } },
        { kind: "action", action: { name: "show_title", value: { key: "lt_t1" as I18nKey } } },
        { kind: "action", action: { name: "send_message", value: { key: "lt_m2" as I18nKey } } },
        { kind: "action", action: { name: "show_title", value: { key: "lt_t2" as I18nKey } } },
      ],
    };

    rekeyCommand(project, cmd);

    const a0 = cmd.steps[0]!;
    const a1 = cmd.steps[1]!;
    const a2 = cmd.steps[2]!;
    const a3 = cmd.steps[3]!;
    if (a0.kind !== "action" || a0.action.name !== "send_message") throw new Error();
    if (a1.kind !== "action" || a1.action.name !== "show_title") throw new Error();
    if (a2.kind !== "action" || a2.action.name !== "send_message") throw new Error();
    if (a3.kind !== "action" || a3.action.name !== "show_title") throw new Error();
    expect((a0.action.value as { key: string }).key).toBe("commands.x.message");
    expect((a1.action.value as { key: string }).key).toBe("commands.x.show_title");
    expect((a2.action.value as { key: string }).key).toBe("commands.x.message_1");
    expect((a3.action.value as { key: string }).key).toBe("commands.x.show_title_1");
  });
});
