import { menusOf } from "@/domain/documents";
import { elementId, layerId, menuId, projectId } from "@/domain/ids";
import type { I18nKey, Project } from "@/domain/types";
import { validateMenuV1 } from "@/schema/validateMenuV1";
import { describe, expect, it } from "vitest";
import { menuV1FromDomain, projectToMenuV1 } from "./menuV1FromDomain";

function project(): Project {
  return {
    id: projectId("p"),
    name: "P",
    source: "user_created",
    createdAt: "",
    updatedAt: "",
    defaultLang: "en",
    i18nKeys: { k: { en: "Shop" } } as Project["i18nKeys"],
    documents: {
      menu: [
        {
          id: menuId("shop"),
          projectId: projectId("p"),
          rows: 3,
          title: [{ kind: "plain", value: { key: "k" as I18nKey } }],
          layers: [
            {
              id: layerId("l1"),
              name: "default",
              elements: [
                { id: elementId("e1"), positions: "0", display: { material: "STONE" }, states: [] },
              ],
            },
          ],
        },
      ],
      command: [],
      dialog: [],
    },
    assets: [],
    dataSources: [],
    importedConnectors: [],
    canvasLayout: {},
  } as Project;
}

describe("menuV1FromDomain / projectToMenuV1", () => {
  it("produces a canonical menu/v1 object that validates", () => {
    const p = project();
    const m = menuV1FromDomain(menusOf(p)[0]!, p);
    expect(m.schema).toBe("menu/v1");
    expect(m.size).toBe(27);
    expect(validateMenuV1(m)).toEqual({ valid: true, errors: [] });
  });
  it("writes an element without positions (laid out by places) as an empty list", () => {
    const p = project();
    const menu = menusOf(p)[0]!;
    menu.layers[0]!.elements[0] = {
      id: elementId("grid"),
      positions: "",
      display: { material: "STONE" },
      states: [],
      places: { source: "cats", alias: "cat", keyField: "id", placements: [{ key: "a", page: 0, position: 4 }] },
    } as (typeof menu.layers)[0]["elements"][0];
    const m = menuV1FromDomain(menu, p);
    expect((m.elements as { positions: unknown }[])[0]!.positions).toEqual([]);
    expect(validateMenuV1(m)).toEqual({ valid: true, errors: [] });
  });
  it("projectToMenuV1 returns one object per menu", () => {
    const p = project();
    const arr = projectToMenuV1(p);
    expect(arr).toHaveLength(1);
    expect(arr[0]!.id).toBe("shop");
  });
});
