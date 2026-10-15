// ADR bare-data-files: the exporter writes BARE data files — pure values,
// ltext inlined as the default language's literal, schema beside the data
// (models/<sourceId>.yaml doc or ref, minimal _source.yaml for per-row), and
// generated comments from model hints. Locked as a files-level fixed point
// with the tolerant importer.
import type { DataModelId, DataSourceId, ProjectId } from "@/domain/types";
import { parse } from "yaml";
import { flattenLangTree } from "@/lib/langTree";
import { describe, expect, it } from "vitest";
import { adoptBareLTexts } from "@/domain/i18nSites";
import { projectFromFiles } from "@/schema/projectFromFiles";
import { transform } from "./transform";

const PID = "p_bare_out" as ProjectId;
const base = `plugins/Artisan/projects/${PID}`;

function baseProject(): Record<string, unknown> {
  const now = "2026-07-26T00:00:00.000Z";
  return {
    id: PID,
    name: "Bare Out",
    source: "imported",
    createdAt: now,
    updatedAt: now,
    defaultLang: "fr",
    languages: ["fr", "en"],
    i18nKeys: {},
    documents: {
      menu: [],
      command: [],
      dialog: [],
    },
    dataModels: [],
    dataSources: [],
    canvasLayout: {},
    canvasEdges: {},
  };
}

