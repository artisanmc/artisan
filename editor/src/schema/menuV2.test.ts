import type { Project, ProjectId } from "@/domain/types";
import { serializeMenuToV1 } from "@/features/export/transform";
import { describe, expect, it } from "vitest";
import { menuV1ToDomain } from "./menuV1ToDomain";
import { validateMenuV1 } from "./validateMenuV1";

describe("explicit menu item binding", () => {
  const wire = {
    schema: "menu/v2",
    id: "shop",
    title: [],
    size: 9,
    layers: [
      {
        id: "main",
        name: "main",
        elements: [{ id: "icon", positions: "0", item: "{item.icon}", count: 1 }],
      },
    ],
  };
  it("validates and round-trips a full item binding with an explicit quantity", () => {
    expect(validateMenuV1(wire)).toEqual({ valid: true, errors: [] });
    const { menu } = menuV1ToDomain(wire, { projectId: "p" as ProjectId, lang: "fr" });
    const project = { id: "p", defaultLang: "fr", i18nKeys: {} } as Project;
    const result = serializeMenuToV1(menu, project);
    expect(result).toMatchObject({
      schema: "menu/v2",
      elements: [{ item: "{item.icon}", count: 1 }],
    });
    expect(validateMenuV1(result).valid).toBe(true);
  });
  it("rejects simultaneous item and material and keeps v1 strict", () => {
    const both = structuredClone(wire);
    Object.assign(both.layers[0]!.elements[0]!, { material: "STONE" });
    expect(validateMenuV1(both).valid).toBe(false);
    expect(validateMenuV1({ ...wire, schema: "menu/v1" }).valid).toBe(false);
  });
});
