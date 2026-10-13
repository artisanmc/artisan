import type { Appearance, Project } from "@/domain/types";
import { describe, expect, it } from "vitest";
import { normalizeBaseLore } from "./baseLore";

const displayOf = (project: Project): Appearance =>
  project.menus[0]!.layers[0]!.elements[0]!.display;
const keys = (project: Project): Record<string, Record<string, string>> =>
  project.i18nKeys as unknown as Record<string, Record<string, string>>;

const projectWith = (lore: { key: string }, keys: Record<string, Record<string, string>>) =>
  ({
    id: "p",
    defaultLang: "en",
    i18nKeys: keys,
    menus: [
      {
        id: "m",
        layers: [
          {
            elements: [{ id: "e", display: { loreMode: "replace", lore }, states: [] }],
          },
        ],
      },
    ],
  }) as unknown as Project;

describe("base lore normalization", () => {
  it("drops a leading {base.lore} in every language and with it the replacement flag", () => {
    const project = projectWith(
      { key: "k" },
      { k: { en: "{base.lore}\nRare", fr: "{base.lore}\nPrécieux" } },
    );
    normalizeBaseLore(project);
    expect(keys(project).k).toEqual({ en: "Rare", fr: "Précieux" });
    expect(displayOf(project).loreMode).toBeUndefined();
  });

  it("keeps a replacement whose token sits below its own lines", () => {
    const project = projectWith({ key: "k" }, { k: { en: "Offer\n{base.lore}" } });
    normalizeBaseLore(project);
    expect(keys(project).k).toEqual({ en: "Offer\n{base.lore}" });
    expect(displayOf(project).loreMode).toBe("replace");
  });

  it("keeps a replacement that only one language opens with the token", () => {
    const project = projectWith({ key: "k" }, { k: { en: "{base.lore}\nRare", fr: "Précieux" } });
    normalizeBaseLore(project);
    expect(keys(project).k).toEqual({ en: "{base.lore}\nRare", fr: "Précieux" });
  });

  it("clears the lore site when the token was all it held", () => {
    const project = projectWith({ key: "k" }, { k: { en: "{base.lore}" } });
    normalizeBaseLore(project);
    expect(displayOf(project).lore).toBeUndefined();
    expect(keys(project).k).toBeUndefined();
  });

  it("cleans item values buried in source rows", () => {
    const project = {
      id: "p",
      defaultLang: "en",
      i18nKeys: {},
      menus: [],
      dataSources: [
        {
          id: "categories",
          shape: "table",
          rows: [
            {
              items: [
                {
                  icon: { extends: "item:1", lore: ["{base.lore}", "Rare"], lore_mode: "replace" },
                },
                { icon: { extends: "item:2", lore: ["{base.lore}"], lore_mode: "replace" } },
                { icon: { extends: "item:3", lore: ["Offer"], lore_mode: "replace" } },
              ],
            },
          ],
        },
      ],
    } as unknown as Project;
    normalizeBaseLore(project);
    const table = project.dataSources![0] as unknown as {
      rows: { items: { icon: Record<string, unknown> }[] }[];
    };
    const icons = table.rows[0]!.items.map((i) => i.icon);
    expect(icons[0]).toEqual({ extends: "item:1", lore: ["Rare"] });
    expect(icons[1]).toEqual({ extends: "item:2" });
    expect(icons[2]).toEqual({ extends: "item:3", lore: ["Offer"], lore_mode: "replace" });
  });

  it("cleans row item values whose lore lines are LText nodes (the imported shape)", () => {
    const project = {
      id: "p",
      defaultLang: "fr",
      i18nKeys: {
        "sources.categories.vip.items.icon.lore": { fr: "{base.lore}", en: "{base.lore}" },
        "sources.categories.vip.items.icon.lore_2": { fr: "Rare", en: "Rare" },
      },
      menus: [],
      dataSources: [
        {
          id: "categories",
          shape: "table",
          rows: [
            {
              items: [
                {
                  icon: {
                    extends: "item:1",
                    lore: [
                      { key: "sources.categories.vip.items.icon.lore" },
                      { key: "sources.categories.vip.items.icon.lore_2" },
                    ],
                    lore_mode: "replace",
                  },
                },
              ],
            },
          ],
        },
      ],
    } as unknown as Project;
    normalizeBaseLore(project);
    const table = project.dataSources![0] as unknown as {
      rows: { items: { icon: Record<string, unknown> }[] }[];
    };
    expect(table.rows[0]!.items[0]!.icon).toEqual({
      extends: "item:1",
      lore: [{ key: "sources.categories.vip.items.icon.lore_2" }],
    });
    // The token's line disappears with its translations; the others keep theirs.
    expect(keys(project)["sources.categories.vip.items.icon.lore"]).toBeUndefined();
    expect(keys(project)["sources.categories.vip.items.icon.lore_2"]).toEqual({
      fr: "Rare",
      en: "Rare",
    });
  });

  it("leaves an LText lore line the token only prefixes in one language", () => {
    const project = {
      id: "p",
      defaultLang: "fr",
      i18nKeys: { line: { fr: "{base.lore}", en: "Rare" } },
      menus: [],
      dataSources: [
        {
          id: "categories",
          shape: "table",
          rows: [{ icon: { extends: "item:1", lore: [{ key: "line" }], lore_mode: "replace" } }],
        },
      ],
    } as unknown as Project;
    normalizeBaseLore(project);
    const table = project.dataSources![0] as unknown as {
      rows: { icon: Record<string, unknown> }[];
    };
    expect(table.rows[0]!.icon.lore_mode).toBe("replace");
  });
});
