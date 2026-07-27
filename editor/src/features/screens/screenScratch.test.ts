import type { DataSourceId } from "@/domain/types";
import type { ServerEditorScreen } from "@/lib/api/configScreens";
import { describe, expect, it } from "vitest";
import { buildScratchProject, diffScratchForWrite, isScreenScratchId, screenScratchId } from "./screenScratch";

const screen: ServerEditorScreen = {
  id: "boutique:catalog",
  moduleId: "boutique",
  label: "Catalogue",
  table: "data/categories",
  projectId: "boutique",
};

const model = {
  schema: "model/v1",
  id: "boutique:category",
  name: "Category",
  key_field: "id",
  version: 1,
  fields: [
    { name: "id", type: { kind: "string" } },
    { name: "name", type: { kind: "string" } },
  ],
};

const files = [
  { path: "data/categories/_source.yaml", content: "name: Catégories\nmodel: boutique:category\nmodel_version: 1\norder: [weapons]\n" },
  { path: "data/categories/weapons.yaml", content: "id: weapons\nname: Armes\n" },
];

describe("screenScratchId", () => {
  it("mints a scratch id flagged by isScreenScratchId", () => {
    const id = screenScratchId("boutique:catalog");
    expect(isScreenScratchId(id)).toBe(true);
    expect(isScreenScratchId("boutique")).toBe(false);
  });
});

describe("buildScratchProject", () => {
  it("parses the table files into a project source with the declared model injected", () => {
    const pack = buildScratchProject(screen, files, [model]);
    const src = pack.dataSources.find((d) => d.id === ("categories" as DataSourceId));
    expect(src).toBeDefined();
    if (src?.shape !== "table") throw new Error("expected table shape");
    expect(src.rows.map((r) => r.id)).toEqual(["weapons"]);
    const injected = (pack.dataModels ?? []).find((m) => m.id === "boutique:category");
    expect(injected?.provenance).toBe("module");
  });
});

describe("diffScratchForWrite", () => {
  it("is idempotent: a canonical round-trip produces no writes and no deletes", () => {
    // Hand-written YAML may differ from the canonical writer's formatting, so
    // the FIRST save may rewrite files byte-identically-in-meaning. What must
    // hold is the fixed point: once canonical, no edits → no writes.
    const first = buildScratchProject(screen, files, [model]);
    const canonical = new Map(files.map((f) => [f.path, f.content]));
    for (const f of diffScratchForWrite(first, screen, files).files) canonical.set(f.path, f.content);
    const canonicalFiles = [...canonical].map(([path, content]) => ({ path, content }));

    const second = buildScratchProject(screen, canonicalFiles, [model]);
    const diff = diffScratchForWrite(second, screen, canonicalFiles);
    expect(diff.files).toEqual([]);
    expect(diff.deletes).toEqual([]);
  });

  it("an edited row rewrites only its file; a removed row deletes its file", () => {
    const pack = buildScratchProject(screen, files, [model]);
    const src = pack.dataSources.find((d) => d.id === ("categories" as DataSourceId));
    if (src?.shape !== "table") throw new Error("expected table shape");
    src.rows[0]!.name = "Armures";

    let diff = diffScratchForWrite(pack, screen, files);
    expect(diff.deletes).toEqual([]);
    expect(diff.files.some((f) => f.path === "data/categories/weapons.yaml" && f.content.includes("Armures"))).toBe(true);
    expect(diff.files.every((f) => f.path.startsWith("data/categories/"))).toBe(true);

    src.rows.splice(0, 1);
    diff = diffScratchForWrite(pack, screen, files);
    expect(diff.deletes).toEqual(["data/categories/weapons.yaml"]);
  });

  it("never emits files outside the screen's table", () => {
    const pack = buildScratchProject(screen, files, [model]);
    const src = pack.dataSources.find((d) => d.id === ("categories" as DataSourceId));
    if (src?.shape !== "table") throw new Error("expected table shape");
    src.rows[0]!.name = "Armures";
    const diff = diffScratchForWrite(pack, screen, files);
    for (const f of diff.files) expect(f.path.startsWith("data/categories")).toBe(true);
  });
});
