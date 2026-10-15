import { describe, expect, it } from "vitest";
import { dataModelId, dataSourceId } from "./ids";
import type { DataModel, DataSource, Project } from "./types";
import {
  applyFieldEdit,
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

const stubProject = (): Project =>
  ({
    id: "p1",
    name: "P",
    documents: {
      menu: [],
      command: [],
      dialog: [],
    },
    assets: [],
    dataSources: [],
    dataModels: [RANK],
    i18nKeys: {},
    defaultLang: "en",
    canvasLayout: {},
  }) as unknown as Project;

describe("findDataModel", () => {
  it("resolves by id, undefined when absent", () => {
    const project = stubProject();
    expect(findDataModel(project, RANK.id)?.name).toBe("rank");
    expect(findDataModel(project, dataModelId("nope"))).toBeUndefined();
  });
});

describe("wouldCreateModelCycle", () => {
  const a = dataModelId("a");
  const b = dataModelId("b");
  const c = dataModelId("c");
  const models: DataModel[] = [
    { id: a, name: "a", keyField: "id", fields: [{ name: "b", type: { kind: "model", ref: b } }] },
    {
      id: b,
      name: "b",
      keyField: "id",
      fields: [{ name: "x", type: { kind: "list", of: { kind: "model", ref: c } } }],
    },
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
  it("seeds minimessage kinds as empty strings", () => {
    expect(defaultValueForModelType({ kind: "minimessage" })).toBe("");
    expect(defaultValueForModelType({ kind: "minimessage_multiline" })).toBe("");
  });
  it("recurses objects and resolves model refs via the models list", () => {
    const v = defaultValueForModelType({ kind: "model", ref: RANK.id }, [RANK]) as Record<
      string,
      unknown
    >;
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
  it("maps minimessage kinds to string", () => {
    expect(modelFieldTypeToFieldType({ kind: "minimessage" })).toEqual({ kind: "string" });
    expect(modelFieldTypeToFieldType({ kind: "minimessage_multiline" })).toEqual({
      kind: "string",
    });
    expect(modelFieldTypeToFieldType({ kind: "list", of: { kind: "minimessage" } })).toEqual({
      kind: "list",
      of: { kind: "string" },
    });
  });
  it("survives a (theoretically impossible) model cycle without recursing forever", () => {
    const a = dataModelId("a");
    const loop: DataModel[] = [
      {
        id: a,
        name: "a",
        keyField: "id",
        fields: [{ name: "self", type: { kind: "model", ref: a } }],
      },
    ];
    const t = modelFieldTypeToFieldType({ kind: "model", ref: a }, loop);
    expect(t.kind).toBe("object");
  });
});

describe("tableRowType", () => {
  it("derives the legacy FieldType of a table source (list of object)", () => {
    const project = stubProject();
    const ds: DataSource = {
      id: dataSourceId("ranks"),
      name: "ranks",
      shape: "table",
      modelId: RANK.id,
      rows: [],
    };
    const t = tableRowType(project, ds);
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
    const project = stubProject();
    project.dataSources = [legacy as unknown as DataSource, table];
    Reflect.deleteProperty(project, "dataModels");
    normalizeDataSources(project);
    expect(project.dataSources).toEqual([table]);
    expect(project.dataModels).toEqual([]);
  });
});

describe("applyFieldEdit", () => {
  // A project with: rank model (used by two tables + nested in cat model), a config.
  function migProject(): Project {
    const rank: DataModel = {
      id: dataModelId("m_rank"),
      name: "rank",
      keyField: "id",
      fields: [
        { name: "id", type: { kind: "string" } },
        { name: "name", type: { kind: "ltext" } },
        { name: "price", type: { kind: "number" } },
        {
          name: "meta",
          type: { kind: "object", fields: [{ name: "tag", type: { kind: "string" } }] },
        },
      ],
    };
    const cat: DataModel = {
      id: dataModelId("m_cat"),
      name: "cat",
      keyField: "id",
      fields: [
        { name: "id", type: { kind: "string" } },
        { name: "top", type: { kind: "model", ref: rank.id } },
      ],
    };
    const project = {
      id: "p1",
      name: "P",
      documents: {
        menu: [],
        command: [],
        dialog: [],
      },
      assets: [],
      dataModels: [rank, cat],
      dataSources: [
        {
          id: dataSourceId("ranks"),
          name: "ranks",
          shape: "table",
          modelId: rank.id,
          rows: [
            { id: "vip", name: { key: "lt_vip" }, price: 9.99, meta: { tag: "a" } },
            { id: "elite", name: { key: "lt_elite" }, price: 19.99, meta: { tag: "b" } },
          ],
        },
        {
          id: dataSourceId("cats"),
          name: "cats",
          shape: "table",
          modelId: cat.id,
          rows: [
            { id: "c1", top: { id: "vip", name: { key: "lt_top" }, price: 1, meta: { tag: "c" } } },
          ],
        },
        {
          id: dataSourceId("settings"),
          name: "settings",
          shape: "config",
          fields: [{ name: "motd", type: { kind: "ltext" } }],
          value: { motd: { key: "lt_motd" } },
        },
      ],
      i18nKeys: {
        lt_vip: { en: "VIP" },
        lt_elite: { en: "Elite" },
        lt_top: { en: "Top" },
        lt_motd: { en: "Hello" },
      },
      defaultLang: "en",
      canvasLayout: {},
    } as unknown as Project;
    return project;
  }

  const model = (project: Project) => project.dataModels!.find((m) => m.name === "rank")!;
  const rows = (project: Project) =>
    (project.dataSources.find((d) => d.name === "ranks") as { rows: Record<string, unknown>[] })
      .rows;
  const catRow = (project: Project) =>
    (project.dataSources.find((d) => d.name === "cats") as { rows: Record<string, unknown>[] })
      .rows[0]!;

  it("add: appends the field and seeds defaults in every instance (incl. nested model refs)", () => {
    const project = migProject();
    applyFieldEdit(
      project,
      { kind: "model", modelId: model(project).id },
      {
        op: "add",
        path: [],
        field: { name: "perks", type: { kind: "list", of: { kind: "ltext" } } },
      },
    );
    expect(model(project).fields.map((f) => f.name)).toContain("perks");
    expect(rows(project)[0]!.perks).toEqual([]);
    expect((catRow(project).top as Record<string, unknown>).perks).toEqual([]);
  });

  it("rename: renames the field and moves the data everywhere", () => {
    const project = migProject();
    applyFieldEdit(
      project,
      { kind: "model", modelId: model(project).id },
      {
        op: "rename",
        path: [],
        oldName: "price",
        newName: "cost",
      },
    );
    expect(model(project).fields.some((f) => f.name === "cost")).toBe(true);
    expect(rows(project)[0]!.cost).toBe(9.99);
    expect(rows(project)[0]!.price).toBeUndefined();
    expect((catRow(project).top as Record<string, unknown>).cost).toBe(1);
  });

  it("rename on a nested path migrates nested objects", () => {
    const project = migProject();
    applyFieldEdit(
      project,
      { kind: "model", modelId: model(project).id },
      {
        op: "rename",
        path: ["meta"],
        oldName: "tag",
        newName: "label",
      },
    );
    expect((rows(project)[0]!.meta as Record<string, unknown>).label).toBe("a");
    expect((rows(project)[1]!.meta as Record<string, unknown>).tag).toBeUndefined();
  });

  it("remove: drops the field, its data, and releases its i18n keys", () => {
    const project = migProject();
    applyFieldEdit(
      project,
      { kind: "model", modelId: model(project).id },
      {
        op: "remove",
        path: [],
        name: "name",
      },
    );
    expect(model(project).fields.some((f) => f.name === "name")).toBe(false);
    expect(rows(project)[0]!.name).toBeUndefined();
    expect(project.i18nKeys["lt_vip" as never]).toBeUndefined();
    expect(project.i18nKeys["lt_elite" as never]).toBeUndefined();
    // Nested instance released too.
    expect(project.i18nKeys["lt_top" as never]).toBeUndefined();
    // Unrelated keys untouched.
    expect(project.i18nKeys["lt_motd" as never]).toEqual({ en: "Hello" });
  });

  it("retype string→ltext wraps the value as a defaultLang translation", () => {
    const project = migProject();
    applyFieldEdit(
      project,
      { kind: "model", modelId: model(project).id },
      {
        op: "retype",
        path: [],
        name: "id",
        newType: { kind: "ltext" },
      },
    );
    const v = rows(project)[0]!.id as { key: string };
    expect(typeof v.key).toBe("string");
    expect(project.i18nKeys[v.key as never]).toEqual({ en: "vip" });
  });

  it("retype ltext→string keeps the defaultLang text and releases the key", () => {
    const project = migProject();
    applyFieldEdit(
      project,
      { kind: "model", modelId: model(project).id },
      {
        op: "retype",
        path: [],
        name: "name",
        newType: { kind: "string" },
      },
    );
    expect(rows(project)[0]!.name).toBe("VIP");
    expect(project.i18nKeys["lt_vip" as never]).toBeUndefined();
  });

  it("retype ltext→minimessage keeps the defaultLang text and releases the key", () => {
    const project = migProject();
    applyFieldEdit(
      project,
      { kind: "model", modelId: model(project).id },
      {
        op: "retype",
        path: [],
        name: "name",
        newType: { kind: "minimessage" },
      },
    );
    expect(rows(project)[0]!.name).toBe("VIP");
    expect(project.i18nKeys["lt_vip" as never]).toBeUndefined();
  });

  it("retype minimessage→ltext mints an LText from the raw markup", () => {
    const project = migProject();
    applyFieldEdit(
      project,
      { kind: "model", modelId: model(project).id },
      {
        op: "retype",
        path: [],
        name: "id",
        newType: { kind: "minimessage" },
      },
    );
    expect(rows(project)[0]!.id).toBe("vip");
    applyFieldEdit(
      project,
      { kind: "model", modelId: model(project).id },
      {
        op: "retype",
        path: [],
        name: "id",
        newType: { kind: "ltext" },
      },
    );
    const v = rows(project)[0]!.id as { key: string };
    expect(project.i18nKeys[v.key as never]).toEqual({ en: "vip" });
  });

  it("retype minimessage→number parses, number→minimessage stringifies", () => {
    const project = migProject();
    applyFieldEdit(
      project,
      { kind: "model", modelId: model(project).id },
      {
        op: "retype",
        path: [],
        name: "price",
        newType: { kind: "minimessage" },
      },
    );
    expect(rows(project)[0]!.price).toBe("9.99");
    applyFieldEdit(
      project,
      { kind: "model", modelId: model(project).id },
      {
        op: "retype",
        path: [],
        name: "price",
        newType: { kind: "number" },
      },
    );
    expect(rows(project)[0]!.price).toBe(9.99);
  });

  it("retype incompatible resets to the new type's default and releases lost ltexts", () => {
    const project = migProject();
    applyFieldEdit(
      project,
      { kind: "model", modelId: model(project).id },
      {
        op: "retype",
        path: [],
        name: "name",
        newType: { kind: "boolean" },
      },
    );
    expect(rows(project)[0]!.name).toBe(false);
    expect(project.i18nKeys["lt_vip" as never]).toBeUndefined();
  });

  it("edits a config source's own fields", () => {
    const project = migProject();
    const settings = project.dataSources.find((d) => d.name === "settings")!;
    applyFieldEdit(
      project,
      { kind: "config", sourceId: settings.id },
      {
        op: "rename",
        path: [],
        oldName: "motd",
        newName: "welcome",
      },
    );
    const ds = project.dataSources.find((d) => d.name === "settings") as {
      fields: { name: string }[];
      value: Record<string, unknown>;
    };
    expect(ds.fields[0]!.name).toBe("welcome");
    expect(ds.value.welcome).toEqual({ key: "lt_motd" });
    expect(ds.value.motd).toBeUndefined();
  });
});
