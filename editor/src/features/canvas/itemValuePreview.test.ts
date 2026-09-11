import type { Project } from "@/domain/types";
import { describe, expect, it } from "vitest";
import { previewItem } from "./itemValuePreview";

describe("catalog item preview", () => {
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
