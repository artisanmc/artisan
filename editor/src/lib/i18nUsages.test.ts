import type { I18nKey, Project } from "@/domain/types";
import { describe, expect, it } from "vitest";
import {
  buildTranslationRows,
  countMissingForLang,
  countMissingPerLang,
  findKeyUsages,
  findUnusedI18nKeys,
  validActiveLang,
} from "./i18nUsages";

const k = (s: string): I18nKey => s as I18nKey;

/** Minimal project scaffold; callers override the bits they exercise. */
function project(overrides: Partial<Project>): Project {
  return {
    id: "p1" as Project["id"],
    name: "P",
    source: "user_created",
    createdAt: "2026-01-01T00:00:00Z",
    updatedAt: "2026-01-01T00:00:00Z",
    defaultLang: "en",
    documents: {
      menu: [],
      command: [],
      dialog: [],
    },
    assets: [],
    dataSources: [],
    importedConnectors: [],
    canvasLayout: {},
    i18nKeys: {},
    ...overrides,
  };
}

describe("findKeyUsages", () => {
  it("records menu title text layers", () => {
    const p = project({
      documents: {
        menu: [
          {
            id: "m1" as never,
            projectId: "p1" as never,
            title: [{ kind: "text", value: { key: k("lt_title") }, x: 0, y: 0 }],
            rows: 3,
            layers: [],
          },
        ],
      },
    });
    expect(findKeyUsages(p).get(k("lt_title"))).toBe("menus.m1.title");
  });

  it("records element title and a single-LText lore", () => {
    const p = project({
      documents: {
        menu: [
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
                    display: {
                      title: { key: k("lt_t") },
                      lore: { key: k("lt_lore") },
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
    const u = findKeyUsages(p);
    expect(u.get(k("lt_t"))).toBe("menus.m1.elements.e1.default.title");
    expect(u.get(k("lt_lore"))).toBe("menus.m1.elements.e1.default.lore");
  });

  it("records lore stored as an array of LText (legacy-migrated shape)", () => {
    const p = project({
      documents: {
        menu: [
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
                    display: { lore: [{ key: k("lt_l0") }, { key: k("lt_l1") }] } as any,
                    states: [],
                  },
                ],
              },
            ],
          },
        ],
      },
    });
    const u = findKeyUsages(p);
    expect(u.get(k("lt_l0"))).toBe("menus.m1.elements.e1.default.lore");
    expect(u.get(k("lt_l1"))).toBe("menus.m1.elements.e1.default.lore");
  });

  it("records show_title title + subtitle inside click handlers", () => {
    const p = project({
      documents: {
        menu: [
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
                    display: {
                      click: {
                        left: {
                          steps: [
                            {
                              kind: "action",
                              action: {
                                name: "show_title",
                                value: {
                                  title: { key: k("lt_st_title") },
                                  subtitle: { key: k("lt_st_sub") },
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
    const u = findKeyUsages(p);
    expect(u.get(k("lt_st_title"))).toBe(
      "menus.m1.elements.e1.default.click.left.show_title.title",
    );
    expect(u.get(k("lt_st_sub"))).toBe(
      "menus.m1.elements.e1.default.click.left.show_title.subtitle",
    );
  });
});

describe("findKeyUsages — dialogs", () => {
  it("records dialog title, body text, input/option/button labels, and button step actions", () => {
    const p = project({
      documents: {
        dialog: [
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
              {
                type: "text",
                id: "name",
                label: { key: k("lt_d_in") },
                default: "",
                maxLength: 32,
              },
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
                    action: { name: "send_message", value: { key: k("lt_d_btn_msg") } },
                  },
                ],
              },
            ],
          },
        ],
      },
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
    const p = project({
      documents: {
        menu: [
          {
            id: "m1" as never,
            projectId: "p1" as never,
            title: [{ kind: "text", value: { key: k("lt_used") }, x: 0, y: 0 }],
            rows: 3,
            layers: [],
          },
        ],
      },
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
    const p = project({
      documents: {
        menu: [
          {
            id: "m1" as never,
            projectId: "p1" as never,
            title: [{ kind: "text", value: { key: k("lt_used") }, x: 0, y: 0 }],
            rows: 3,
            layers: [],
          },
        ],
      },
      i18nKeys: {
        [k("lt_orphan")]: { en: "Stale" },
        [k("lt_used")]: { en: "Hello" },
      },
    });
    const rows = buildTranslationRows(p, "en");
    expect(rows.map((r) => r.context)).toEqual(["menus.m1.title", "(unused)"]);
  });
});

describe("translation completeness", () => {
  it("does not count an intentionally blank source as missing", () => {
    const p = project({
      defaultLang: "fr",
      i18nKeys: { [k("blank")]: { fr: "", en: "" } },
    });

    expect(countMissingForLang(p, "fr")).toBe(0);
    expect(countMissingForLang(p, "en")).toBe(0);
    expect(countMissingPerLang(p)).toEqual({ en: 0 });
  });

  it("counts an empty target only when the source contains text", () => {
    const p = project({
      i18nKeys: {
        [k("translated")]: { en: "Hello", fr: "" },
        [k("blank")]: { en: "", fr: "" },
      },
    });

    expect(countMissingForLang(p, "fr")).toBe(1);
    expect(countMissingPerLang(p)).toEqual({ fr: 1 });
  });
});

describe("findUnusedI18nKeys", () => {
  it("returns only the keys not referenced anywhere in the project", () => {
    const p = project({
      documents: {
        menu: [
          {
            id: "m1" as never,
            projectId: "p1" as never,
            title: [{ kind: "text", value: { key: k("lt_used") }, x: 0, y: 0 }],
            rows: 3,
            layers: [],
          },
        ],
      },
      i18nKeys: {
        [k("lt_used")]: { en: "Hello" },
        [k("lt_orphan1")]: { en: "A" },
        [k("lt_orphan2")]: { en: "B" },
      },
    });
    expect(findUnusedI18nKeys(p).sort()).toEqual([k("lt_orphan1"), k("lt_orphan2")]);
  });
});

describe("findUnusedI18nKeys — keys read outside the documents", () => {
  const withKeys = (
    keys: Record<string, Record<string, string>>,
    overrides: Partial<Project> = {},
  ) => project({ i18nKeys: keys as Project["i18nKeys"], ...overrides });

  it("keeps an add-on's messages, a moved MessageBundle and the presentation keys", () => {
    const p = withKeys({
      "auctions.messages.no_item": { fr: "Tenez en main l'objet à vendre." },
      "guilds.created": { en: "Guild created" },
      "artisan.duration.hours": { en: "{n}h" },
      "menus.gone.title": { en: "Deleted menu" },
    });
    expect(findUnusedI18nKeys(p)).toEqual([k("menus.gone.title")]);
    const rows = buildTranslationRows(p, "en");
    expect(rows.find((r) => r.key === "auctions.messages.no_item")?.context).toBe("(lang/ only)");
    expect(rows.find((r) => r.key === "menus.gone.title")?.context).toBe("(unused)");
  });

  it("keeps a key another text points to with {i18n:key} or @key", () => {
    const p = withKeys({
      "menus.gone.title": { en: "Shared title" },
      "dialogs.gone.title": { en: "Shared too" },
      lt_reused: { en: "Shared lore" },
      lt_alone: { en: "Orphan" },
      "artisan.other": { en: "see {i18n:menus.gone.title} and {i18n:lt_reused}" },
    });
    p.dataSources = [
      {
        id: "rewards",
        shape: "object",
        fields: [],
        value: { action: "send_message @dialogs.gone.title" },
      },
    ] as unknown as Project["dataSources"];
    expect(findUnusedI18nKeys(p)).toEqual([k("lt_alone")]);
  });

  it("keeps the keys of a data source that still exists, even with no site yet", () => {
    const p = withKeys({
      "sources.rewards.vip.name": { en: "VIP" },
      "sources.removed.vip.name": { en: "Gone" },
    });
    p.dataSources = [
      { id: "rewards", shape: "table", modelId: "unknown_yet", rows: [{ id: "vip" }] },
    ] as unknown as Project["dataSources"];
    expect(findUnusedI18nKeys(p)).toEqual([k("sources.removed.vip.name")]);
  });
});

describe("validActiveLang", () => {
  it("keeps a language the project still has", () => {
    const p = project({ defaultLang: "fr", i18nKeys: { [k("a")]: { fr: "A", en: "A" } } });
    expect(validActiveLang(p, "en")).toBe("en");
  });

  it("falls back to the default when the language left the project", () => {
    const p = project({ defaultLang: "fr", i18nKeys: { [k("a")]: { fr: "A" } } });
    expect(validActiveLang(p, "en")).toBe("fr");
  });
});
