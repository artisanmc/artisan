import type {
  ContextInput,
  DataSource,
  DataSourceId,
  Menu,
  Project,
  SourceRef,
} from "@/domain/types";
import { describe, expect, it } from "vitest";
import { findPreviewCallContexts } from "./previewCallContexts";

const CATS = [
  { id: "weapons", name: "Armes" },
  { id: "food", name: "Nourriture" },
];

const pack = (): Project =>
  ({
    id: "p1",
    name: "p",
    source: "user_created",
    createdAt: "",
    updatedAt: "",
    commands: [],
    templates: [],
    assets: [],
    importedConnectors: [],
    i18nKeys: {},
    defaultLang: "fr",
    canvasLayout: {},
    dataSources: [
      { id: "cats" as DataSourceId, projectId: "p1", name: "cats", type: { kind: "list" }, value: CATS },
    ] as unknown as DataSource[],
    menus: [
      {
        id: "shop_main",
        projectId: "p1",
        title: [],
        rows: 6,
        contextInputs: [
          { kind: "sourceRef", name: "categories", ref: "pack:cats" as SourceRef },
        ] as ContextInput[],
        layers: [
          {
            id: "l1",
            name: "d",
            elements: [
              {
                id: "grid",
                positions: "10-11",
                iterates: { source: "categories", alias: "cat" },
                appearances: [
                  {
                    material: "CHEST",
                    click: {
                      left: {
                        steps: [
                          {
                            kind: "action",
                            action: {
                              type: "open_menu",
                              menuId: "shop_category",
                              context: {
                                category_id: "{cat.id}",
                                category_name: "{cat.name}",
                              },
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
      {
        id: "shop_category",
        projectId: "p1",
        title: [],
        rows: 6,
        layers: [],
      },
    ],
  }) as unknown as Project;

describe("findPreviewCallContexts", () => {
  it("yields one coherent candidate per caller row, all args interpolated together", () => {
    const p = pack();
    const target = p.menus.find((m) => m.id === "shop_category") as Menu;
    const contexts = findPreviewCallContexts(target, p, undefined, "fr");
    expect(contexts).toEqual([
      {
        from: "shop_main",
        label: "Armes",
        args: { category_id: "weapons", category_name: "Armes" },
      },
      {
        from: "shop_main",
        label: "Nourriture",
        args: { category_id: "food", category_name: "Nourriture" },
      },
    ]);
  });

  it("whole-token context values pass the raw caller row object", () => {
    const p = pack();
    // Rewrite the caller's context to the whole-model style: cat: "{cat}".
    const el = p.menus[0]!.layers[0]!.elements[0]!;
    const action = el.appearances[0]!.click!.left!.steps[0]! as {
      action: { context: Record<string, string> };
    };
    action.action.context = { cat: "{cat}" };
    const target = p.menus.find((m) => m.id === "shop_category") as Menu;
    const contexts = findPreviewCallContexts(target, p, undefined, "fr");
    expect(contexts).toHaveLength(2);
    expect(contexts[0]).toEqual({
      from: "shop_main",
      label: "Armes",
      args: { cat: { id: "weapons", name: "Armes" } },
    });
  });

  it("returns nothing for a menu no one opens with context", () => {
    const p = pack();
    const target = p.menus.find((m) => m.id === "shop_main") as Menu;
    expect(findPreviewCallContexts(target, p, undefined, "fr")).toEqual([]);
  });
});
