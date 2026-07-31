import { elementId, layerId, menuId, projectId } from "@/domain/ids";
import type { I18nKey, Project } from "@/domain/types";
import { validateMenuV1 } from "@/schema/validateMenuV1";
import { describe, expect, it } from "vitest";
import { packToMenuV1, serializeMenuToV1 } from "./transform";

function pack(): Project {
  return {
    id: projectId("p"),
    name: "P",
    source: "user_created",
    createdAt: "",
    updatedAt: "",
    defaultLang: "en",
    i18nKeys: { k: { en: "Shop" } } as Project["i18nKeys"],
    menus: [
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
              { id: elementId("e1"), positions: "0", appearances: [{ material: "STONE" }] },
            ],
          },
        ],
      },
    ],
    commands: [],
    dialogs: [],
    assets: [],
    dataSources: [],
    importedConnectors: [],
    canvasLayout: {},
  } as Project;
}

describe("serializeMenuToV1 / packToMenuV1", () => {
  it("produces a canonical menu/v1 object that validates", () => {
    const p = pack();
    const m = serializeMenuToV1(p.menus[0], p);
    expect(m.schema).toBe("menu/v1");
    expect(m.size).toBe(27);
    expect(validateMenuV1(m)).toEqual({ valid: true, errors: [] });
  });
  it("packToMenuV1 returns one object per menu", () => {
    const p = pack();
    const arr = packToMenuV1(p);
    expect(arr).toHaveLength(1);
    expect(arr[0].id).toBe("shop");
  });
});
