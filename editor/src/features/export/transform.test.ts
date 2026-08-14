import { commandId, dialogId, elementId, layerId, menuId, projectId } from "@/domain/ids";
import type { Appearance, AssetId, Condition, Dialog, Element, I18nKey, Project } from "@/domain/types";
import { flattenLangTree } from "@/lib/langTree";
import { parse } from "yaml";
import { describe, expect, it, afterEach } from "vitest";
import { registerModule } from "@artisan/editor-sdk";
import { clearRegistry } from "../../../packages/editor-sdk/src/contract/registry";
import { projectToCommandV1, projectToDialogV1, parseTitleNode, transform } from "./transform";

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
    menus: [],
    commands: [],
    dialogs: [],
    assets: [],
    canvasLayout: {},
    ...overrides,
  }) as Project;

const parseEditorState = (files: Record<string, string>) => {
  const raw = files["plugins/Artisan/projects/p_test/.artisan/editor.yaml"];
  return raw === undefined ? undefined : parse(raw);
};

describe("transform", () => {
  it("emits manifest.yaml with menu and command ids", () => {
    const project = makeProject({
      menus: [
        { id: menuId("shop"), projectId: projectId("p_test"), rows: 3, title: [{ kind: "text", value: { key: "k" as I18nKey }, x: 8, y: 5 }], layers: [] },
      ],
      commands: [
        { id: commandId("heal"), projectId: projectId("p_test"), name: "heal", arguments: [], steps: [] },
      ],
    });
    const files = transform(project);
    const manifest = parse(files["plugins/Artisan/projects/p_test/manifest.yaml"]!);
    expect(manifest.schema).toBe("manifest/v1");
    expect(manifest.project_id).toBe("p_test");
    // Plus de bloc `files:` : les Documents se découvrent par scan des dossiers,
    // des deux côtés. Ce qui atteste leur existence, c'est le fichier lui-même.
    expect(manifest.files).toBeUndefined();
    expect(files["plugins/Artisan/projects/p_test/menus/shop.yaml"]).toBeDefined();
    expect(files["plugins/Artisan/projects/p_test/commands/heal.yaml"]).toBeDefined();
  });

  it("round-trips manifest.module for Add-on-owned projects", () => {
    const owned = parse(
      transform(makeProject({ ownerModule: "boutique" }))["plugins/Artisan/projects/p_test/manifest.yaml"]!,
    );
    expect(owned.module).toBe("boutique");
    const plain = parse(
      transform(makeProject())["plugins/Artisan/projects/p_test/manifest.yaml"]!,
    );
    expect(plain.module).toBeUndefined();
  });

  it("emits board layout in .artisan/editor.yaml with menu/command/dialog positions", () => {
    const project = makeProject({
      menus: [
        { id: menuId("shop"), projectId: projectId("p_test"), rows: 3, title: [], layers: [] },
      ],
      commands: [
        { id: commandId("heal"), projectId: projectId("p_test"), name: "heal", arguments: [], steps: [] },
      ],
      dialogs: [
        { id: dialogId("confirm"), projectId: projectId("p_test"), title: { key: "k" as I18nKey }, canCloseWithEscape: true, body: [], inputs: [], buttons: [] } as unknown as Dialog,
      ],
      canvasLayout: {
        [menuId("shop")]: { x: 40, y: 40 },
        [commandId("heal")]: { x: 260, y: 40 },
        [dialogId("confirm")]: { x: 480, y: 40 },
      },
    });
    const files = transform(project);
    const manifest = parse(files["plugins/Artisan/projects/p_test/manifest.yaml"]!);
    expect(parseEditorState(files)?.layout).toEqual({
      shop:    { x: 40,  y: 40 },
      heal:    { x: 260, y: 40 },
      confirm: { x: 480, y: 40 },
    });
  });

  it("omits .artisan/editor.yaml when canvasLayout is empty", () => {
    const project = makeProject({
      menus: [
        { id: menuId("shop"), projectId: projectId("p_test"), rows: 3, title: [], layers: [] },
      ],
      canvasLayout: {},
    });
    const files = transform(project);
    const manifest = parse(files["plugins/Artisan/projects/p_test/manifest.yaml"]!);
    expect(parseEditorState(files)).toBeUndefined();
  });

  it("serializes an element in placement mode with key_field (no per-placement overrides)", () => {
    const project = makeProject({
      menus: [
        {
          id: menuId("shop"), projectId: projectId("p_test"), rows: 6, title: [],
          contextInputs: [{ kind: "sourceRef", name: "items", ref: "boutique:items" as never }],
          layers: [
            {
              id: layerId("main"), name: "Main",
              elements: [
                {
                  id: elementId("grid"), positions: "",
                  appearances: [{ material: "{item.icon}", title: { key: "k" as I18nKey } }],
                  places: {
                    source: "items", alias: "item", keyField: "id",
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
    });
    const files = transform(project);
    const menu = parse(files["plugins/Artisan/projects/p_test/menus/shop.yaml"]!);
    const el = menu.elements[0];
    expect(el.iterates).toBeUndefined();
    expect(el.places).toEqual({
      source: "items", alias: "item", key_field: "id",
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
    const files = transform(project);
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
        exportFiles: () => ({ "boutique/items.yaml": "items: []" }),
      });
      const files = transform(makeProject());
      const key = Object.keys(files).find((k) => k.endsWith("/boutique/items.yaml"));
      expect(key).toBeDefined();
      expect(files[key!]).toBe("items: []");
    });

    it("re-emits __files of moduleData namespaces no registered module claims", () => {
      const project = makeProject({
        moduleData: {
          boutique: { __files: { "shop.yaml": "schema: boutique/v1\n", "notes/readme.txt": "hi" } },
        },
      });
      const files = transform(project);
      expect(files["plugins/Artisan/projects/p_test/boutique/shop.yaml"]).toBe("schema: boutique/v1\n");
      expect(files["plugins/Artisan/projects/p_test/boutique/notes/readme.txt"]).toBe("hi");
    });

    it("registered module keeps authority over its namespace (exportFiles wins over __files)", () => {
      registerModule({
        id: "boutique",
        displayName: "Boutique",
        schemaVersion: "shop/v1",
        sidebar: { icon: () => null, label: "Boutique", to: "/m/boutique" },
        routes: [],
        exportFiles: () => ({ "boutique/shop.yaml": "from-module" }),
      });
      const project = makeProject({
        moduleData: { boutique: { __files: { "shop.yaml": "raw-bytes" } } },
      });
      const files = transform(project);
      expect(files["plugins/Artisan/projects/p_test/boutique/shop.yaml"]).toBe("from-module");
    });
  });

  it("filters orphaned ids from the board layout (id no longer in project)", () => {
    const project = makeProject({
      menus: [
        { id: menuId("shop"), projectId: projectId("p_test"), rows: 3, title: [], layers: [] },
      ],
      canvasLayout: {
        [menuId("shop")]: { x: 40, y: 40 },
        // "ghost_menu" is NOT in project.menus — stale entry, should be dropped:
        "ghost_menu": { x: 999, y: 999 },
      } as Project["canvasLayout"],
    });
    const files = transform(project);
    const manifest = parse(files["plugins/Artisan/projects/p_test/manifest.yaml"]!);
    expect(parseEditorState(files)?.layout).toEqual({ shop: { x: 40, y: 40 } });
  });

  it("emits the board layout in block-style YAML the backend round-trip test parses", () => {
    const project = makeProject({
      menus: [
        { id: menuId("shop"), projectId: projectId("p_test"), rows: 3, title: [], layers: [] },
      ],
      canvasLayout: { [menuId("shop")]: { x: 123, y: 456 } },
    });
    const files = transform(project);
    const manifestYaml = files["plugins/Artisan/projects/p_test/manifest.yaml"]!;
    // The editor emits block-style YAML for nested objects (the `yaml` lib's
    // default with our yamlOpts). The backend mirror test below asserts the
    // same block-style shape is parseable. If you change to flow style here,
    // update the backend mirror fixture too.
    const editorYaml = files["plugins/Artisan/projects/p_test/.artisan/editor.yaml"]!;
    expect(editorYaml).toContain("layout:");
    expect(editorYaml).toContain("shop:");
    expect(editorYaml).toMatch(/x:\s*123/);
    expect(editorYaml).toMatch(/y:\s*456/);
  });

  it("emits board edges in .artisan/editor.yaml with live-edge overrides", () => {
    const project = makeProject({
      menus: [
        { id: menuId("shop"), projectId: projectId("p_test"), rows: 3, title: [], layers: [] },
        { id: menuId("home"), projectId: projectId("p_test"), rows: 3, title: [], layers: [] },
      ],
      canvasEdges: {
        "home->shop": { from: { side: "top", t: 0.25 }, to: { side: "left", t: 0.5 } },
      },
    });
    const files = transform(project);
    const manifest = parse(files["plugins/Artisan/projects/p_test/manifest.yaml"]!);
    expect(parseEditorState(files)?.edges).toEqual({
      "home->shop": { from: { side: "top", t: 0.25 }, to: { side: "left", t: 0.5 } },
    });
  });

  it("omits board edges when canvasEdges is empty or absent", () => {
    const project = makeProject({
      menus: [{ id: menuId("shop"), projectId: projectId("p_test"), rows: 3, title: [], layers: [] }],
    });
    const files = transform(project);
    const manifest = parse(files["plugins/Artisan/projects/p_test/manifest.yaml"]!);
    expect(parseEditorState(files)?.edges).toBeUndefined();
  });

  it("filters board edges whose source or target is no longer in the project", () => {
    const project = makeProject({
      menus: [
        { id: menuId("shop"), projectId: projectId("p_test"), rows: 3, title: [], layers: [] },
        { id: menuId("home"), projectId: projectId("p_test"), rows: 3, title: [], layers: [] },
      ],
      canvasEdges: {
        "home->shop": { from: { side: "right", t: 0.5 } },
        "home->ghost": { from: { side: "right", t: 0.5 } },
        "ghost->shop": { to: { side: "left", t: 0.5 } },
      },
    });
    const files = transform(project);
    const manifest = parse(files["plugins/Artisan/projects/p_test/manifest.yaml"]!);
    expect(parseEditorState(files)?.edges).toEqual({
      "home->shop": { from: { side: "right", t: 0.5 } },
    });
  });

  it("emits a menu yaml with title array containing the text layer", () => {
    const project = makeProject({
      i18nKeys: { "menus.shop.title": { en: "Shop" } } as Project["i18nKeys"],
      menus: [
        {
          id: menuId("shop"),
          projectId: projectId("p_test"),
          rows: 3,
          title: [{ kind: "text", value: { key: "menus.shop.title" as I18nKey }, x: 8, y: 5 }],
          layers: [],
        },
      ],
    });
    const files = transform(project);
    const menu = parse(files["plugins/Artisan/projects/p_test/menus/shop.yaml"]!);
    expect(menu.schema).toBe("menu/v1");
    // L'identité est le NOM DU FICHIER, plus un champ du document.
    expect("id" in menu).toBe(false);
    expect(menu.size).toBe(27);
    expect(Array.isArray(menu.title)).toBe(true);
    expect(menu.title).toHaveLength(1);
    expect(menu.title[0]).toEqual({
      kind: "text",
      value: "{i18n:menus.shop.title}",
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
      menus: [
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
    const files = transform(project);
    const menu = parse(files["plugins/Artisan/projects/p_test/menus/shop.yaml"]!);
    const app = menu.elements[0].appearances[0];
    expect(app.title).toBe("{i18n:menus.shop.elements.btn.default.title}");
    expect(app.lore).toEqual(["{i18n:menus.shop.elements.btn.default.lore}"]);
    // Click steps are an Action DSL string; menu text is a Key site → `@key`.
    expect(app.click.left).toBe(
      "send_message @menus.shop.elements.btn.default.click.left.message",
    );
  });

  it("serializes appearance.head", () => {
    const project = makeProject({
      menus: [
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
                  appearances: [
                    {
                      material: "PLAYER_HEAD",
                      head: "basehead:eyJ0ZXh0dXJlcyI6e319",
                    },
                  ],
                },
              ],
            },
          ],
        },
      ],
    });
    const files = transform(project);
    const menu = parse(files["plugins/Artisan/projects/p_test/menus/shop.yaml"]!);
    const app = menu.elements[0].appearances[0];
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
      menus: [
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
                  appearances: [
                    {
                      click: {
                        left: {
                          steps: [
                            {
                              kind: "action",
                              action: {
                                type: "show_title",
                                title: { key: "menus.shop.elements.btn.default.click.left.show_title" as I18nKey },
                                subtitle: { key: "menus.shop.elements.btn.default.click.left.show_subtitle" as I18nKey },
                                fadeIn: 5,
                                stay: 40,
                                fadeOut: 15,
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
    const files = transform(project);
    const menu = parse(files["plugins/Artisan/projects/p_test/menus/shop.yaml"]!);
    const steps = menu.elements[0].appearances[0].click.left;
    expect(steps).toBe(
      "show_title @menus.shop.elements.btn.default.click.left.show_title " +
        "@menus.shop.elements.btn.default.click.left.show_subtitle fadeIn=5 stay=40 fadeOut=15",
    );
  });

  it("serializes show_title action omitting optional subtitle and timings", () => {
    const project = makeProject({
      i18nKeys: {
        "menus.shop.title": { en: "Shop" },
        "menus.shop.elements.btn.default.click.left.show_title": { en: "Hello" },
      } as Project["i18nKeys"],
      menus: [
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
                  appearances: [
                    {
                      click: {
                        left: {
                          steps: [
                            {
                              kind: "action",
                              action: {
                                type: "show_title",
                                title: { key: "menus.shop.elements.btn.default.click.left.show_title" as I18nKey },
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
    const files = transform(project);
    const menu = parse(files["plugins/Artisan/projects/p_test/menus/shop.yaml"]!);
    const steps = menu.elements[0].appearances[0].click.left;
    // No subtitle / timings → DSL carries only the title ref.
    expect(steps).toBe("show_title @menus.shop.elements.btn.default.click.left.show_title");
  });

  it("serializes open_menu action with snake_case fields", () => {
    const targetId = menuId("profile");
    const project = makeProject({
      i18nKeys: { "menus.shop.title": { en: "Shop" } } as Project["i18nKeys"],
      menus: [
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
    const files = transform(project);
    const menu = parse(files["plugins/Artisan/projects/p_test/menus/shop.yaml"]!);
    const steps = menu.elements[0].appearances[0].click.left;
    // DSL: bare menu id + `clear` modifier (no snake_case wire fields).
    expect(steps).toBe("open_menu profile clear");
    expect(steps).not.toContain("menuId");
  });

  it("round-trips a row-model context input (type object + row_of)", () => {
    const project = makeProject({
      menus: [{
        id: menuId("shop_category"), projectId: projectId("p_test"), rows: 6, title: [],
        contextInputs: [
          { kind: "primitive", name: "cat", type: "object", rowOf: "boutique:categories" as never },
        ],
        layers: [],
      }],
    });
    const files = transform(project);
    const menu = parse(files["plugins/Artisan/projects/p_test/menus/shop_category.yaml"]!);
    expect(menu.inputs).toEqual([
      { name: "cat", type: "object", row_of: "boutique:categories" },
    ]);
  });

  it("serializes paginate to pagination_next/prev with element_id", () => {
    const project = makeProject({
      i18nKeys: { "menus.shop.title": { en: "Shop" } } as Project["i18nKeys"],
      menus: [{
        id: menuId("shop"), projectId: projectId("p_test"), rows: 3,
        title: [{ kind: "text", value: { key: "menus.shop.title" as I18nKey }, x: 8, y: 5 }],
        layers: [{ id: layerId("l1"), name: "default", elements: [{
          id: elementId("nav"), positions: "0",
          appearances: [{ click: { left: { steps: [
            { kind: "action", action: { type: "paginate", direction: "next" } },
            { kind: "action", action: { type: "paginate", direction: "prev", targetElementId: elementId("grid") } },
          ] } } }],
        }] }],
      }],
    });
    const files = transform(project);
    const menu = parse(files["plugins/Artisan/projects/p_test/menus/shop.yaml"]!);
    // Canonical collapsed form: the handler IS the DSL string, one action per line.
    const dsl = menu.elements[0].appearances[0].click.left;
    expect(dsl).toBe("paginate next\npaginate prev grid");
  });

  it("emits a command yaml", () => {
    const project = makeProject({
      commands: [
        {
          id: commandId("heal"),
          projectId: projectId("p_test"),
          name: "heal",
          aliases: ["h"],
          arguments: [{ name: "target", type: "player", required: true }],
          steps: [],
        },
      ],
    });
    const files = transform(project);
    const cmd = parse(files["plugins/Artisan/projects/p_test/commands/heal.yaml"]!);
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
      commands: [
        { id: commandId("boutique_open"), projectId: projectId("p_test"), name: "boutique", arguments: [], steps: [] },
      ],
    });
    const files = transform(project);
    const cmd = parse(files["plugins/Artisan/projects/p_test/commands/boutique_open.yaml"]!);
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
      menus: [
        {
          id: menuId("shop"),
          projectId: projectId("p_test"),
          rows: 3,
          title: [{ kind: "text", value: { key: "menus.shop.title" as I18nKey }, x: 8, y: 5 }],
          layers: [],
        },
      ],
    });
    const files = transform(project);
    const en = flattenLangTree(parse(files["plugins/Artisan/projects/p_test/lang/en.yaml"]!));
    const fr = flattenLangTree(parse(files["plugins/Artisan/projects/p_test/lang/fr.yaml"]!));
    expect(en["menus.shop.title"]).toBe("Shop");
    expect(fr["menus.shop.title"]).toBe("Boutique");
    expect(en["lt_orphan"]).toBeUndefined();
    expect(en["greeting"]).toBeUndefined();
    expect(files["plugins/Artisan/projects/p_test/translations.yaml"]).toBeUndefined();
  });

  it("manifest includes default_lang and languages", () => {
    const project = makeProject({
      defaultLang: "en",
      i18nKeys: {
        "menus.shop.title": { en: "Shop", fr: "Boutique" },
      } as Project["i18nKeys"],
    });
    const files = transform(project);
    const manifest = parse(files["plugins/Artisan/projects/p_test/manifest.yaml"]!);
    expect(manifest.default_lang).toBe("en");
    expect(manifest.languages).toContain("en");
    expect(manifest.languages).toContain("fr");
  });

  it("emits no meta.yaml — the export is a pure function of the Project (no timestamps)", () => {
    const project = makeProject();
    const files = transform(project);
    expect(files["plugins/Artisan/projects/p_test/meta.yaml"]).toBeUndefined();
    // Determinism: two exports of the same Project are byte-identical.
    expect(transform(project)).toEqual(files);
  });
});

describe("transform — dialogs", () => {
  it("emits dialog yaml file", () => {
    const dialog: Dialog = {
      id: dialogId("d_test"),
      projectId: projectId("p_test"),
      title: { key: "dialogs.d_test.title" as I18nKey },
      canCloseWithEscape: true,
      body: [],
      inputs: [],
      buttons: [{ id: "btn_confirm", label: { key: "dialogs.d_test.buttons.btn_confirm.label" as I18nKey }, steps: [] }],
    };
    const files = transform(makeProject({ dialogs: [dialog] }));
    expect(files["plugins/Artisan/projects/p_test/dialogs/d_test.yaml"]).toBeDefined();
  });

  it("dialog yaml contains schema, title, can_close_with_escape — mais plus d'id", () => {
    const dialog: Dialog = {
      id: dialogId("d_test"),
      projectId: projectId("p_test"),
      title: { key: "dialogs.d_test.title" as I18nKey },
      canCloseWithEscape: false,
      body: [],
      inputs: [],
      buttons: [{ id: "btn_confirm", label: { key: "dialogs.d_test.buttons.btn_confirm.label" as I18nKey }, steps: [] }],
    };
    const files = transform(makeProject({ dialogs: [dialog] }));
    const yaml = files["plugins/Artisan/projects/p_test/dialogs/d_test.yaml"]!;
    expect(yaml).toContain("schema: dialog/v1");
    expect(yaml).not.toContain("id: d_test");
    expect(yaml).toContain("can_close_with_escape: false");
    expect(yaml).toContain("{i18n:dialogs.d_test.title}");
  });

  it("le dialog existe par son fichier, plus par une entrée de manifest", () => {
    const dialog: Dialog = {
      id: dialogId("d_test"),
      projectId: projectId("p_test"),
      title: { key: "dialogs.d_test.title" as I18nKey },
      canCloseWithEscape: true,
      body: [],
      inputs: [],
      buttons: [{ id: "btn_confirm", label: { key: "dialogs.d_test.buttons.btn_confirm.label" as I18nKey }, steps: [] }],
    };
    const files = transform(makeProject({ dialogs: [dialog] }));
    const manifest = files["plugins/Artisan/projects/p_test/manifest.yaml"]!;
    expect(manifest).not.toContain("d_test");
    expect(files["plugins/Artisan/projects/p_test/dialogs/d_test.yaml"]).toBeDefined();
  });

  it("button actions are serialized flat", () => {
    const dialog: Dialog = {
      id: dialogId("d_test"),
      projectId: projectId("p_test"),
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
    const files = transform(makeProject({ dialogs: [dialog] }));
    const yaml = files["plugins/Artisan/projects/p_test/dialogs/d_test.yaml"]!;
    expect(yaml).toContain("close_dialog");
  });

  it("open_dialog action uses snake_case dialog_id", () => {
    const projectWithDialog = (dialog: Dialog) => makeProject({ dialogs: [dialog] });
    const pid = projectId;
    const dialog: Dialog = {
      id: dialogId("d_test"),
      projectId: pid("p_test"),
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
    const files = transform(projectWithDialog(dialog));
    const yaml = files["plugins/Artisan/projects/p_test/dialogs/d_test.yaml"]!;
    // Button actions are an Action DSL string: `open_dialog <bare id>`.
    expect(yaml).toContain("open_dialog d_other");
    expect(yaml).not.toContain("dialogId");
  });
});

describe("transform — title layers", () => {
  const menuWithTitle = (title: Project["menus"][number]["title"]): Project =>
    makeProject({
      menus: [
        {
          id: menuId("shop"),
          projectId: projectId("p_test"),
          rows: 3,
          title,
          layers: [],
        },
      ],
    });

  it("emits a plain-only title as a bare string (canonical sugar)", () => {
    const files = transform(menuWithTitle([{ kind: "plain", value: { key: "k_plain" as I18nKey } }]));
    const menu = parse(files["plugins/Artisan/projects/p_test/menus/shop.yaml"]!);
    expect(menu.title).toBe("{i18n:k_plain}");
  });

  it("serializes a background layer to { kind, asset_id }", () => {
    const files = transform(
      menuWithTitle([{ kind: "background", assetId: "asset_a1b2c3" as AssetId }]),
    );
    const menu = parse(files["plugins/Artisan/projects/p_test/menus/shop.yaml"]!);
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
    const menu = parse(files["plugins/Artisan/projects/p_test/menus/shop.yaml"]!);
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
    const menu = parse(files["plugins/Artisan/projects/p_test/menus/shop.yaml"]!);
    expect(menu.title).toEqual([
      { kind: "text", value: "{i18n:k_text}", x: 8, y: 5 },
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
    const menu = parse(files["plugins/Artisan/projects/p_test/menus/shop.yaml"]!);
    expect(menu.title[0]).toEqual({
      kind: "text",
      value: "{i18n:k_text}",
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
    const menu = parse(files["plugins/Artisan/projects/p_test/menus/shop.yaml"]!);
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
    const menu = parse(files["plugins/Artisan/projects/p_test/menus/shop.yaml"]!);
    expect(menu.title).toEqual([
      { kind: "background", asset_id: "asset_bg" },
      { kind: "glyph", asset_id: "asset_g1", x: 10, y: 2 },
      { kind: "text", value: "{i18n:k_title}", x: 8, y: 5, color: "#FFAA00" },
    ]);
  });

  it("emits title: [] for menus with no title layers", () => {
    const files = transform(menuWithTitle([]));
    const menu = parse(files["plugins/Artisan/projects/p_test/menus/shop.yaml"]!);
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
    const yaml = files["plugins/Artisan/projects/p_test/menus/shop.yaml"]!;
    // Spot-check the YAML body explicitly for the layered shape.
    expect(yaml).toContain("title:");
    expect(yaml).toContain("kind: background");
    expect(yaml).toContain("asset_id: asset_a1b2c3");
    expect(yaml).toContain("kind: glyph");
    expect(yaml).toContain("kind: text");
    expect(yaml).toContain("value: \"{i18n:k_xyz}\"");
    expect(yaml).toContain("color");
    expect(yaml).toContain("#FFAA00");

    const parsed = parse(yaml);
    expect(parsed.title).toEqual([
      { kind: "background", asset_id: "asset_a1b2c3" },
      { kind: "glyph", asset_id: "asset_d4e5f6", x: 32, y: 4 },
      { kind: "text", value: "{i18n:k_xyz}", x: 8, y: 5, color: "#FFAA00" },
    ]);
  });
});

describe("transform — textarea title layer", () => {
  const menuWithTitle = (title: Project["menus"][number]["title"]): Project =>
    makeProject({
      menus: [
        {
          id: menuId("shop"),
          projectId: projectId("p_test"),
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
    const menu = parse(files["plugins/Artisan/projects/p_test/menus/shop.yaml"]!);
    expect(menu.title).toHaveLength(1);
    expect(menu.title[0]).toEqual({
      kind: "textarea",
      value: "{i18n:k_ta}",
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
    const menu = parse(files["plugins/Artisan/projects/p_test/menus/shop.yaml"]!);
    expect(menu.title[0]).not.toHaveProperty("font_asset_id");
    expect(menu.title[0].line_height).toBe(10);
    expect(menu.title[0].alignment).toBe("left");
  });

  it("textarea i18n key is exported to lang/<lang>.yaml (regression: was silently dropped)", () => {
    // Without `textarea` in getTitleTextLayers, the key wasn't in
    // referencedKeys and the lang file came out empty — plugin then rendered
    // `<i18nKey>` literally as the title text.
    const project = makeProject({
      defaultLang: "en",
      i18nKeys: {
        k_ta: { en: "Hello\nWorld" },
      } as Project["i18nKeys"],
      menus: [
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
    });
    const files = transform(project);
    const lang = parse(files["plugins/Artisan/projects/p_test/lang/en.yaml"]!);
    // Asserted by key: every lang file also carries the project's presentation
    // keys (`artisan.duration.*`), which are not the subject here.
    expect(lang.k_ta).toBe("Hello\nWorld");
  });
});

describe("parseTitleNode — textarea", () => {
  it("round-trips a textarea with all fields", () => {
    const result = parseTitleNode([
      {
        kind: "textarea",
        value: "{i18n:k_ta}",
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
        value: "{i18n:k_ta}",
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
        value: "{i18n:k_ta}",
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
        value: "{i18n:k_ta}",
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
        value: "{i18n:k_ta}",
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
        value: "{i18n:k_title}",
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

describe("transform — size field on text/textarea layers", () => {
  it("emits size on text layer when not default (8)", () => {
    const project = makeProject({
      i18nKeys: { "k": { en: "Big" } } as Project["i18nKeys"],
      menus: [{
        id: menuId("m"), projectId: projectId("p_test"), rows: 3,
        title: [{ kind: "text", value: { key: "k" as I18nKey }, x: 8, y: 5, size: 16 }],
        layers: [],
      }],
    });
    const files = transform(project);
    const menuYaml = parse(files["plugins/Artisan/projects/p_test/menus/m.yaml"]!);
    expect(menuYaml.title[0].size).toBe(16);
  });

  it("omits size on text layer when default (8) or undefined", () => {
    const project = makeProject({
      i18nKeys: { "k": { en: "Plain" } } as Project["i18nKeys"],
      menus: [{
        id: menuId("m"), projectId: projectId("p_test"), rows: 3,
        title: [
          { kind: "text", value: { key: "k" as I18nKey }, x: 8, y: 5 },
          { kind: "text", value: { key: "k" as I18nKey }, x: 8, y: 15, size: 8 },
        ],
        layers: [],
      }],
    });
    const files = transform(project);
    const menuYaml = parse(files["plugins/Artisan/projects/p_test/menus/m.yaml"]!);
    expect(menuYaml.title[0].size).toBeUndefined();
    expect(menuYaml.title[1].size).toBeUndefined();
  });

  it("emits size on textarea layer when not default", () => {
    const project = makeProject({
      i18nKeys: { "k": { en: "A\nB" } } as Project["i18nKeys"],
      menus: [{
        id: menuId("m"), projectId: projectId("p_test"), rows: 3,
        title: [{
          kind: "textarea", value: { key: "k" as I18nKey },
          x: 8, y: 20, width: 168, lineHeight: 14, alignment: "left", size: 12,
        }],
        layers: [],
      }],
    });
    const files = transform(project);
    const menuYaml = parse(files["plugins/Artisan/projects/p_test/menus/m.yaml"]!);
    expect(menuYaml.title[0].size).toBe(12);
  });

  it("imports size from text/textarea layer YAML", () => {
    const project = makeProject({
      i18nKeys: { "k": { en: "X" } } as Project["i18nKeys"],
      menus: [{
        id: menuId("m"), projectId: projectId("p_test"), rows: 3,
        title: [
          { kind: "text", value: { key: "k" as I18nKey }, x: 8, y: 5, size: 16 },
          { kind: "textarea", value: { key: "k" as I18nKey }, x: 8, y: 20,
            width: 168, lineHeight: 14, alignment: "left", size: 12 },
        ],
        layers: [],
      }],
    });
    const files = transform(project);
    const menuYaml = files["plugins/Artisan/projects/p_test/menus/m.yaml"]!;
    const parsed = parse(menuYaml).title;
    const reimported = parseTitleNode(parsed);
    expect(reimported).toHaveLength(2);
    expect((reimported[0] as { size?: number }).size).toBe(16);
    expect((reimported[1] as { size?: number }).size).toBe(12);
  });
});

describe("transform — appearance conditions", () => {
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
            appearances: appearances as Appearance[],
          },
        ],
      },
    ],
  });

  const getApp = (files: Record<string, string>) => {
    const menu = parse(files["plugins/Artisan/projects/p_test/menus/shop.yaml"]!);
    return menu.elements[0].appearances[0];
  };

  it("single condition is written as a one-element array", () => {
    const project = makeProject({ menus: [baseMenu([{ if: [{ type: "has_permission", perm: "vip" }] }])] });
    const app = getApp(transform(project));
    expect(app.if).toEqual([{ type: "has_permission", perm: "vip" }]);
  });

  it("AND-joined conditions are an ANDed array", () => {
    const project = makeProject({ menus: [baseMenu([{
      if: [{ type: "has_permission", perm: "vip" } as Condition, { type: "has_money", amount: 100 } as Condition],
      ifJoins: ["and"],
    }])] });
    const app = getApp(transform(project));
    expect(app.if).toEqual([{ type: "has_permission", perm: "vip" }, { type: "has_money", amount: 100 }]);
  });

  it("OR-joined conditions are wrapped in a single { type: 'or', of: [...] }", () => {
    const project = makeProject({ menus: [baseMenu([{
      if: [{ type: "has_permission", perm: "vip" } as Condition, { type: "has_permission", perm: "admin" } as Condition],
      ifJoins: ["or"],
    }])] });
    const app = getApp(transform(project));
    expect(app.if).toEqual([{ type: "or", of: [{ type: "has_permission", perm: "vip" }, { type: "has_permission", perm: "admin" }] }]);
  });

  it("composite 'and' condition uses 'of'", () => {
    const inner: Condition = { type: "has_permission", perm: "vip" };
    const project = makeProject({ menus: [baseMenu([{ if: [{ type: "and", of: [inner] }] }])] });
    const app = getApp(transform(project));
    expect(app.if[0].of).toBeDefined();
    expect(app.if[0].all).toBeUndefined();
  });

  it("composite 'or' condition uses 'of'", () => {
    const inner: Condition = { type: "has_permission", perm: "vip" };
    const project = makeProject({ menus: [baseMenu([{ if: [{ type: "or", of: [inner] }] }])] });
    const app = getApp(transform(project));
    expect(app.if[0].of).toBeDefined();
    expect(app.if[0].any).toBeUndefined();
  });
});

describe("projectToCommandV1 / projectToDialogV1", () => {
  it("serializes a command to command/v1 with actions", () => {
    const project = makeProject({
      commands: [
        {
          id: commandId("heal"), projectId: projectId("p_test"), name: "heal",
          arguments: [{ name: "n", type: "integer", required: true }],
          steps: [{ kind: "action", action: { type: "close_menu" } }],
        },
      ],
    });
    const [cmd] = projectToCommandV1(project);
    expect(cmd).toMatchObject({ schema: "command/v1", id: "heal" });
    // The action chain is the `actions` Action DSL string; name omitted (== id).
    expect((cmd as any).actions).toBe("close_menu");
    expect((cmd as any).arguments[0]).toEqual({ name: "n", type: "integer", required: true });
  });

  it("serializes a dialog to dialog/v1 with flat button actions", () => {
    const project = makeProject({
      i18nKeys: { ["k_t" as I18nKey]: { en: "T" }, ["k_b" as I18nKey]: { en: "OK" } },
      dialogs: [
        {
          id: dialogId("confirm"), projectId: projectId("p_test"),
          title: { key: "k_t" as I18nKey }, canCloseWithEscape: true,
          body: [], inputs: [],
          buttons: [{ id: "ok", label: { key: "k_b" as I18nKey }, steps: [{ kind: "action", action: { type: "close_dialog" } }] }],
        } as any,
      ],
    });
    const [dlg] = projectToDialogV1(project);
    expect(dlg).toMatchObject({ schema: "dialog/v1", id: "confirm" });
    // Button actions are now an Action DSL string.
    expect((dlg as any).buttons[0].actions).toBe("close_dialog");
  });
});
