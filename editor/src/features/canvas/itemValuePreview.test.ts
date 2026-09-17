import type { Project } from "@/domain/types";
import { describe, expect, it } from "vitest";
import { previewItem } from "./itemValuePreview";
import { resolveItem } from "./resolveItem";

describe("catalog item preview", () => {
  it("keeps old menu lore references usable after a catalogue-only migration", () => {
    const project = { defaultLang: "en", i18nKeys: {} } as unknown as Project;
    const item = {
      icon: { extends: { material: "STONE", lore: ["Original"] }, lore: ["{base.lore}", "Rare"] },
      lore: "",
    };
    expect(
      resolveItem({ item: "{item.icon}", lore: ["{item.lore}", "Price"] }, { item }, project, "en")
        .lore,
    ).toEqual(["Original", "Rare", "Price"]);
  });
  it("preserves domain custom model data through a template override", () => {
    const project = { defaultLang: "en", i18nKeys: {} } as unknown as Project;
    expect(
      resolveItem(
        { extends: { material: "STONE", custom_model_data: "1" }, customModelData: "2" },
        {},
        project,
        "en",
      ).customModelData,
    ).toBe("2");
  });
  it("distinguishes absent, empty and extended lore and reports circular references", () => {
    const project = { id: "p", defaultLang: "en", i18nKeys: {} } as unknown as Project;
    const original = { material: "STONE", title: "Original", lore: ["Inherited"] };
    expect(resolveItem({ extends: original }, {}, project, "en").lore).toEqual(["Inherited"]);
    expect(
      resolveItem({ extends: original, title: "", lore: [] }, {}, project, "en"),
    ).toMatchObject({ title: "", lore: ["Inherited"] });
    expect(
      resolveItem({ extends: original, lore: [""], lore_mode: "replace" }, {}, project, "en").lore,
    ).toEqual([]);
    expect(resolveItem("{loop}", { loop: { extends: "{loop}" } }, project, "en").error).toMatch(
      /circular/i,
    );
  });

  it("keeps the base lore above added lines, extension or not, unless replacement is explicit", () => {
    const project = { id: "p", defaultLang: "en", i18nKeys: {} } as unknown as Project;
    const original = { material: "STONE", lore: ["Captured"] };
    expect(resolveItem({ extends: original, lore: ["Added"] }, {}, project, "en").lore).toEqual([
      "Captured",
      "Added",
    ]);
    expect(
      resolveItem({ extends: original, lore: ["Added"], lore_mode: "replace" }, {}, project, "en")
        .lore,
    ).toEqual(["Added"]);
  });

  it("lets an explicit {base.lore} position the base lore instead of duplicating it", () => {
    const project = { id: "p", defaultLang: "en", i18nKeys: {} } as unknown as Project;
    const original = { material: "STONE", lore: ["Captured"] };
    expect(
      resolveItem({ extends: original, lore: ["Offer", "{base.lore}"] }, {}, project, "en").lore,
    ).toEqual(["Offer", "Captured"]);
  });
  it("composes successive item extensions with the immediate base and current product", () => {
    const project = {
      id: "p",
      defaultLang: "en",
      i18nKeys: {},
      capturedItems: [],
    } as unknown as Project;
    const scope = {
      original: { material: "DIAMOND_SWORD", title: "Original", lore: ["Captured lore"], count: 2 },
      item: {
        name: "Rare sword",
        price: 100,
        icon: {
          extends: "{original}",
          title: "{item.name}",
          lore: ["{base.lore}", "Rare"],
          count: 4,
        },
      },
    };
    project.i18nKeys = { menuLore: { en: "Offer\n{base.lore}\nPrice: {item.price}" } };
    expect(
      previewItem(
        { item: "{item.icon}", lore: { key: "menuLore" }, loreMode: "replace" } as never,
        scope,
        project,
        "en",
      ),
    ).toMatchObject({
      material: "DIAMOND_SWORD",
      title: "Rare sword",
      count: 4,
      lore: ["Offer", "Captured lore", "Rare", "Price: 100"],
    });
  });
  it("keeps the icon quantity and enchantments beneath template overrides", () => {
    const project = {
      id: "p",
      defaultLang: "en",
      i18nKeys: {},
      capturedItems: [],
    } as unknown as Project;
    const scope = {
      item: { icon: { material: "DIAMOND_SWORD", count: 3, enchants: { sharpness: 5 } } },
    };
    expect(previewItem({ item: "{item.icon}" }, scope, project, "en")).toMatchObject({
      material: "DIAMOND_SWORD",
      count: 3,
      enchanted: true,
      enchants: [{ id: "sharpness", level: 5 }],
    });
    expect(previewItem({ material: "{item.icon}", count: 1 }, scope, project, "en").count).toBe(1);
  });
});
