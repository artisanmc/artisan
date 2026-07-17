import type { I18nKey, Project } from "@/domain/types";
import { describe, expect, it } from "vitest";
import { buildTranslationRows, findKeyUsages, findUnusedI18nKeys } from "./i18nUsages";

const k = (s: string): I18nKey => s as I18nKey;

/** Minimal pack scaffold; callers override the bits they exercise. */
function pack(overrides: Partial<Project>): Project {
  return {
    id: "p1" as Project["id"],
    name: "P",
    source: "user_created",
    createdAt: "2026-01-01T00:00:00Z",
    updatedAt: "2026-01-01T00:00:00Z",
    defaultLang: "en",
    menus: [],
    commands: [],
    templates: [],
    assets: [],
    dataSources: [],
    importedConnectors: [],
    dialogs: [],
    canvasLayout: {},
    i18nKeys: {},
    ...overrides,
  };
}

describe("findKeyUsages", () => {
  it("records item template appearance titles (not flagged unused)", () => {
    const p = pack({
      itemTemplates: [
        {
          id: "tpl1" as never,
          projectId: "p1" as never,
          name: "Vue boutique",
          sourceRef: "boutique:items",
          alias: "item",
          keyField: "id",
          appearances: [{ material: "{item.icon}", title: { key: k("lt_tpl_title") } }],
        },
      ],
      i18nKeys: { [k("lt_tpl_title")]: { en: "{item.name}" } },
    });
    expect(findKeyUsages(p).get(k("lt_tpl_title"))).toBe("item_templates.tpl1.default.title");
    expect(findUnusedI18nKeys(p)).toEqual([]);
  });

  it("records menu title text layers", () => {
    const p = pack({
      menus: [
        {
          id: "m1" as never,
          projectId: "p1" as never,
          title: [{ kind: "text", value: { key: k("lt_title") }, x: 0, y: 0 }],
          rows: 3,
          layers: [],
        },
      ],
    });
    expect(findKeyUsages(p).get(k("lt_title"))).toBe("menus.m1.title");
  });

  it("records element title and a single-LText lore", () => {
    const p = pack({
      menus: [
        {
          id: "m1" as never,
          projectId: "p1" as never,
          title: [],
          rows: 3,
          layers: [
            {
              id: "l1" as never,
              name: "default",
              elements: [
                {
                  id: "e1" as never,
                  positions: "0",
                  appearances: [
                    {
                      title: { key: k("lt_t") },
                      lore: { key: k("lt_lore") },
                    },
                  ],
                },
              ],
            },
          ],
        },
      ],
    });
    const u = findKeyUsages(p);
    expect(u.get(k("lt_t"))).toBe("menus.m1.elements.e1.default.title");
    expect(u.get(k("lt_lore"))).toBe("menus.m1.elements.e1.default.lore");
  });

  it("records lore stored as an array of LText (legacy-migrated shape)", () => {
    const p = pack({
      menus: [
        {
          id: "m1" as never,
          projectId: "p1" as never,
          title: [],
          rows: 3,
          layers: [
            {
              id: "l1" as never,
              name: "default",
              elements: [
                {
                  id: "e1" as never,
                  positions: "0",
                  // biome-ignore lint/suspicious/noExplicitAny: legacy array-lore shape
                  appearances: [{ lore: [{ key: k("lt_l0") }, { key: k("lt_l1") }] } as any],
                },
              ],
            },
          ],
        },
      ],
    });
    const u = findKeyUsages(p);
    expect(u.get(k("lt_l0"))).toBe("menus.m1.elements.e1.default.lore");
    expect(u.get(k("lt_l1"))).toBe("menus.m1.elements.e1.default.lore");
  });

  it("records show_title title + subtitle inside click handlers", () => {
    const p = pack({
      menus: [
        {
          id: "m1" as never,
          projectId: "p1" as never,
          title: [],
          rows: 3,
          layers: [
            {
              id: "l1" as never,
              name: "default",
              elements: [
                {
                  id: "e1" as never,
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
                                title: { key: k("lt_st_title") },
                                subtitle: { key: k("lt_st_sub") },
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
    const u = findKeyUsages(p);
    expect(u.get(k("lt_st_title"))).toBe("menus.m1.elements.e1.default.click.left.show_title.title");
    expect(u.get(k("lt_st_sub"))).toBe("menus.m1.elements.e1.default.click.left.show_title.subtitle");
  });
});

describe("findKeyUsages — dialogs", () => {
  it("records dialog title, body text, input/option/button labels, and button step actions", () => {
    const p = pack({
      dialogs: [
        {
          id: "d1" as never,
          projectId: "p1" as never,
          title: { key: k("lt_d_title") },
          canCloseWithEscape: true,
          body: [
            { type: "text", text: { key: k("lt_d_body") } },
            { type: "item", material: "STONE", count: 1 },
          ],
          inputs: [
            { type: "text", id: "name", label: { key: k("lt_d_in") }, default: "", maxLength: 32 },
            {
              type: "single_option",
              id: "color",
              label: { key: k("lt_d_opt_label") },
              options: [{ value: "r", label: { key: k("lt_d_opt") } }],
              default: "r",
            },
          ],
          buttons: [
            {
              id: "ok",
              label: { key: k("lt_d_btn") },
              steps: [
                {
                  kind: "action",
                  action: { type: "send_message", text: { key: k("lt_d_btn_msg") } },
                },
              ],
            },
          ],
        },
      ],
    });
    const u = findKeyUsages(p);
    expect(u.get(k("lt_d_title"))).toBe("dialogs.d1.title");
    expect(u.get(k("lt_d_body"))).toBe("dialogs.d1.body[0]");
    expect(u.get(k("lt_d_in"))).toBe("dialogs.d1.inputs.name.label");
    expect(u.get(k("lt_d_opt_label"))).toBe("dialogs.d1.inputs.color.label");
    expect(u.get(k("lt_d_opt"))).toBe("dialogs.d1.inputs.color.options.r.label");
    expect(u.get(k("lt_d_btn"))).toBe("dialogs.d1.buttons.ok.label");
    expect(u.get(k("lt_d_btn_msg"))).toBe("dialogs.d1.buttons.ok.message");
  });
});

describe("buildTranslationRows", () => {
  it("marks keys with no usage as (unused) and used keys with their context", () => {
    const p = pack({
      menus: [
        {
          id: "m1" as never,
          projectId: "p1" as never,
          title: [{ kind: "text", value: { key: k("lt_used") }, x: 0, y: 0 }],
          rows: 3,
          layers: [],
        },
      ],
      i18nKeys: {
        [k("lt_used")]: { en: "Hello" },
        [k("lt_orphan")]: { en: "Stale" },
      },
    });
    const rows = buildTranslationRows(p, "en");
    const used = rows.find((r) => r.key === k("lt_used"));
    const orphan = rows.find((r) => r.key === k("lt_orphan"));
    expect(used?.context).toBe("menus.m1.title");
    expect(orphan?.context).toBe("(unused)");
  });

  it("sorts (unused) rows after used rows so real translations lead", () => {
    const p = pack({
      menus: [
        {
          id: "m1" as never,
          projectId: "p1" as never,
          title: [{ kind: "text", value: { key: k("lt_used") }, x: 0, y: 0 }],
          rows: 3,
          layers: [],
        },
      ],
      i18nKeys: {
        [k("lt_orphan")]: { en: "Stale" },
        [k("lt_used")]: { en: "Hello" },
      },
    });
    const rows = buildTranslationRows(p, "en");
    expect(rows.map((r) => r.context)).toEqual(["menus.m1.title", "(unused)"]);
  });
});

describe("findUnusedI18nKeys", () => {
  it("returns only the keys not referenced anywhere in the pack", () => {
    const p = pack({
      menus: [
        {
          id: "m1" as never,
          projectId: "p1" as never,
          title: [{ kind: "text", value: { key: k("lt_used") }, x: 0, y: 0 }],
          rows: 3,
          layers: [],
        },
      ],
      i18nKeys: {
        [k("lt_used")]: { en: "Hello" },
        [k("lt_orphan1")]: { en: "A" },
        [k("lt_orphan2")]: { en: "B" },
      },
    });
    expect(findUnusedI18nKeys(p).sort()).toEqual([k("lt_orphan1"), k("lt_orphan2")]);
  });
});
