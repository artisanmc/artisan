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
    const project = buildScratchProject(screen, files, [model]);
    const src = project.dataSources.find((d) => d.id === ("categories" as DataSourceId));
    expect(src).toBeDefined();
    if (src?.shape !== "table") throw new Error("expected table shape");
    expect(src.rows.map((r) => r.id)).toEqual(["weapons"]);
    const injected = (project.dataModels ?? []).find((m) => m.id === "boutique:category");
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
    const project = buildScratchProject(screen, files, [model]);
    const src = project.dataSources.find((d) => d.id === ("categories" as DataSourceId));
    if (src?.shape !== "table") throw new Error("expected table shape");
    src.rows[0]!.name = "Armures";

    let diff = diffScratchForWrite(project, screen, files);
    expect(diff.deletes).toEqual([]);
    expect(diff.files.some((f) => f.path === "data/categories/weapons.yaml" && f.content.includes("Armures"))).toBe(true);
    expect(diff.files.every((f) => f.path.startsWith("data/categories/"))).toBe(true);

    src.rows.splice(0, 1);
    diff = diffScratchForWrite(project, screen, files);
    expect(diff.deletes).toEqual(["data/categories/weapons.yaml"]);
  });

  // A project-authored Config source carries its schema in `models/<id>.yaml`
  // beside the data file. Saving the screen must carry it along — filtering it
  // out silently stripped the schema from disk, leaving an untyped file (and
  // an empty form on the next open).
  describe("project-authored config source with a beside model", () => {
    const settings: ServerEditorScreen = {
      id: "boutique:settings",
      moduleId: "boutique",
      label: "Réglages",
      table: "data/shop_settings",
      projectId: "boutique",
    };
    const settingsFiles = [
      { path: "data/shop_settings.yaml", content: "whole_shop_discount: 5\n" },
      {
        path: "models/shop_settings.yaml",
        content:
          "schema: model/v1\nid: shop_settings\nname: shop_settings\nfields:\n  - name: whole_shop_discount\n    type:\n      kind: integer\n",
      },
    ];

    it("types the config source from the beside model", () => {
      const project = buildScratchProject(settings, settingsFiles, []);
      const src = project.dataSources.find((d) => d.id === ("shop_settings" as DataSourceId));
      if (src?.shape !== "config") throw new Error("expected config shape");
      expect(src.fields.map((f) => f.name)).toEqual(["whole_shop_discount"]);
      expect(src.value.whole_shop_discount).toBe(5);
    });

    // The real regression: the file on disk carried its schema INLINE (legacy
    // form). The canonical writer emits values-only + `models/<id>.yaml`, so a
    // save that keeps only the data file destroys the schema.
    it("emits the beside model when saving a legacy inline-schema file", () => {
      const legacy = [
        {
          path: "data/shop_settings.yaml",
          content:
            "schema: data/v1\nid: shop_settings\nshape: config\nfields:\n  - name: whole_shop_discount\n    kind: integer\nvalue:\n  whole_shop_discount: 5\n",
        },
      ];
      const project = buildScratchProject(settings, legacy, []);
      const src = project.dataSources.find((d) => d.id === ("shop_settings" as DataSourceId));
      if (src?.shape !== "config") throw new Error("expected config shape");
      expect(src.fields.map((f) => f.name)).toEqual(["whole_shop_discount"]);
      src.value.whole_shop_discount = 10;

      const diff = diffScratchForWrite(project, settings, legacy);
      const written = new Map(diff.files.map((f) => [f.path, f.content]));
      expect(written.has("models/shop_settings.yaml")).toBe(true);

      // Re-reading exactly what is now on disk keeps the source typed.
      const after = new Map(legacy.map((f) => [f.path, f.content]));
      for (const [p, c] of written) after.set(p, c);
      for (const p of diff.deletes) after.delete(p);
      const reread = buildScratchProject(settings, [...after].map(([path, content]) => ({ path, content })), []);
      const src2 = reread.dataSources.find((d) => d.id === ("shop_settings" as DataSourceId));
      if (src2?.shape !== "config") throw new Error("expected config shape");
      expect(src2.fields.map((f) => f.name)).toEqual(["whole_shop_discount"]);
      expect(src2.value.whole_shop_discount).toBe(10);
    });

    it("rewrites the beside model along with the data file, and never deletes it", () => {
      const project = buildScratchProject(settings, settingsFiles, []);
      const src = project.dataSources.find((d) => d.id === ("shop_settings" as DataSourceId));
      if (src?.shape !== "config") throw new Error("expected config shape");
      src.value.whole_shop_discount = 10;

      const diff = diffScratchForWrite(project, settings, settingsFiles);
      expect(diff.files.some((f) => f.path === "data/shop_settings.yaml" && f.content.includes("10"))).toBe(true);
      expect(diff.deletes).toEqual([]);
      // The schema survives the round-trip: re-reading the written set keeps it typed.
      const after = new Map(settingsFiles.map((f) => [f.path, f.content]));
      for (const f of diff.files) after.set(f.path, f.content);
      const reread = buildScratchProject(settings, [...after].map(([path, content]) => ({ path, content })), []);
      const src2 = reread.dataSources.find((d) => d.id === ("shop_settings" as DataSourceId));
      if (src2?.shape !== "config") throw new Error("expected config shape");
      expect(src2.fields.map((f) => f.name)).toEqual(["whole_shop_discount"]);
    });
  });

  // ADR yaml-assisted-editing: a Config file may be typed by a MODULE-DECLARED
  // model (the schema arrives via Presence, never from the project files) — the
  // beside file is then a one-line ref, not a schema copy.
  describe("config source typed by a declared model", () => {
    const settings: ServerEditorScreen = {
      id: "boutique:settings",
      moduleId: "boutique",
      label: "Réglages",
      table: "data/shop_settings",
      projectId: "boutique",
    };
    const declared = {
      schema: "model/v1",
      id: "boutique:shop_settings",
      name: "Réglages boutique",
      fields: [
        { name: "whole_shop_discount", type: { kind: "integer" }, label: "Remise globale", min: 0, max: 100 },
      ],
    };
    const files = [
      { path: "data/shop_settings.yaml", content: "whole_shop_discount: 10\n" },
      { path: "models/shop_settings.yaml", content: "model: boutique:shop_settings\n" },
    ];

    it("resolves its fields from the declaration", () => {
      const project = buildScratchProject(settings, files, [declared]);
      const src = project.dataSources.find((d) => d.id === ("shop_settings" as DataSourceId));
      if (src?.shape !== "config") throw new Error("expected config shape");
      expect(src.fields.map((f) => f.name)).toEqual(["whole_shop_discount"]);
      expect(src.fields[0]!.label).toBe("Remise globale");
      expect(src.value.whole_shop_discount).toBe(10);
    });

    it("keeps the beside file a one-line ref — a declared schema is never copied to disk", () => {
      const project = buildScratchProject(settings, files, [declared]);
      const src = project.dataSources.find((d) => d.id === ("shop_settings" as DataSourceId));
      if (src?.shape !== "config") throw new Error("expected config shape");
      src.value.whole_shop_discount = 20;

      const diff = diffScratchForWrite(project, settings, files);
      const beside = diff.files.find((f) => f.path === "models/shop_settings.yaml");
      // Either untouched (identical) or rewritten as the same one-line ref —
      // never expanded into a copy of the declaration.
      if (beside) {
        expect(beside.content).toContain("model: boutique:shop_settings");
        expect(beside.content).not.toContain("whole_shop_discount");
      }
      expect(diff.files.some((f) => f.path === "data/shop_settings.yaml" && f.content.includes("20"))).toBe(true);
    });
  });

  it("never emits files outside the screen's table", () => {
    const project = buildScratchProject(screen, files, [model]);
    const src = project.dataSources.find((d) => d.id === ("categories" as DataSourceId));
    if (src?.shape !== "table") throw new Error("expected table shape");
    src.rows[0]!.name = "Armures";
    const diff = diffScratchForWrite(project, screen, files);
    for (const f of diff.files) expect(f.path.startsWith("data/categories")).toBe(true);
  });
});
