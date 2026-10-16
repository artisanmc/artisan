import type { Project, ProjectId } from "@/domain/types";
import { describe, expect, it } from "vitest";
import { menuV1FromDomain } from "./menuV1FromDomain";
import { menuV1ToDomain } from "./menuV1ToDomain";
import { validateMenuV1 } from "./validateMenuV1";

describe("explicit menu item binding", () => {
  const wire = {
    schema: "menu/v1",
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
    const result = menuV1FromDomain(menu, project);
    expect(result).toMatchObject({
      schema: "menu/v1",
      elements: [{ item: "{item.icon}", count: 1 }],
    });
    expect(validateMenuV1(result).valid).toBe(true);
  });

  it("rejects simultaneous item and material", () => {
    const both = structuredClone(wire);
    Object.assign(both.layers[0]!.elements[0]!, { material: "STONE" });
    expect(validateMenuV1(both).valid).toBe(false);
  });

  it("round-trips explicit lore replacement and clearing", () => {
    const wireReplace = {
      ...wire,
      layers: [
        {
          ...wire.layers[0],
          elements: [
            { id: "icon", positions: "0", item: "{item.icon}", lore_mode: "replace", lore: [] },
          ],
        },
      ],
    };
    expect(validateMenuV1(wireReplace)).toEqual({ valid: true, errors: [] });
    const { menu, i18nKeys } = menuV1ToDomain(wireReplace, {
      projectId: "p" as ProjectId,
      lang: "en",
    });
    const project = { id: "p", defaultLang: "en", i18nKeys } as Project;
    expect(menu.layers[0]!.elements[0]!.display!.loreMode).toBe("replace");
    const result = menuV1FromDomain(menu, project);
    expect(result).toMatchObject({ schema: "menu/v1", elements: [{ lore_mode: "replace" }] });
    expect(validateMenuV1(result).valid).toBe(true);
  });

  // `menu/v2` and `menu/v3` were released as pure version bumps — the format
  // never diverged — and folded back into `menu/v1`. Files written while they
  // existed are still on disk, so reads stay tolerant; writes are always v1.
  it.each(["menu/v2", "menu/v3"])("still accepts a %s document written on disk", (schema) => {
    expect(validateMenuV1({ ...wire, schema })).toEqual({ valid: true, errors: [] });
  });

  it("rejects a schema version that never existed", () => {
    expect(validateMenuV1({ ...wire, schema: "menu/v9" }).valid).toBe(false);
  });
});
