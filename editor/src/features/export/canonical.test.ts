import { elementId, layerId, menuId, projectId } from "@/domain/ids";
import type { I18nKey, Project } from "@/domain/types";
import { validateMenuV1 } from "@/schema/validateMenuV1";
import { describe, expect, it } from "vitest";
import { parse } from "yaml";
import { transform } from "./transform";

// A project exercising: plain + text title layers, multi-appearance element with
// AND and OR `if`, click step-tree with an if-case, and a spread of actions.
function goldenProject(): Project {
  return {
    id: projectId("p_gold"),
    name: "Gold",
    source: "user_created",
    createdAt: "",
    updatedAt: "",
    defaultLang: "en",
    i18nKeys: {
      "t.title": { en: "Shop" },
      "t.buy.title": { en: "Buy" },
      "t.buy.lore": { en: "Click" },
      "t.buy.msg": { en: "Bought!" },
    } as Project["i18nKeys"],
    documents: {
      menu: [
        {
          id: menuId("shop"),
          projectId: projectId("p_gold"),
          rows: 3,
          title: [{ kind: "plain", value: { key: "t.title" as I18nKey } }],
          layers: [
            {
              id: layerId("l1"),
              name: "default",
              elements: [
                {
                  id: elementId("buy"),
                  positions: "13",
                  display: {
                    if: [
                      { type: "has_permission", perm: "vip" },
                      { type: "has_money", amount: 100 },
                    ],
                    ifJoins: ["and"],
                    material: "DIAMOND",
                    title: { key: "t.buy.title" as I18nKey },
                    lore: { key: "t.buy.lore" as I18nKey },
                    click: {
                      left: {
                        steps: [
                          {
                            kind: "if",
                            cases: [
                              {
                                conditions: [{ type: "has_money", amount: 50 }],
                                steps: [
                                  { kind: "action", action: { type: "take_money", amount: 50 } },
                                ],
                              },
                            ],
                            else: [
                              {
                                kind: "action",
                                action: {
                                  type: "send_message",
                                  text: { key: "t.buy.msg" as I18nKey },
                                },
                              },
                            ],
                          },
                          {
                            kind: "action",
                            action: {
                              type: "open_menu",
                              menuId: menuId("shop"),
                              clearContext: true,
                            },
                          },
                          { kind: "action", action: { type: "paginate", direction: "next" } },
                        ],
                      },
                    },
                  },
                  states: [
                    {
                      if: [
                        { type: "has_permission", perm: "a" },
                        { type: "has_permission", perm: "b" },
                      ],
                      ifJoins: ["or"],
                      material: "STONE",
                      title: { key: "t.buy.title" as I18nKey },
                    },
                  ],
                },
              ],
            },
          ],
        },
      ],
      command: [],
      dialog: [],
    },
    assets: [],
    dataSources: [],
    importedConnectors: [],
    canvasLayout: {},
  } as Project;
}

describe("editor export conforms to canonical menu/v1", () => {
  it("every exported menu validates against the canonical schema", () => {
    const files = transform(goldenProject());
    const menuYamls = Object.entries(files).filter(([p]) => p.includes("/menus/"));
    expect(menuYamls.length).toBeGreaterThan(0);
    for (const [path, yaml] of menuYamls) {
      const menu = parse(yaml);
      const r = validateMenuV1(menu);
      expect(r.errors, `${path}: ${r.errors.join(" | ")}`).toEqual([]);
      expect(r.valid).toBe(true);
    }
  });
});
