import type { I18nKey, Pack } from "@/domain/types";
import {
  clickHandlerKeyPrefix,
  commandKeyPrefix,
  elementLoreKey,
  elementTitleKey,
  menuTitleKey,
  messageKeyAt,
} from "@/lib/i18nKeys";
import { findKeyUsages } from "@/lib/i18nUsages";
import { describe, expect, it } from "vitest";
import {
  type LTextSite,
  label,
  visitDialogLTexts,
  visitMenuLTexts,
  visitPackLTexts,
} from "./i18nSites";

const lt = (key: string) => ({ key: key as I18nKey });

/** A pack exercising every key-site kind, indexed messages, multi-title, and a dialog. */
function makeFixture(): Pack {
  return {
    id: "p" as Pack["id"],
    name: "Fix",
    source: "user_created",
    defaultLang: "en",
    createdAt: "",
    updatedAt: "",
    i18nKeys: {},
    assets: [],
    templates: [
      {
        id: "tpl" as never,
        packId: "p" as never,
        name: "T",
        variables: [],
        appearances: [{ title: lt("lt_tt") }],
      },
    ],
    dialogs: [
      {
        id: "dlg" as never,
        packId: "p" as never,
        title: lt("lt_dt"),
        canCloseWithEscape: true,
        body: [
          { type: "item", material: "STONE", count: 1 },
          { type: "text", text: lt("lt_db") },
        ],
        inputs: [
          { type: "text", id: "name", label: lt("lt_il"), default: "", maxLength: 16 },
          {
            type: "single_option",
            id: "color",
            label: lt("lt_ol"),
            default: "red",
            options: [{ value: "red", label: lt("lt_or") }],
          },
        ],
        buttons: [
          {
            id: "ok",
            label: lt("lt_btnl"),
            steps: [{ kind: "action", action: { type: "send_message", text: lt("lt_bm") } }],
          },
        ],
      },
    ],
    commands: [
      {
        id: "give" as never,
        packId: "p" as never,
        name: "give",
        arguments: [],
        steps: [{ kind: "action", action: { type: "send_message", text: lt("lt_cm") } }],
      },
    ],
    menus: [
      {
        id: "shop" as never,
        packId: "p" as never,
        rows: 6,
        title: [
          { kind: "background", assetId: "a" as never },
          { kind: "text", value: lt("lt_t0"), x: 0, y: 0 },
          { kind: "text", value: lt("lt_t1"), x: 0, y: 0 },
        ],
        layers: [
          {
            id: "lay" as never,
            name: "L",
            elements: [
              {
                id: "buy" as never,
                positions: "0",
                appearances: [
                  {
                    title: lt("lt_bt"),
                    lore: lt("lt_bl"),
                    click: {
                      left: {
                        steps: [
                          { kind: "action", action: { type: "send_message", text: lt("lt_m0") } },
                          { kind: "action", action: { type: "send_message", text: lt("lt_m1") } },
                          {
                            kind: "action",
                            action: {
                              type: "show_title",
                              title: lt("lt_st"),
                              subtitle: lt("lt_ss"),
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
    canvasLayout: {},
  } as unknown as Pack;
}

describe("visitPackLTexts", () => {
  const sites = [...visitPackLTexts(makeFixture())];
  const tuple = (s: LTextSite) => [s.lText.key, s.key, s.path, s.kind];

  it("emits every key site, in menus→commands→templates→dialogs order", () => {
    expect(sites.map(tuple)).toEqual([
      // menu title — two text layers: keys title / title_2, paths title[0] / title[1]
      ["lt_t0", "menus.shop.title", "menus.shop.title[0]", "menuTitle"],
      ["lt_t1", "menus.shop.title_2", "menus.shop.title[1]", "menuTitle"],
      // element appearance
      [
        "lt_bt",
        "menus.shop.elements.buy.default.title",
        "menus.shop.elements.buy.default.title",
        "appearanceTitle",
      ],
      [
        "lt_bl",
        "menus.shop.elements.buy.default.lore",
        "menus.shop.elements.buy.default.lore",
        "lore",
      ],
      // click handler steps — message index advances in key, collapses in path
      [
        "lt_m0",
        "menus.shop.elements.buy.default.click.left.message",
        "menus.shop.elements.buy.default.click.left.message",
        "message",
      ],
      [
        "lt_m1",
        "menus.shop.elements.buy.default.click.left.message_1",
        "menus.shop.elements.buy.default.click.left.message",
        "message",
      ],
      [
        "lt_st",
        "menus.shop.elements.buy.default.click.left.show_title",
        "menus.shop.elements.buy.default.click.left.show_title.title",
        "showTitle",
      ],
      [
        "lt_ss",
        "menus.shop.elements.buy.default.click.left.show_subtitle",
        "menus.shop.elements.buy.default.click.left.show_title.subtitle",
        "showSubtitle",
      ],
      // command
      ["lt_cm", "commands.give.message", "commands.give.message", "message"],
      // template appearance
      ["lt_tt", "templates.tpl.default.title", "templates.tpl.default.title", "appearanceTitle"],
      // dialog
      ["lt_dt", "dialogs.dlg.title", "dialogs.dlg.title", "dialogTitle"],
      ["lt_db", "dialogs.dlg.body.1.text", "dialogs.dlg.body[1]", "dialogBody"],
      [
        "lt_il",
        "dialogs.dlg.inputs.name.label",
        "dialogs.dlg.inputs.name.label",
        "dialogInputLabel",
      ],
      [
        "lt_ol",
        "dialogs.dlg.inputs.color.label",
        "dialogs.dlg.inputs.color.label",
        "dialogInputLabel",
      ],
      [
        "lt_or",
        "dialogs.dlg.inputs.color.options.red.label",
        "dialogs.dlg.inputs.color.options.red.label",
        "dialogOptionLabel",
      ],
      [
        "lt_btnl",
        "dialogs.dlg.buttons.ok.label",
        "dialogs.dlg.buttons.ok.label",
        "dialogButtonLabel",
      ],
      ["lt_bm", "dialogs.dlg.buttons.ok.message", "dialogs.dlg.buttons.ok.message", "message"],
    ]);
  });

  it("canonical keys match the legacy i18nKeys helpers byte-for-byte", () => {
    const byNode = new Map(sites.map((s) => [s.lText.key, s.key]));
    expect(byNode.get("lt_bt" as I18nKey)).toBe(elementTitleKey("shop", "buy", 0));
    expect(byNode.get("lt_bl" as I18nKey)).toBe(elementLoreKey("shop", "buy", 0));
    expect(byNode.get("lt_t0" as I18nKey)).toBe(menuTitleKey("shop"));
    expect(byNode.get("lt_m1" as I18nKey)).toBe(
      messageKeyAt(clickHandlerKeyPrefix("shop", "buy", 0, "left"), 1),
    );
    expect(byNode.get("lt_cm" as I18nKey)).toBe(`${commandKeyPrefix("give")}.message`);
  });

  it("yields live nodes — reassigning site.lText.key mutates the pack", () => {
    const pack = makeFixture();
    for (const s of visitMenuLTexts(pack.menus[0]!)) {
      if (s.lText.key === ("lt_m0" as I18nKey)) s.lText.key = "claimed" as I18nKey;
    }
    const handler = pack.menus[0]!.layers[0]!.elements[0]!.appearances[0]!.click!.left!;
    const firstAction = handler.steps[0]!;
    expect(firstAction.kind).toBe("action");
    if (firstAction.kind === "action" && firstAction.action.type === "send_message") {
      expect(firstAction.action.text.key).toBe("claimed");
    }
  });

  it("label(site) is the display path", () => {
    expect(label(sites[0]!)).toBe("menus.shop.title[0]");
  });
});

describe("findKeyUsages parity (guards the step-2 refold)", () => {
  it("the visitor reproduces findKeyUsages' key→path map exactly", () => {
    const pack = makeFixture();
    const fromVisitor = new Map<string, string>();
    for (const s of visitPackLTexts(pack)) fromVisitor.set(s.lText.key, s.path);
    expect(fromVisitor).toEqual(findKeyUsages(pack));
  });
});

describe("visitDialogLTexts tolerance", () => {
  it("skips item body entries and yields button step messages", () => {
    const dlg = makeFixture().dialogs[0]!;
    const kinds = [...visitDialogLTexts(dlg)].map((s) => s.kind);
    expect(kinds).toEqual([
      "dialogTitle",
      "dialogBody",
      "dialogInputLabel",
      "dialogInputLabel",
      "dialogOptionLabel",
      "dialogButtonLabel",
      "message",
    ]);
  });
});
