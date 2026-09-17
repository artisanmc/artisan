import { commandId, elementId, layerId, menuId, projectId } from "@/domain/ids";
import type { I18nKey, Project } from "@/domain/types";
import { describe, expect, it } from "vitest";
import { validate } from "./validate";

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
    assets: [],
    canvasLayout: {},
    ...overrides,
  }) as Project;

describe("validate", () => {
  it("returns valid for an empty project", () => {
    const result = validate(makeProject());
    expect(result.valid).toBe(true);
    expect(result.errors).toHaveLength(0);
    expect(result.warnings).toHaveLength(0);
  });

  it("errors when a referenced key has no entry at all", () => {
    const project = makeProject({
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
    const result = validate(project);
    expect(result.valid).toBe(false);
    expect(result.errors.some((e) => e.includes("menus.shop.title"))).toBe(true);
  });

  it("accepts an intentionally blank default-lang value", () => {
    const project = makeProject({
      i18nKeys: { "menus.shop.title": { en: "  " } } as Project["i18nKeys"],
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
    const result = validate(project);
    expect(result.valid).toBe(true);
    expect(result.errors).toHaveLength(0);
  });

  it("errors when a referenced key has no default-lang entry", () => {
    const project = makeProject({
      i18nKeys: { "menus.shop.title": { fr: "Bonjour" } } as Project["i18nKeys"],
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
    const result = validate(project);
    expect(result.valid).toBe(false);
    expect(result.errors.some((e) => e.includes("menus.shop.title"))).toBe(true);
  });

  it("does not warn about a target language when the source is intentionally blank", () => {
    const project = makeProject({
      i18nKeys: { "menus.shop.title": { en: "", fr: "" } } as Project["i18nKeys"],
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
    const result = validate(project);
    expect(result.valid).toBe(true);
    expect(result.warnings).toHaveLength(0);
  });

  it("errors on stale undefined entry in i18nKeys", () => {
    const project = makeProject({
      i18nKeys: { stale_key: undefined } as unknown as Project["i18nKeys"],
    });
    const result = validate(project);
    expect(result.valid).toBe(false);
    expect(result.errors.some((e) => e.includes("stale_key"))).toBe(true);
  });

  it("warns when non-default language is missing a translation", () => {
    const project = makeProject({
      defaultLang: "en",
      i18nKeys: {
        "menus.shop.title": { en: "Shop", fr: "" },
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
    const result = validate(project);
    expect(result.valid).toBe(true);
    expect(result.warnings.some((w) => w.includes("fr"))).toBe(true);
  });

  it("validates send_message keys in element click handlers", () => {
    const project = makeProject({
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
                  display: {
                    click: {
                      left: {
                        steps: [
                          {
                            kind: "action",
                            action: {
                              type: "send_message",
                              text: {
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
      i18nKeys: {
        "menus.shop.title": { en: "Shop" },
      } as Project["i18nKeys"],
    });
    const result = validate(project);
    expect(result.valid).toBe(false);
    expect(
      result.errors.some((e) => e.includes("menus.shop.elements.btn.default.click.left.message")),
    ).toBe(true);
  });

  it("validates show_title title and subtitle keys in element click handlers", () => {
    const project = makeProject({
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
                  display: {
                    click: {
                      left: {
                        steps: [
                          {
                            kind: "action",
                            action: {
                              type: "show_title",
                              title: {
                                key: "menus.shop.elements.btn.default.click.left.show_title" as I18nKey,
                              },
                              subtitle: {
                                key: "menus.shop.elements.btn.default.click.left.show_subtitle" as I18nKey,
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
      i18nKeys: {
        "menus.shop.title": { en: "Shop" },
      } as Project["i18nKeys"],
    });
    const result = validate(project);
    expect(result.valid).toBe(false);
    expect(
      result.errors.some((e) =>
        e.includes("menus.shop.elements.btn.default.click.left.show_title"),
      ),
    ).toBe(true);
    expect(
      result.errors.some((e) =>
        e.includes("menus.shop.elements.btn.default.click.left.show_subtitle"),
      ),
    ).toBe(true);
  });

  it("validates send_message keys in command steps", () => {
    const project = makeProject({
      commands: [
        {
          id: commandId("heal"),
          projectId: projectId("p_test"),
          name: "heal",
          arguments: [],
          steps: [
            {
              kind: "action",
              action: { type: "send_message", text: { key: "commands.heal.message" as I18nKey } },
            },
          ],
        },
      ],
    });
    const result = validate(project);
    expect(result.valid).toBe(false);
    expect(result.errors.some((e) => e.includes("commands.heal.message"))).toBe(true);
  });

  it("returns valid when all referenced keys have default-lang values", () => {
    const project = makeProject({
      i18nKeys: {
        "menus.shop.title": { en: "Shop" },
        "menus.shop.elements.btn.default.title": { en: "Buy" },
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
                  display: { title: { key: "menus.shop.elements.btn.default.title" as I18nKey } },
                  states: [],
                },
              ],
            },
          ],
        },
      ],
    });
    const result = validate(project);
    expect(result.valid).toBe(true);
    expect(result.errors).toHaveLength(0);
  });

  it("validates dialog title keys (previously skipped entirely)", () => {
    const project = makeProject({
      dialogs: [
        {
          id: "confirm",
          projectId: "p_test",
          title: { key: "dialogs.confirm.title" as I18nKey },
          canCloseWithEscape: true,
          body: [],
          inputs: [],
          buttons: [],
        },
      ] as unknown as Project["dialogs"],
    });
    const result = validate(project);
    expect(result.valid).toBe(false);
    expect(result.errors.some((e) => e.includes("dialogs.confirm.title"))).toBe(true);
  });

  it("collects each entry of legacy array-shaped lore without crashing", () => {
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
                  // legacy migration artifact: lore as an LText[] rather than a single LText
                  display: { lore: [{ key: "lt_l0" }, { key: "lt_l1" }] },
                  states: [],
                },
              ],
            },
          ],
        },
      ] as unknown as Project["menus"],
    });
    const result = validate(project);
    expect(result.valid).toBe(false);
    expect(result.errors.some((e) => e.includes("lt_l0"))).toBe(true);
    expect(result.errors.some((e) => e.includes("lt_l1"))).toBe(true);
  });
});
