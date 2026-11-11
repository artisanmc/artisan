import { commandId, dialogId, elementId, layerId, menuId, projectId } from "@/domain/ids";
import type {
  Appearance,
  AssetId,
  Condition,
  Dialog,
  I18nKey,
  Menu,
  Project,
} from "@/domain/types";
import { flattenLangTree } from "@/lib/langTree";
import { registerModule } from "@artisan/editor-sdk";
import { afterEach, describe, expect, it } from "vitest";
import { parse } from "yaml";
import { clearRegistry } from "../../packages/editor-sdk/src/contract/registry";
import { projectToCommandV1 } from "./commandV1FromDomain";
import { projectToDialogV1 } from "./dialogV1FromDomain";
import { projectToFiles } from "./projectToFiles";

const makeProject = (overrides: Partial<Project> = {}): Project =>
  ({
    id: projectId("p_test"),
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
      dialog: [],
    },
    assets: [],
    canvasLayout: {},
    ...overrides,
  }) as Project;

const parseEditorState = (files: Record<string, string>) => {
  const raw = files["plugins/Artisan/projects/p_test/.artisan/editor.yaml"];
  return raw === undefined ? undefined : parse(raw);
};

describe("projectToFiles", () => {
  it("exports localized presentation inside an extended item as text and translation addresses", () => {
    const project = makeProject({
      i18nKeys: {
        iconTitle: { en: "{item.name}", fr: "Article {item.name}" },
        iconLore: { en: "{base.lore}\nRare", fr: "{base.lore}\nPrécieux" },
      } as never,
      dataSources: [
        {
          id: "settings",
          name: "settings",
          shape: "config",
          fields: [{ name: "icon", type: { kind: "item" } }],
          value: {
            icon: { extends: "item:sword", title: { key: "iconTitle" }, lore: { key: "iconLore" } },
          },
        },
      ] as never,
    });
    const result = { files: projectToFiles(project) };
    expect(result.files["plugins/Artisan/projects/p_test/data/settings.yml"]).toContain(
      "{base.lore}",
    );
    expect(result.files["plugins/Artisan/projects/p_test/data/settings.yml"]).not.toContain(
      "iconLore",
    );
    expect(
      flattenLangTree(parse(result.files["plugins/Artisan/projects/p_test/lang/fr.yml"]!)),
    ).toMatchObject({
      "sources.settings.icon.title": "Article {item.name}",
      "sources.settings.icon.lore": "{base.lore}\nPrécieux",
    });
  });
  it("emits artisan-module.yml with menu and command ids", () => {
    const project = makeProject({
      documents: {
        menu: [
          {
            id: menuId("shop"),
            projectId: projectId("p_test"),
            rows: 3,
            title: [{ kind: "text", value: { key: "k" as I18nKey }, x: 8, y: 5 }],
            layers: [],
          },
        ],
        command: [
          {
            id: commandId("heal"),
            projectId: projectId("p_test"),
            name: "heal",
            arguments: [],
            steps: [],
          },
        ],
      },
    });
    const files = projectToFiles(project);
    const manifest = parse(files["plugins/Artisan/projects/p_test/artisan-module.yml"]!);
    expect(manifest.schema).toBe("module/v1");
    expect(manifest).not.toHaveProperty("project_id");
    // No `files:` block: Documents are discovered by scanning the folders, on
    // both sides. What proves they exist is the file itself.
    expect(manifest.files).toBeUndefined();
    expect(files["plugins/Artisan/projects/p_test/menus/shop.yml"]).toBeDefined();
    expect(files["plugins/Artisan/projects/p_test/commands/heal.yml"]).toBeDefined();
  });

  it("round-trips manifest.module for Add-on-owned projects", () => {
    const owned = parse(
      projectToFiles(makeProject({ ownerModule: "boutique" }))[
        "plugins/Artisan/projects/p_test/artisan-module.yml"
      ]!,
    );
    expect(owned.module).toBe("boutique");
    const plain = parse(
      projectToFiles(makeProject())["plugins/Artisan/projects/p_test/artisan-module.yml"]!,
    );
    expect(plain.module).toBeUndefined();
  });

  it("emits board layout in .artisan/editor.yaml with menu/command/dialog positions", () => {
    const project = makeProject({
      documents: {
        menu: [
          { id: menuId("shop"), projectId: projectId("p_test"), rows: 3, title: [], layers: [] },
        ],
        command: [
          {
            id: commandId("heal"),
            projectId: projectId("p_test"),
            name: "heal",
            arguments: [],
            steps: [],
          },
        ],
        dialog: [
          {
            id: dialogId("confirm"),
            projectId: projectId("p_test"),
            title: { key: "k" as I18nKey },
            canCloseWithEscape: true,
            body: [],
            inputs: [],
            buttons: [],
          } as unknown as Dialog,
        ],
      },
      canvasLayout: {
        "menu/shop": { x: 40, y: 40 },
        "command/heal": { x: 260, y: 40 },
        "dialog/confirm": { x: 480, y: 40 },
      },
    });
    const files = projectToFiles(project);
    expect(parseEditorState(files)?.layout).toEqual({
      "menu/shop": { x: 40, y: 40 },
      "command/heal": { x: 260, y: 40 },
      "dialog/confirm": { x: 480, y: 40 },
    });
  });

  it("omits .artisan/editor.yaml when canvasLayout is empty", () => {
    const project = makeProject({
      documents: {
        menu: [
          { id: menuId("shop"), projectId: projectId("p_test"), rows: 3, title: [], layers: [] },
        ],
      },
      canvasLayout: {},
    });
    const files = projectToFiles(project);
    expect(parseEditorState(files)).toBeUndefined();
  });

  it("serializes an element in placement mode with key_field (no per-placement overrides)", () => {
    const project = makeProject({
      documents: {
        menu: [
          {
            id: menuId("shop"),
            projectId: projectId("p_test"),
            rows: 6,
            title: [],
            contextInputs: [{ kind: "sourceRef", name: "items", ref: "boutique:items" as never }],
            layers: [
              {
                id: layerId("main"),
                name: "Main",
                elements: [
                  {
                    id: elementId("grid"),
                    positions: "",
                    display: { material: "{item.icon}", title: { key: "k" as I18nKey } },
                    states: [],
                    places: {
                      source: "items",
                      alias: "item",
                      keyField: "id",
                      placements: [
                        { key: "sword", page: 0, position: 10 },
                        { key: "apple", page: 1, position: 12 },
                      ],
                    },
                  },
                ],
              },
            ],
          },
        ],
      },
    });
    const files = projectToFiles(project);
    const menu = parse(files["plugins/Artisan/projects/p_test/menus/shop.yml"]!);
    const el = menu.elements[0];
    expect(el.iterates).toBeUndefined();
    expect(el.places).toEqual({
      source: "items",
      alias: "item",
      key_field: "id",
      placements: [
        { key: "sword", page: 0, position: 10 },
        { key: "apple", page: 1, position: 12 },
      ],
    });
  });

  it("exports captured items as verbatim stack files under items/", () => {
    const project = makeProject({
      capturedItems: [
        {
          id: "ci_key" as never,
          name: "Clé Luxury",
          stackYaml: "==: org.bukkit.inventory.ItemStack\nid: minecraft:paper\n",
          display: { material: "nexo:arcanist_key" },
        },
      ],
    });
    const files = projectToFiles(project);
    // The opaque stack is the runtime truth — emitted VERBATIM, never re-serialized.
    expect(files["plugins/Artisan/projects/p_test/items/ci_key.yml"]).toBe(
      "==: org.bukkit.inventory.ItemStack\nid: minecraft:paper\n",
    );
  });

  describe("module-contributed export files", () => {
    afterEach(() => clearRegistry());

    it("includes module-contributed files in the export map", () => {
      registerModule({
        id: "boutique",
        displayName: "Boutique",
        schemaVersion: "shop/v1",
        sidebar: { icon: () => null, label: "Boutique", to: "/m/boutique" },
        routes: [],
        exportFiles: () => ({ "boutique/items.yml": "items: []" }),
      });
      const files = projectToFiles(makeProject());
      const key = Object.keys(files).find((k) => k.endsWith("/boutique/items.yml"));
      expect(key).toBeDefined();
      expect(files[key!]).toBe("items: []");
    });

    it("re-emits __files of moduleData namespaces no registered module claims", () => {
      const project = makeProject({
        moduleData: {
          boutique: { __files: { "shop.yml": "schema: boutique/v1\n", "notes/readme.txt": "hi" } },
        },
      });
      const files = projectToFiles(project);
      expect(files["plugins/Artisan/projects/p_test/boutique/shop.yml"]).toBe(
        "schema: boutique/v1\n",
      );
      expect(files["plugins/Artisan/projects/p_test/boutique/notes/readme.txt"]).toBe("hi");
    });

    it("registered module keeps authority over its namespace (exportFiles wins over __files)", () => {
      registerModule({
        id: "boutique",
        displayName: "Boutique",
        schemaVersion: "shop/v1",
        sidebar: { icon: () => null, label: "Boutique", to: "/m/boutique" },
        routes: [],
        exportFiles: () => ({ "boutique/shop.yml": "from-module" }),
      });
      const project = makeProject({
        moduleData: { boutique: { __files: { "shop.yml": "raw-bytes" } } },
      });
      const files = projectToFiles(project);
      expect(files["plugins/Artisan/projects/p_test/boutique/shop.yml"]).toBe("from-module");
    });
  });

  it("filters orphaned ids from the board layout (id no longer in project)", () => {
    const project = makeProject({
      documents: {
        menu: [
          { id: menuId("shop"), projectId: projectId("p_test"), rows: 3, title: [], layers: [] },
        ],
      },
      canvasLayout: {
        "menu/shop": { x: 40, y: 40 },
        // "ghost_menu" is NOT in menusOf(project) — stale entry, should be dropped:
        "menu/ghost_menu": { x: 999, y: 999 },
      } as Project["canvasLayout"],
    });
    const files = projectToFiles(project);
    expect(parseEditorState(files)?.layout).toEqual({ "menu/shop": { x: 40, y: 40 } });
  });

  it("emits the board layout in block-style YAML the backend round-trip test parses", () => {
    const project = makeProject({
      documents: {
        menu: [
          { id: menuId("shop"), projectId: projectId("p_test"), rows: 3, title: [], layers: [] },
        ],
      },
      canvasLayout: { "menu/shop": { x: 123, y: 456 } },
    });
    const files = projectToFiles(project);
    // The editor emits block-style YAML for nested objects (the `yaml` lib's
    // default with our yamlOpts).
    const editorYaml = files["plugins/Artisan/projects/p_test/.artisan/editor.yaml"]!;
    expect(editorYaml).toContain("layout:");
    expect(editorYaml).toContain("menu/shop:");
    expect(editorYaml).toMatch(/x:\s*123/);
    expect(editorYaml).toMatch(/y:\s*456/);
  });

  it("emits board edges in .artisan/editor.yaml with live-edge overrides", () => {
    const project = makeProject({
      documents: {
        menu: [
          { id: menuId("shop"), projectId: projectId("p_test"), rows: 3, title: [], layers: [] },
          { id: menuId("home"), projectId: projectId("p_test"), rows: 3, title: [], layers: [] },
        ],
      },
      canvasEdges: {
        "menu/home->menu/shop": { from: { side: "top", t: 0.25 }, to: { side: "left", t: 0.5 } },
      },
    });
    const files = projectToFiles(project);
    expect(parseEditorState(files)?.edges).toEqual({
      "menu/home->menu/shop": { from: { side: "top", t: 0.25 }, to: { side: "left", t: 0.5 } },
    });
  });

  it("omits board edges when canvasEdges is empty or absent", () => {
    const project = makeProject({
      documents: {
        menu: [
          { id: menuId("shop"), projectId: projectId("p_test"), rows: 3, title: [], layers: [] },
        ],
      },
    });
    const files = projectToFiles(project);
    expect(parseEditorState(files)?.edges).toBeUndefined();
  });

  it("filters board edges whose source or target is no longer in the project", () => {
    const project = makeProject({
      documents: {
        menu: [
          { id: menuId("shop"), projectId: projectId("p_test"), rows: 3, title: [], layers: [] },
          { id: menuId("home"), projectId: projectId("p_test"), rows: 3, title: [], layers: [] },
        ],
      },
      canvasEdges: {
        "menu/home->menu/shop": { from: { side: "right", t: 0.5 } },
        "menu/home->menu/ghost": { from: { side: "right", t: 0.5 } },
        "menu/ghost->menu/shop": { to: { side: "left", t: 0.5 } },
      },
    });
    const files = projectToFiles(project);
    expect(parseEditorState(files)?.edges).toEqual({
      "menu/home->menu/shop": { from: { side: "right", t: 0.5 } },
    });
  });

  it("emits a menu yaml with title array containing the text layer", () => {
    const project = makeProject({
      i18nKeys: { "menus.shop.title": { en: "Shop" } } as Project["i18nKeys"],
      documents: {
        menu: [
          {
            id: menuId("shop"),
            projectId: projectId("p_test"),
            rows: 3,
            title: [{ kind: "text", value: { key: "menus.shop.title" as I18nKey }, x: 8, y: 5 }],
            layers: [],
          },
        ],
      },
    });
    const files = projectToFiles(project);
    const menu = parse(files["plugins/Artisan/projects/p_test/menus/shop.yml"]!);
    expect(menu.schema).toBe("menu/v1");
    // The identity is the FILE NAME, not a field of the document.
    expect("id" in menu).toBe(false);
    expect(menu.size).toBe(27);
    expect(Array.isArray(menu.title)).toBe(true);
    expect(menu.title).toHaveLength(1);
    expect(menu.title[0]).toEqual({
      kind: "text",
      value: "Shop",
      x: 8,
      y: 5,
    });
  });

  it("emits element appearance with title, lore, and click steps", () => {
    const project = makeProject({
      i18nKeys: {
        "menus.shop.title": { en: "Shop" },
        "menus.shop.elements.btn.default.title": { en: "Buy" },
        "menus.shop.elements.btn.default.lore": { en: "Click here" },
        "menus.shop.elements.btn.default.click.left.message": { en: "Hello" },
      } as Project["i18nKeys"],
      documents: {
        menu: [
          {
            id: menuId("shop"),
            projectId: projectId("p_test"),
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
                    display: {
                      title: { key: "menus.shop.elements.btn.default.title" as I18nKey },
                      lore: { key: "menus.shop.elements.btn.default.lore" as I18nKey },
                      click: {
                        left: {
                          steps: [
                            {
                              kind: "action",
                              action: {
                                name: "send_message",
                                value: {
                                  key: "menus.shop.elements.btn.default.click.left.message" as I18nKey,
                                },
                              },
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
          },
        ],
      },
    });
    const files = projectToFiles(project);
    const menu = parse(files["plugins/Artisan/projects/p_test/menus/shop.yml"]!);
    const app = menu.elements[0];
    expect(app.title).toBe("Buy");
    expect(app.lore).toEqual(["Click here"]);
    // Click steps are structured (ADR structured-action-wire); text is field-local.
    expect(app.click.left).toEqual([{ send_message: "Hello" }]);
  });

  it("serializes appearance.head", () => {
    const project = makeProject({
      documents: {
        menu: [
          {
            id: menuId("shop"),
            projectId: projectId("p_test"),
            rows: 3,
            title: [],
            layers: [
              {
                id: layerId("l1"),
                name: "default",
                elements: [
                  {
                    id: elementId("btn"),
                    positions: "13",
                    display: {
                      material: "PLAYER_HEAD",
                      head: "basehead:eyJ0ZXh0dXJlcyI6e319",
                    },
                    states: [],
                  },
                ],
              },
            ],
          },
        ],
      },
    });
    const files = projectToFiles(project);
    const menu = parse(files["plugins/Artisan/projects/p_test/menus/shop.yml"]!);
    const app = menu.elements[0];
    expect(app.material).toBe("PLAYER_HEAD");
    expect(app.head).toBe("basehead:eyJ0ZXh0dXJlcyI6e319");
  });

  it("serializes show_title action with snake_case fields including all timings", () => {
    const project = makeProject({
      i18nKeys: {
        "menus.shop.title": { en: "Shop" },
        "menus.shop.elements.btn.default.click.left.show_title": { en: "Hello" },
        "menus.shop.elements.btn.default.click.left.show_subtitle": { en: "World" },
      } as Project["i18nKeys"],
      documents: {
        menu: [
          {
            id: menuId("shop"),
            projectId: projectId("p_test"),
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
                    display: {
                      click: {
                        left: {
                          steps: [
                            {
                              kind: "action",
                              action: {
                                name: "show_title",
                                value: {
                                  title: {
                                    key: "menus.shop.elements.btn.default.click.left.show_title" as I18nKey,
                                  },
                                  subtitle: {
                                    key: "menus.shop.elements.btn.default.click.left.show_subtitle" as I18nKey,
                                  },
                                  fade_in: 5,
                                  stay: 40,
                                  fade_out: 15,
                                },
                              },
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
          },
        ],
      },
    });
    const files = projectToFiles(project);
    const menu = parse(files["plugins/Artisan/projects/p_test/menus/shop.yml"]!);
    const steps = menu.elements[0].click.left;
    expect(steps).toEqual([
      { show_title: { title: "Hello", subtitle: "World", fade_in: 5, stay: 40, fade_out: 15 } },
    ]);
  });

  it("serializes show_title action omitting optional subtitle and timings", () => {
    const project = makeProject({
      i18nKeys: {
        "menus.shop.title": { en: "Shop" },
        "menus.shop.elements.btn.default.click.left.show_title": { en: "Hello" },
      } as Project["i18nKeys"],
      documents: {
        menu: [
          {
            id: menuId("shop"),
            projectId: projectId("p_test"),
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
                    display: {
                      click: {
                        left: {
                          steps: [
                            {
                              kind: "action",
                              action: {
                                name: "show_title",
                                value: {
                                  key: "menus.shop.elements.btn.default.click.left.show_title" as I18nKey,
                                },
                              },
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
          },
        ],
      },
    });
    const files = projectToFiles(project);
    const menu = parse(files["plugins/Artisan/projects/p_test/menus/shop.yml"]!);
    const steps = menu.elements[0].click.left;
    // No subtitle / timings → only the title is carried, as the bare primary.
    expect(steps).toEqual([{ show_title: "Hello" }]);
  });

  it("serializes open_menu action with snake_case fields", () => {
    const targetId = menuId("profile");
    const project = makeProject({
      i18nKeys: { "menus.shop.title": { en: "Shop" } } as Project["i18nKeys"],
      documents: {
        menu: [
          {
            id: menuId("shop"),
            projectId: projectId("p_test"),
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
                    display: {
                      click: {
                        left: {
                          steps: [
                            {
                              kind: "action",
                              action: {
                                name: "open_menu",
                                value: { menu_id: targetId, clear_context: true },
                              },
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
          },
        ],
      },
    });
    const files = projectToFiles(project);
    const menu = parse(files["plugins/Artisan/projects/p_test/menus/shop.yml"]!);
    const steps = menu.elements[0].click.left;
    expect(steps).toEqual([{ open_menu: { menu_id: "profile", clear_context: true } }]);
  });

  it("round-trips a row-model context input (type object + row_of)", () => {
    const project = makeProject({
      documents: {
        menu: [
          {
            id: menuId("shop_category"),
            projectId: projectId("p_test"),
            rows: 6,
            title: [],
            contextInputs: [
              {
                kind: "primitive",
                name: "cat",
                type: "object",
                rowOf: "boutique:categories" as never,
              },
            ],
            layers: [],
          },
        ],
      },
    });
    const files = projectToFiles(project);
    const menu = parse(files["plugins/Artisan/projects/p_test/menus/shop_category.yml"]!);
    expect(menu.inputs).toEqual([{ name: "cat", type: "object", row_of: "boutique:categories" }]);
  });

  it("serializes paginate to pagination_next/prev with element_id", () => {
    const project = makeProject({
      i18nKeys: { "menus.shop.title": { en: "Shop" } } as Project["i18nKeys"],
      documents: {
        menu: [
          {
            id: menuId("shop"),
            projectId: projectId("p_test"),
            rows: 3,
            title: [{ kind: "text", value: { key: "menus.shop.title" as I18nKey }, x: 8, y: 5 }],
            layers: [
              {
                id: layerId("l1"),
                name: "default",
                elements: [
                  {
                    id: elementId("nav"),
                    positions: "0",
                    display: {
                      click: {
                        left: {
                          steps: [
                            { kind: "action", action: { name: "pagination_next", value: null } },
                            {
                              kind: "action",
                              action: { name: "pagination_prev", value: elementId("grid") },
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
          },
        ],
      },
    });
    const files = projectToFiles(project);
    const menu = parse(files["plugins/Artisan/projects/p_test/menus/shop.yml"]!);
    const steps = menu.elements[0].click.left;
    expect(steps).toEqual([{ pagination_next: null }, { pagination_prev: "grid" }]);
  });

  it("emits a command yaml", () => {
    const project = makeProject({
      documents: {
        command: [
          {
            id: commandId("heal"),
            projectId: projectId("p_test"),
            name: "heal",
            aliases: ["h"],
            arguments: [{ name: "target", type: "player", required: true }],
            steps: [],
          },
        ],
      },
    });
    const files = projectToFiles(project);
    const cmd = parse(files["plugins/Artisan/projects/p_test/commands/heal.yml"]!);
    expect(cmd.schema).toBe("command/v1");
    expect("id" in cmd).toBe(false);
    // `name` is omitted when it equals `id`; action chain is the `actions` field.
    expect(cmd.name).toBeUndefined();
    expect("actions" in cmd).toBe(true);
    expect(cmd.steps).toBeUndefined();
    expect(cmd.aliases).toEqual(["h"]);
    expect(cmd.arguments[0].name).toBe("target");
  });

  it("emits command name only when it differs from id", () => {
    const project = makeProject({
      documents: {
        command: [
          {
            id: commandId("boutique_open"),
            projectId: projectId("p_test"),
            name: "boutique",
            arguments: [],
            steps: [],
          },
        ],
      },
    });
    const files = projectToFiles(project);
    const cmd = parse(files["plugins/Artisan/projects/p_test/commands/boutique_open.yml"]!);
    expect(cmd.name).toBe("boutique");
  });

  it("emits one lang file per language with only referenced keys", () => {
    const project = makeProject({
      defaultLang: "en",
      i18nKeys: {
        "menus.shop.title": { en: "Shop", fr: "Boutique" },
        lt_orphan: { en: "Orphan" },
        greeting: { en: "Welcome" },
      } as Project["i18nKeys"],
      documents: {
        menu: [
          {
            id: menuId("shop"),
            projectId: projectId("p_test"),
            rows: 3,
            title: [{ kind: "text", value: { key: "menus.shop.title" as I18nKey }, x: 8, y: 5 }],
            layers: [],
          },
        ],
      },
    });
    const files = projectToFiles(project);
    const en = flattenLangTree(parse(files["plugins/Artisan/projects/p_test/lang/en.yml"]!));
    const fr = flattenLangTree(parse(files["plugins/Artisan/projects/p_test/lang/fr.yml"]!));
    // Structural title travels field-local in the document, not in lang/.
    expect(en["menus.shop.title"]).toBeUndefined();
    expect(fr["menus.shop.title"]).toBeUndefined();
    // lang/ only holds siteless presentation keys now.
    expect(Object.keys(en).every((k) => k.startsWith("artisan."))).toBe(true);
    expect(en.lt_orphan).toBeUndefined();
    expect(en.greeting).toBeUndefined();
    expect(files["plugins/Artisan/projects/p_test/translations.yml"]).toBeUndefined();
  });

  it("manifest includes default_lang and languages", () => {
    const project = makeProject({
      defaultLang: "en",
      i18nKeys: {
        "menus.shop.title": { en: "Shop", fr: "Boutique" },
      } as Project["i18nKeys"],
    });
    const files = projectToFiles(project);
    const manifest = parse(files["plugins/Artisan/projects/p_test/artisan-module.yml"]!);
    expect(manifest.default_lang).toBe("en");
    expect(manifest.languages).toContain("en");
    expect(manifest.languages).toContain("fr");
  });

  it("emits no meta.yml — the export is a pure function of the Project (no timestamps)", () => {
    const project = makeProject();
    const files = projectToFiles(project);
    expect(files["plugins/Artisan/projects/p_test/meta.yml"]).toBeUndefined();
    // Determinism: two exports of the same Project are byte-identical.
    expect(projectToFiles(project)).toEqual(files);
  });
});

describe("projectToFiles — dialogs", () => {
  it("emits dialog yaml file", () => {
    const dialog: Dialog = {
      id: dialogId("d_test"),
      projectId: projectId("p_test"),
      title: { key: "dialogs.d_test.title" as I18nKey },
      canCloseWithEscape: true,
      body: [],
      inputs: [],
      buttons: [
        {
          id: "btn_confirm",
          label: { key: "dialogs.d_test.buttons.btn_confirm.label" as I18nKey },
          steps: [],
        },
      ],
    };
    const files = projectToFiles(makeProject({ documents: { dialog: [dialog] } }));
    expect(files["plugins/Artisan/projects/p_test/dialogs/d_test.yml"]).toBeDefined();
  });

  it("dialog yaml contains schema, title, can_close_with_escape — but no longer the id", () => {
    const dialog: Dialog = {
      id: dialogId("d_test"),
      projectId: projectId("p_test"),
      title: { key: "dialogs.d_test.title" as I18nKey },
      canCloseWithEscape: false,
      body: [],
      inputs: [],
      buttons: [
        {
          id: "btn_confirm",
          label: { key: "dialogs.d_test.buttons.btn_confirm.label" as I18nKey },
          steps: [],
        },
      ],
    };
    const files = projectToFiles(makeProject({ documents: { dialog: [dialog] } }));
    const yaml = files["plugins/Artisan/projects/p_test/dialogs/d_test.yml"]!;
    expect(yaml).toContain("schema: dialog/v1");
    expect(yaml).not.toContain("id: d_test");
    expect(yaml).toContain("can_close_with_escape: false");
    // Structural title is field-local — empty here (no i18nKeys entry), never a ref.
    expect(yaml).toContain('title: ""');
  });

  it("the dialog exists through its file, no longer through a manifest entry", () => {
    const dialog: Dialog = {
      id: dialogId("d_test"),
      projectId: projectId("p_test"),
      title: { key: "dialogs.d_test.title" as I18nKey },
      canCloseWithEscape: true,
      body: [],
      inputs: [],
      buttons: [
        {
          id: "btn_confirm",
          label: { key: "dialogs.d_test.buttons.btn_confirm.label" as I18nKey },
          steps: [],
        },
      ],
    };
    const files = projectToFiles(makeProject({ documents: { dialog: [dialog] } }));
    const manifest = files["plugins/Artisan/projects/p_test/artisan-module.yml"]!;
    expect(manifest).not.toContain("d_test");
    expect(files["plugins/Artisan/projects/p_test/dialogs/d_test.yml"]).toBeDefined();
  });

  it("button actions are serialized flat", () => {
    const dialog: Dialog = {
      id: dialogId("d_test"),
      projectId: projectId("p_test"),
      title: { key: "dialogs.d_test.title" as I18nKey },
      canCloseWithEscape: true,
      body: [],
      inputs: [],
      buttons: [
        {
          id: "btn_close",
          label: { key: "dialogs.d_test.buttons.btn_confirm.label" as I18nKey },
          steps: [{ kind: "action", action: { name: "close_dialog", value: null } }],
        },
      ],
    };
    const files = projectToFiles(makeProject({ documents: { dialog: [dialog] } }));
    const yaml = files["plugins/Artisan/projects/p_test/dialogs/d_test.yml"]!;
    expect(yaml).toContain("close_dialog");
  });

  it("open_dialog action uses snake_case dialog_id", () => {
    const projectWithDialog = (dialog: Dialog) => makeProject({ documents: { dialog: [dialog] } });
    const pid = projectId;
    const dialog: Dialog = {
      id: dialogId("d_test"),
      projectId: pid("p_test"),
      title: { key: "dialogs.d_test.title" as I18nKey },
      canCloseWithEscape: true,
      body: [],
      inputs: [],
      buttons: [
        {
          id: "btn_open",
          label: { key: "dialogs.d_test.buttons.btn_confirm.label" as I18nKey },
          steps: [{ kind: "action", action: { name: "open_dialog", value: dialogId("d_other") } }],
        },
      ],
    };
    const files = projectToFiles(projectWithDialog(dialog));
    const yaml = files["plugins/Artisan/projects/p_test/dialogs/d_test.yml"]!;
    // Button actions are structured: `- open_dialog: d_other`.
    expect(yaml).toContain("open_dialog: d_other");
    expect(yaml).not.toContain("dialogId");
  });
});

describe("projectToFiles — title layers", () => {
  const menuWithTitle = (title: Menu["title"]): Project =>
    makeProject({
      documents: {
        menu: [
          {
            id: menuId("shop"),
            projectId: projectId("p_test"),
            rows: 3,
            title,
            layers: [],
          },
        ],
      },
    });

  it("emits a plain-only title as a bare string (canonical sugar)", () => {
    const files = projectToFiles(
      menuWithTitle([{ kind: "plain", value: { key: "k_plain" as I18nKey } }]),
    );
    const menu = parse(files["plugins/Artisan/projects/p_test/menus/shop.yml"]!);
    // Field-local structural text: no i18nKeys entry ⇒ empty bare string.
    expect(menu.title).toBe("");
  });

  it("serializes a background layer to { kind, asset_id }", () => {
    const files = projectToFiles(
      menuWithTitle([{ kind: "background", assetId: "asset_a1b2c3" as AssetId }]),
    );
    const menu = parse(files["plugins/Artisan/projects/p_test/menus/shop.yml"]!);
    expect(menu.title).toEqual([{ kind: "background", asset_id: "asset_a1b2c3" }]);
  });

  it("serializes a glyph layer to { kind, asset_id, x, y }", () => {
    const files = projectToFiles(
      menuWithTitle([{ kind: "glyph", assetId: "asset_d4e5f6" as AssetId, x: 32, y: 4 }]),
    );
    const menu = parse(files["plugins/Artisan/projects/p_test/menus/shop.yml"]!);
    expect(menu.title).toEqual([{ kind: "glyph", asset_id: "asset_d4e5f6", x: 32, y: 4 }]);
  });

  it("serializes a text layer with only required fields when color/font are absent", () => {
    const files = projectToFiles(
      menuWithTitle([{ kind: "text", value: { key: "k_text" as I18nKey }, x: 8, y: 5 }]),
    );
    const menu = parse(files["plugins/Artisan/projects/p_test/menus/shop.yml"]!);
    expect(menu.title).toEqual([{ kind: "text", value: "", x: 8, y: 5 }]);
    expect(menu.title[0]).not.toHaveProperty("color");
    expect(menu.title[0]).not.toHaveProperty("font_asset_id");
  });

  it("emits color and font_asset_id on a text layer when set", () => {
    const files = projectToFiles(
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
    const menu = parse(files["plugins/Artisan/projects/p_test/menus/shop.yml"]!);
    expect(menu.title[0]).toEqual({
      kind: "text",
      value: "",
      x: 8,
      y: 5,
      color: "#FFAA00",
      font_asset_id: "asset_font_xyz",
    });
  });

  it("serializes an external_glyph layer to { kind, provider, glyph_name, x, y }", () => {
    const files = projectToFiles(
      menuWithTitle([
        { kind: "external_glyph", provider: "oraxen", glyphName: "g_coin", x: 12, y: 6 },
      ]),
    );
    const menu = parse(files["plugins/Artisan/projects/p_test/menus/shop.yml"]!);
    expect(menu.title).toEqual([
      { kind: "external_glyph", provider: "oraxen", glyph_name: "g_coin", x: 12, y: 6 },
    ]);
  });

  it("preserves layer order across multi-layer titles", () => {
    const files = projectToFiles(
      menuWithTitle([
        { kind: "background", assetId: "asset_bg" as AssetId },
        { kind: "glyph", assetId: "asset_g1" as AssetId, x: 10, y: 2 },
        { kind: "text", value: { key: "k_title" as I18nKey }, x: 8, y: 5, color: "#FFAA00" },
      ]),
    );
    const menu = parse(files["plugins/Artisan/projects/p_test/menus/shop.yml"]!);
    expect(menu.title).toEqual([
      { kind: "background", asset_id: "asset_bg" },
      { kind: "glyph", asset_id: "asset_g1", x: 10, y: 2 },
      { kind: "text", value: "", x: 8, y: 5, color: "#FFAA00" },
    ]);
  });

  it("emits title: [] for menus with no title layers", () => {
    const files = projectToFiles(menuWithTitle([]));
    const menu = parse(files["plugins/Artisan/projects/p_test/menus/shop.yml"]!);
    expect(menu.title).toEqual([]);
  });

  it("round-trips through YAML stringify+parse preserving structure", () => {
    const files = projectToFiles(
      menuWithTitle([
        { kind: "background", assetId: "asset_a1b2c3" as AssetId },
        { kind: "glyph", assetId: "asset_d4e5f6" as AssetId, x: 32, y: 4 },
        { kind: "text", value: { key: "k_xyz" as I18nKey }, x: 8, y: 5, color: "#FFAA00" },
      ]),
    );
    const yaml = files["plugins/Artisan/projects/p_test/menus/shop.yml"]!;
    // Spot-check the YAML body explicitly for the layered shape.
    expect(yaml).toContain("title:");
    expect(yaml).toContain("kind: background");
    expect(yaml).toContain("asset_id: asset_a1b2c3");
    expect(yaml).toContain("kind: glyph");
    expect(yaml).toContain("kind: text");
    expect(yaml).toContain('value: ""');
    expect(yaml).toContain("color");
    expect(yaml).toContain("#FFAA00");

    const parsed = parse(yaml);
    expect(parsed.title).toEqual([
      { kind: "background", asset_id: "asset_a1b2c3" },
      { kind: "glyph", asset_id: "asset_d4e5f6", x: 32, y: 4 },
      { kind: "text", value: "", x: 8, y: 5, color: "#FFAA00" },
    ]);
  });
});

describe("projectToFiles — textarea title layer", () => {
  const menuWithTitle = (title: Menu["title"]): Project =>
    makeProject({
      documents: {
        menu: [
          {
            id: menuId("shop"),
            projectId: projectId("p_test"),
            rows: 3,
            title,
            layers: [],
          },
        ],
      },
    });

  it("serializeTitleLayer emits snake_case fields for textarea with all fields", () => {
    const files = projectToFiles(
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
    const menu = parse(files["plugins/Artisan/projects/p_test/menus/shop.yml"]!);
    expect(menu.title).toHaveLength(1);
    expect(menu.title[0]).toEqual({
      kind: "textarea",
      value: "",
      x: 12,
      y: 8,
      width: 120,
      line_height: 11,
      alignment: "center",
      font_asset_id: "font_a",
    });
  });

  it("serializeTitleLayer omits font_asset_id when not set", () => {
    const files = projectToFiles(
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
    const menu = parse(files["plugins/Artisan/projects/p_test/menus/shop.yml"]!);
    expect(menu.title[0]).not.toHaveProperty("font_asset_id");
    expect(menu.title[0].line_height).toBe(10);
    expect(menu.title[0].alignment).toBe("left");
  });

  it("textarea text is field-local, not emitted to lang/<lang>.yml", () => {
    const project = makeProject({
      defaultLang: "en",
      i18nKeys: {
        k_ta: { en: "Hello\nWorld" },
      } as Project["i18nKeys"],
      documents: {
        menu: [
          {
            id: menuId("shop"),
            projectId: projectId("p_test"),
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
      },
    });
    const files = projectToFiles(project);
    const menu = parse(files["plugins/Artisan/projects/p_test/menus/shop.yml"]!);
    expect(menu.title[0].value).toBe("Hello\nWorld");
    // Structural text no longer travels in lang/ (ADR field-local-translations).
    expect(parse(files["plugins/Artisan/projects/p_test/lang/en.yml"]!).k_ta).toBeUndefined();
  });
});

describe("projectToFiles — size field on text/textarea layers", () => {
  it("emits size on text layer when not default (8)", () => {
    const project = makeProject({
      i18nKeys: { k: { en: "Big" } } as Project["i18nKeys"],
      documents: {
        menu: [
          {
            id: menuId("m"),
            projectId: projectId("p_test"),
            rows: 3,
            title: [{ kind: "text", value: { key: "k" as I18nKey }, x: 8, y: 5, size: 16 }],
            layers: [],
          },
        ],
      },
    });
    const files = projectToFiles(project);
    const menuYaml = parse(files["plugins/Artisan/projects/p_test/menus/m.yml"]!);
    expect(menuYaml.title[0].size).toBe(16);
  });

  it("omits size on text layer when default (8) or undefined", () => {
    const project = makeProject({
      i18nKeys: { k: { en: "Plain" } } as Project["i18nKeys"],
      documents: {
        menu: [
          {
            id: menuId("m"),
            projectId: projectId("p_test"),
            rows: 3,
            title: [
              { kind: "text", value: { key: "k" as I18nKey }, x: 8, y: 5 },
              { kind: "text", value: { key: "k" as I18nKey }, x: 8, y: 15, size: 8 },
            ],
            layers: [],
          },
        ],
      },
    });
    const files = projectToFiles(project);
    const menuYaml = parse(files["plugins/Artisan/projects/p_test/menus/m.yml"]!);
    expect(menuYaml.title[0].size).toBeUndefined();
    expect(menuYaml.title[1].size).toBeUndefined();
  });

  it("emits size on textarea layer when not default", () => {
    const project = makeProject({
      i18nKeys: { k: { en: "A\nB" } } as Project["i18nKeys"],
      documents: {
        menu: [
          {
            id: menuId("m"),
            projectId: projectId("p_test"),
            rows: 3,
            title: [
              {
                kind: "textarea",
                value: { key: "k" as I18nKey },
                x: 8,
                y: 20,
                width: 168,
                lineHeight: 14,
                alignment: "left",
                size: 12,
              },
            ],
            layers: [],
          },
        ],
      },
    });
    const files = projectToFiles(project);
    const menuYaml = parse(files["plugins/Artisan/projects/p_test/menus/m.yml"]!);
    expect(menuYaml.title[0].size).toBe(12);
  });

  it("imports size from text/textarea layer YAML", () => {
    const project = makeProject({
      i18nKeys: { k: { en: "X" } } as Project["i18nKeys"],
      documents: {
        menu: [
          {
            id: menuId("m"),
            projectId: projectId("p_test"),
            rows: 3,
            title: [
              { kind: "text", value: { key: "k" as I18nKey }, x: 8, y: 5, size: 16 },
              {
                kind: "textarea",
                value: { key: "k" as I18nKey },
                x: 8,
                y: 20,
                width: 168,
                lineHeight: 14,
                alignment: "left",
                size: 12,
              },
            ],
            layers: [],
          },
        ],
      },
    });
    const files = projectToFiles(project);
    const menuYaml = files["plugins/Artisan/projects/p_test/menus/m.yml"]!;
    const parsed = parse(menuYaml).title as { size?: number }[];
    expect(parsed).toHaveLength(2);
    expect(parsed[0]?.size).toBe(16);
    expect(parsed[1]?.size).toBe(12);
  });
});

describe("projectToFiles — appearance conditions", () => {
  const baseMenu = (appearances: Partial<Appearance>[]) => ({
    id: menuId("shop"),
    projectId: projectId("p_test"),
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
            display: (appearances[0] ?? {}) as Appearance,
            states: appearances.slice(1) as Appearance[],
          },
        ],
      },
    ],
  });

  const getApp = (files: Record<string, string>) => {
    const menu = parse(files["plugins/Artisan/projects/p_test/menus/shop.yml"]!);
    return menu.elements[0];
  };

  it("single condition is written as a one-element array", () => {
    const project = makeProject({
      documents: {
        menu: [baseMenu([{ if: [{ type: "has_permission", perm: "vip" }] }])],
      },
    });
    const app = getApp(projectToFiles(project));
    expect(app.if).toEqual([{ has_permission: "vip" }]);
  });

  it("AND-joined conditions are an ANDed array", () => {
    const project = makeProject({
      documents: {
        menu: [
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
      },
    });
    const app = getApp(projectToFiles(project));
    expect(app.if).toEqual([{ has_permission: "vip" }, { has_money: 100 }]);
  });

  it("OR-joined conditions are wrapped in a single { or: [...] }", () => {
    const project = makeProject({
      documents: {
        menu: [
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
      },
    });
    const app = getApp(projectToFiles(project));
    expect(app.if).toEqual([{ or: [{ has_permission: "vip" }, { has_permission: "admin" }] }]);
  });

  it("composite 'and' condition uses 'and'", () => {
    const inner: Condition = { type: "has_permission", perm: "vip" };
    const project = makeProject({
      documents: { menu: [baseMenu([{ if: [{ type: "and", of: [inner] }] }])] },
    });
    const app = getApp(projectToFiles(project));
    expect(app.if[0].and).toBeDefined();
    expect(app.if[0].of).toBeUndefined();
  });

  it("composite 'or' condition uses 'or'", () => {
    const inner: Condition = { type: "has_permission", perm: "vip" };
    const project = makeProject({
      documents: { menu: [baseMenu([{ if: [{ type: "or", of: [inner] }] }])] },
    });
    const app = getApp(projectToFiles(project));
    expect(app.if[0].or).toBeDefined();
    expect(app.if[0].any).toBeUndefined();
  });
});

describe("projectToCommandV1 / projectToDialogV1", () => {
  it("serializes a command to command/v1 with actions", () => {
    const project = makeProject({
      documents: {
        command: [
          {
            id: commandId("heal"),
            projectId: projectId("p_test"),
            name: "heal",
            arguments: [{ name: "n", type: "integer", required: true }],
            steps: [{ kind: "action", action: { name: "close_menu", value: null } }],
          },
        ],
      },
    });
    const [cmd] = projectToCommandV1(project);
    expect(cmd).toMatchObject({ schema: "command/v1", id: "heal" });
    // The action chain is structured steps; name omitted (== id).
    expect((cmd as any).actions).toEqual(["close_menu"]);
    expect((cmd as any).arguments[0]).toEqual({ name: "n", type: "integer", required: true });
  });

  it("serializes a dialog to dialog/v1 with flat button actions", () => {
    const project = makeProject({
      i18nKeys: { ["k_t" as I18nKey]: { en: "T" }, ["k_b" as I18nKey]: { en: "OK" } },
      documents: {
        dialog: [
          {
            id: dialogId("confirm"),
            projectId: projectId("p_test"),
            title: { key: "k_t" as I18nKey },
            canCloseWithEscape: true,
            body: [],
            inputs: [],
            buttons: [
              {
                id: "ok",
                label: { key: "k_b" as I18nKey },
                steps: [{ kind: "action", action: { name: "close_dialog", value: null } }],
              },
            ],
          } as any,
        ],
      },
    });
    const [dlg] = projectToDialogV1(project);
    expect(dlg).toMatchObject({ schema: "dialog/v1", id: "confirm" });
    // Button actions are structured steps.
    expect((dlg as any).buttons[0].actions).toEqual(["close_dialog"]);
  });
});
