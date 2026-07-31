import { describe, expect, it } from "vitest";
import { dataModelId, dataSourceId } from "./ids";
import {
  nextAvailableSourceRowKey,
  validateSourceRowKey,
} from "./dataSourceRowKeys";
import type { DataModel, DataSource, Project } from "./types";

function tableSource(kind: "string" | "number" | "integer", rows: Record<string, unknown>[]): Extract<DataSource, { shape: "table" }> {
  return {
    id: dataSourceId("members"),
    name: "members",
    shape: "table",
    modelId: dataModelId("member"),
    rows,
  };
}

function projectFor(kind: "string" | "number" | "integer"): Project {
  const model: DataModel = {
    id: dataModelId("member"),
    name: "member",
    keyField: "id",
    fields: [{ name: "id", type: { kind } }],
  };
  return {
    id: "project",
    name: "Project",
    menus: [],
    commands: [],
    assets: [],
    dataSources: [],
    dataModels: [model],
    i18nKeys: {},
    defaultLang: "en",
    dialogs: [],
    canvasLayout: {},
  } as unknown as Project;
}

describe("source row keys", () => {
  it("generates the first missing string row key", () => {
    const project = projectFor("string");
    const source = tableSource("string", [{ id: "row_1" }, { id: "row_3" }]);

    expect(nextAvailableSourceRowKey(project, source)).toBe("row_2");
  });

  it("generates the first missing integer row key", () => {
    const project = projectFor("integer");
    const source = tableSource("integer", [{ id: 1 }, { id: 3 }]);

    expect(nextAvailableSourceRowKey(project, source)).toBe(2);
  });

  it("rejects a string key that duplicates another row ignoring case and whitespace", () => {
    const project = projectFor("string");
    const source = tableSource("string", [{ id: "vip" }]);

    expect(validateSourceRowKey(project, source, -1, " VIP ")).toEqual({ ok: false, reason: "duplicate" });
  });

  it("returns the normalized string key when available", () => {
    const project = projectFor("string");
    const source = tableSource("string", [{ id: "vip" }]);

    expect(validateSourceRowKey(project, source, -1, " Elite ")).toEqual({ ok: true, value: "elite" });
  });

  it("rejects a whitespace-only string key as required", () => {
    const project = projectFor("string");
    const source = tableSource("string", []);

    expect(validateSourceRowKey(project, source, -1, "   ")).toEqual({ ok: false, reason: "required" });
  });

  it("accepts a numeric key already held by the current row", () => {
    const project = projectFor("number");
    const source = tableSource("number", [{ id: 1 }, { id: 2 }]);

    expect(validateSourceRowKey(project, source, 0, "1")).toEqual({ ok: true, value: 1 });
  });
});