describe("bare export (ADR bare-data-files T2)", () => {
  it("declared per-row table: minimal _source.yaml, literal ltext rows, no defaultLang key", () => {
    const project = {
      ...baseProject(),
      i18nKeys: { "sources.categories.armes.name": { fr: "Armes", en: "Weapons" } },
      dataModels: [
        {
          id: "boutique:category" as DataModelId,
          name: "Catégorie",
          keyField: "id",
          provenance: "module",
          version: 1,
          fields: [
            { name: "id", type: { kind: "string" } },
            { name: "name", type: { kind: "ltext" } },
          ],
        },
      ],
      dataSources: [
        {
          id: "categories" as DataSourceId,
          name: "Catégories",
          shape: "table",
          modelId: "boutique:category" as DataModelId,
          granularity: "row",
          modelVersion: 1,
          rows: [{ id: "armes", name: { key: "sources.categories.armes.name" } }],
        },
      ],
    };
    const files = transform(project as never);

    const meta = parse(files[`${base}/data/categories/_source.yaml`]!) as Record<string, unknown>;
    expect(meta).toEqual({
      name: "Catégories",
      model: "boutique:category",
      model_version: 1,
      order: ["armes"],
    });
    // Row = pure values, ltext = the DEFAULT language's literal.
    const row = parse(files[`${base}/data/categories/armes.yaml`]!) as Record<string, unknown>;
    expect(row).toEqual({ id: "armes", name: "Armes" });
    // Default lang file no longer carries data-only keys; other langs keep
    // them under the canonical key-site address.
    const fr = flattenLangTree(parse(files[`${base}/lang/fr.yaml`]!));
    expect(fr["sources.categories.armes.name"]).toBeUndefined();
    const en = flattenLangTree(parse(files[`${base}/lang/en.yaml`]!));
    expect(en["sources.categories.armes.name"]).toBe("Weapons");
    // Declared models never emitted.
    expect(Object.keys(files).filter((k) => k.includes("/models/"))).toEqual([]);
  });

  it("single-file table with an OWNED project model: bare list + models/<sourceId>.yaml doc", () => {
    const project = {
      ...baseProject(),
      defaultLang: "en",
      i18nKeys: { k_vip: { en: "VIP" } },
      dataModels: [
        {
          id: "mdl_ranks" as DataModelId,
          name: "Ranks",
          keyField: "id",
          fields: [
            { name: "id", type: { kind: "string" } },
            { name: "name", type: { kind: "ltext" } },
          ],
        },
      ],
      dataSources: [
        {
          id: "ranks" as DataSourceId,
          name: "Ranks",
          shape: "table",
          modelId: "mdl_ranks" as DataModelId,
          rows: [{ id: "vip", name: { key: "k_vip" } }],
        },
      ],
    };
    const files = transform(project as never);

    // Data file is a top-level LIST of pure values.
    expect(parse(files[`${base}/data/ranks.yaml`]!)).toEqual([{ id: "vip", name: "VIP" }]);
    // The owned model doc lives at models/<sourceId>.yaml, identity preserved
    // inside; no duplicate models/mdl_ranks.yaml.
    const doc = parse(files[`${base}/models/ranks.yaml`]!) as Record<string, unknown>;
    expect(doc.id).toBe("mdl_ranks");
    expect(doc.name).toBe("Ranks");
    expect(files[`${base}/models/mdl_ranks.yaml`]).toBeUndefined();
  });

  it("config: bare mapping + models/<sourceId>.yaml fields doc", () => {
    const project = {
      ...baseProject(),
      defaultLang: "en",
      i18nKeys: { k_motd: { en: "Welcome" } },
      dataSources: [
        {
          id: "settings" as DataSourceId,
          name: "Réglages",
          shape: "config",
          fields: [
            { name: "motd", type: { kind: "ltext" } },
            { name: "discount", type: { kind: "number" } },
          ],
          value: { motd: { key: "k_motd" }, discount: 5 },
        },
      ],
    };
    const files = transform(project as never);

    expect(parse(files[`${base}/data/settings.yaml`]!)).toEqual({ motd: "Welcome", discount: 5 });
    const doc = parse(files[`${base}/models/settings.yaml`]!) as Record<string, unknown>;
    expect(doc.name).toBe("Réglages");
    expect(Array.isArray(doc.fields)).toBe(true);
  });

  it("model hints become generated comments; a hand-written header survives the round-trip", () => {
    const project = {
      ...baseProject(),
      defaultLang: "en",
      dataSources: [
        {
          id: "settings" as DataSourceId,
          name: "Réglages",
          shape: "config",
          fields: [
            { name: "discount", type: { kind: "number" }, help: "Remise globale en % (0-100)" },
          ],
          value: { discount: 0 },
        },
      ],
    };
    const files = transform(project as never);
    const dataFile = files[`${base}/data/settings.yaml`]!;
    // The hint sits above the key it documents (ADR yaml-assisted-editing ⑥).
    expect(dataFile).toContain("# Remise globale en % (0-100)\ndiscount: 0");

    // Hand-written header (leading comment lines before the generated block)
    // is captured at import and re-emitted verbatim.
    const edited = { ...files };
    edited[`${base}/data/settings.yaml`] = `# ma note perso\n${dataFile}`;
    const p2 = projectFromFiles(PID, edited, { name: "Bare Out" });
    const files2 = transform(p2);
    expect(files2[`${base}/data/settings.yaml`]!.startsWith("# ma note perso\n")).toBe(true);
    // The generated block is not duplicated.
    const occurrences = files2[`${base}/data/settings.yaml`]!.split("# ──").length - 1;
    expect(occurrences).toBe(1);
  });

  it("files → domain → files is a fixed point on the bare forms", () => {
    const project = {
      ...baseProject(),
      defaultLang: "fr",
      i18nKeys: { "sources.categories.armes.name": { fr: "Armes", en: "Weapons" } },
      dataModels: [
        {
          id: "boutique:category" as DataModelId,
          name: "Catégorie",
          keyField: "id",
          provenance: "module",
          version: 1,
          fields: [
            { name: "id", type: { kind: "string" } },
            { name: "name", type: { kind: "ltext" } },
          ],
        },
        {
          id: "mdl_ranks" as DataModelId,
          name: "Ranks",
          keyField: "id",
          fields: [
            { name: "id", type: { kind: "string" } },
            { name: "name", type: { kind: "ltext" } },
          ],
        },
      ],
      dataSources: [
        {
          id: "categories" as DataSourceId,
          name: "Catégories",
          shape: "table",
          modelId: "boutique:category" as DataModelId,
          granularity: "row",
          modelVersion: 1,
          rows: [{ id: "armes", name: { key: "sources.categories.armes.name" } }],
        },
        {
          id: "ranks" as DataSourceId,
          name: "Ranks",
          shape: "table",
          modelId: "mdl_ranks" as DataModelId,
          rows: [{ id: "vip", name: { key: "sources.ranks.vip.name" } }],
        },
        {
          id: "settings" as DataSourceId,
          name: "Réglages",
          shape: "config",
          fields: [{ name: "motd", type: { kind: "ltext" } }],
          value: { motd: { key: "sources.réglages.motd" } },
        },
      ],
    };
    const files1 = transform(project as never);
    // Declared models arrive via Presence, not files — reinject + adopt the
    // bare literals, the way the loader does after injection.
    const p2 = projectFromFiles(PID, files1, { name: "Bare Out" });
    p2.dataModels ??= [];
    p2.dataModels.push((project.dataModels as never[])[0]! as never);
    const cats = p2.dataSources.find((d) => d.id === ("categories" as DataSourceId));
    if (cats?.shape !== "table") throw new Error("expected table");
    adoptBareLTexts(p2, cats);
    const files2 = transform(p2);
    expect(files2).toEqual(files1);
  });
});

