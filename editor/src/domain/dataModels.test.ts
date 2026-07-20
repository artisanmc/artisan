import { describe, expect, it } from "vitest";
import { dataModelId, dataSourceId } from "./ids";
import type { DataModel, DataSource, Project } from "./types";
import {
  defaultValueForModelType,
  findDataModel,
  modelFieldTypeToFieldType,
  normalizeDataSources,
  tableRowType,
  wouldCreateModelCycle,
} from "./dataModels";

const RANK: DataModel = {
  id: dataModelId("m_rank"),
  name: "rank",
  keyField: "id",
  fields: [
    { name: "id", type: { kind: "string" } },
    { name: "name", type: { kind: "ltext" } },
    { name: "icon", type: { kind: "item" } },
    { name: "price", type: { kind: "number" } },
    { name: "perks", type: { kind: "list", of: { kind: "ltext" } } },
  ],
};

const stubPack = (): Project =>
  ({
    id: "p1",
    name: "P",
    menus: [],
    commands: [],
    templates: [],
    assets: [],
    dataSources: [],
    dataModels: [RANK],
    i18nKeys: {},
    defaultLang: "en",
    dialogs: [],
    canvasLayout: {},
  }) as unknown as Project;

describe("findDataModel", () => {
  it("resolves by id, undefined when absent", () => {
    const pack = stubPack();
    expect(findDataModel(pack, RANK.id)?.name).toBe("rank");
    expect(findDataModel(pack, dataModelId("nope"))).toBeUndefined();
  });
});

describe("wouldCreateModelCycle", () => {
  const a = dataModelId("a");
  const b = dataModelId("b");
  const c = dataModelId("c");
  const models: DataModel[] = [
    { id: a, name: "a", keyField: "id", fields: [{ name: "b", type: { kind: "model", ref: b } }] },
    { id: b, name: "b", keyField: "id", fields: [{ name: "x", type: { kind: "list", of: { kind: "model", ref: c } } }] },
    { id: c, name: "c", keyField: "id", fields: [] },
  ];
  it("rejects a ref that closes a loop (direct + transitive + self)", () => {
    // c → a would close c ← b ← a.
    expect(wouldCreateModelCycle(models, c, a)).toBe(true);
    expect(wouldCreateModelCycle(models, a, a)).toBe(true);
  });
  it("allows a forward ref", () => {
    expect(wouldCreateModelCycle(models, a, c)).toBe(false);
  });
});

describe("defaultValueForModelType", () => {
  it("seeds ltext as an unallocated LText node and item as empty ref", () => {
    expect(defaultValueForModelType({ kind: "ltext" })).toEqual({ key: "" });
    expect(defaultValueForModelType({ kind: "item" })).toBe("");
    expect(defaultValueForModelType({ kind: "list", of: { kind: "string" } })).toEqual([]);
  });
  it("recurses objects and resolves model refs via the models list", () => {
    const v = defaultValueForModelType({ kind: "model", ref: RANK.id }, [RANK]) as Record<string, unknown>;
    expect(v.id).toBe("");
    expect(v.name).toEqual({ key: "" });
    expect(v.perks).toEqual([]);
  });
});

describe("modelFieldTypeToFieldType", () => {
  it("maps ltext/item to string and resolves model refs", () => {
    const t = modelFieldTypeToFieldType({ kind: "model", ref: RANK.id }, [RANK]);
    expect(t).toEqual({
      kind: "object",
      fields: [
        { name: "id", type: { kind: "string" } },
        { name: "name", type: { kind: "string" } },
        { name: "icon", type: { kind: "string" } },
        { name: "price", type: { kind: "number" } },
        { name: "perks", type: { kind: "list", of: { kind: "string" } } },
      ],
    });
  });
  it("survives a (theoretically impossible) model cycle without recursing forever", () => {
    const a = dataModelId("a");
    const loop: DataModel[] = [
      { id: a, name: "a", keyField: "id", fields: [{ name: "self", type: { kind: "model", ref: a } }] },
    ];
    const t = modelFieldTypeToFieldType({ kind: "model", ref: a }, loop);
    expect(t.kind).toBe("object");
  });
});

describe("tableRowType", () => {
  it("derives the legacy FieldType of a table source (list of object)", () => {
    const pack = stubPack();
    const ds: DataSource = {
      id: dataSourceId("ranks"),
      name: "ranks",
      shape: "table",
      modelId: RANK.id,
      rows: [],
    };
    const t = tableRowType(pack, ds);
    expect(t).toEqual({
      kind: "list",
      of: modelFieldTypeToFieldType({ kind: "model", ref: RANK.id }, [RANK]),
    });
  });
});

describe("normalizeDataSources", () => {
  it("drops legacy sources (no shape) and keeps declared ones — the accepted reset", () => {
    const legacy = { id: "old", name: "old", type: { kind: "list" }, value: [] };
    const table: DataSource = {
      id: dataSourceId("ranks"),
      name: "ranks",
      shape: "table",
      modelId: RANK.id,
      rows: [],
    };
    const pack = stubPack();
    pack.dataSources = [legacy as unknown as DataSource, table];
    delete (pack as { dataModels?: unknown }).dataModels;
    normalizeDataSources(pack);
    expect(pack.dataSources).toEqual([table]);
    expect(pack.dataModels).toEqual([]);
  });
});