// A schemaless source (bare file with no model beside it — ADR bare-data-files
// ③ "untyped = literal values, never an error") must round-trip verbatim.
// Field-driven serialization used to drop every key, emptying the file to `{}`.
describe("schemaless config source", () => {
  it("emits its stored values verbatim and invents no schema file", () => {
    const project = {
      ...baseProject(),
      dataSources: [
        {
          id: "shop_settings" as DataSourceId,
          name: "shop_settings",
          shape: "config",
          fields: [],
          value: { whole_shop_discount: 10, nested: { a: true }, list: [1, 2] },
        },
      ],
    } as never;
    const files = transform(project);
    const out = parse(files[`${base}/data/shop_settings.yaml`]!);
    expect(out).toEqual({ whole_shop_discount: 10, nested: { a: true }, list: [1, 2] });
    expect(files[`${base}/models/shop_settings.yaml`]).toBeUndefined();
  });

  it("survives a full re-import round-trip", () => {
    const project = {
      ...baseProject(),
      dataSources: [
        {
          id: "shop_settings" as DataSourceId,
          name: "shop_settings",
          shape: "config",
          fields: [],
          value: { whole_shop_discount: 10 },
        },
      ],
    } as never;
    const back = projectFromFiles(PID, transform(project));
    const src = back.dataSources.find((d) => d.id === ("shop_settings" as DataSourceId));
    if (src?.shape !== "config") throw new Error("expected config shape");
    expect(src.value).toEqual({ whole_shop_discount: 10 });
  });
});

// Same trap for a table whose declared model is momentarily unavailable (server
// offline, module removed): serializing rows against an empty field list used
// to blank every row. The rows are the user's data — they travel verbatim.
describe("table whose declared model is missing", () => {
  it("keeps its rows verbatim instead of emptying them", () => {
    const project = {
      ...baseProject(),
      dataModels: [],
      dataSources: [
        {
          id: "categories" as DataSourceId,
          name: "Catégories",
          shape: "table",
          modelId: "boutique:category" as DataModelId,
          rows: [{ id: "weapons", name: "Armes", discount: 5 }],
        },
      ],
    } as never;
    const files = transform(project);
    const written = files[`${base}/data/categories.yaml`]!;
    expect(parse(written)).toEqual([{ id: "weapons", name: "Armes", discount: 5 }]);
  });
});

// ADR yaml-assisted-editing ⑥/⑨: the schema's help lands as a comment ABOVE the
// key it documents (bare-data-files ⑦ as written), and the generated header is
// honest about hand-written comments being overwritten.
describe("schema hints become per-key comments", () => {
  const model = {
    id: "mdl_settings" as DataModelId,
    name: "Réglages",
    keyField: "id",
    fields: [
      {
        name: "whole_shop_discount",
        type: { kind: "integer" },
        label: "Remise globale",
        help: "Remise appliquée à toute la boutique (0 à 100).",
      },
      {
        name: "placeholders",
        type: {
          kind: "object",
          fields: [
            {
              name: "price_display",
              type: { kind: "string" },
              help: "Placeholder disponible : %price%.",
            },
          ],
        },
      },
    ],
  };

  function projectWith(value: Record<string, unknown>) {
    return {
      ...baseProject(),
      dataModels: [model],
      dataSources: [
        {
          id: "shop_settings" as DataSourceId,
          name: "Réglages",
          shape: "config",
          fields: model.fields,
          value,
        },
      ],
    } as never;
  }

  it("puts each help line directly above its key, at any depth", () => {
    const files = transform(
      projectWith({ whole_shop_discount: 10, placeholders: { price_display: "%price% tokens" } }),
    );
    const out = files[`${base}/data/shop_settings.yaml`]!;
    const lines = out.split("\n");
    const at = (key: string) => lines.findIndex((l) => l.trimStart().startsWith(key));

    expect(lines[at("whole_shop_discount:") - 1]).toContain("Remise appliquée à toute la boutique");
    expect(lines[at("price_display:") - 1]).toContain("%price%");
    // The old shape — a flat list of hints in the header — is gone.
    expect(out).not.toMatch(/^# whole_shop_discount: /m);
  });

  it("states that hand-written comments are overwritten", () => {
    const out = transform(projectWith({ whole_shop_discount: 10 }))[
      `${base}/data/shop_settings.yaml`
    ]!;
    expect(out).toMatch(/^# ──/m);
    expect(out.toLowerCase()).toContain("overwritten");
  });

  it("still round-trips: comments carry no data", () => {
    const value = { whole_shop_discount: 10, placeholders: { price_display: "%price% tokens" } };
    const back = projectFromFiles(PID, transform(projectWith(value)));
    const src = back.dataSources.find((d) => d.id === ("shop_settings" as DataSourceId));
    if (src?.shape !== "config") throw new Error("expected config shape");
    expect(src.value).toEqual(value);
  });
});
