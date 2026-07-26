// ADR bare-data-files T2: the exporter writes BARE data files — pure values,
// ltext inlined as the default language's literal, schema beside the data
// (models/<sourceId>.yaml doc or ref, minimal _source.yaml for per-row), and
// generated comments from model hints. Locked as a files-level fixed point
// with the T1 tolerant importer.
import type { DataModelId, DataSourceId, ProjectId } from "@/domain/types";
import { parse } from "yaml";
import { describe, expect, it } from "vitest";
import { adoptBareLTexts } from "@/domain/i18nSites";
import { projectFromFiles } from "@/schema/projectFromFiles";
import { transform } from "./transform";

const PID = "p_bare_out" as ProjectId;
const base = `plugins/Artisan/projects/${PID}`;

function basePack(): Record<string, unknown> {
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
    menus: [],
    commands: [],
    dialogs: [],
    itemTemplates: [],
    dataModels: [],
    dataSources: [],
    canvasLayout: {},
    canvasEdges: {},
  };
}

describe("bare export (ADR bare-data-files T2)", () => {
  it("declared per-row table: minimal _source.yaml, literal ltext rows, no defaultLang key", () => {
    const pack = {
      ...basePack(),
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
    const files = transform(pack as never);

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
    const fr = parse(files[`${base}/lang/fr.yaml`]!) as Record<string, string>;
    expect(fr["sources.categories.armes.name"]).toBeUndefined();
    const en = parse(files[`${base}/lang/en.yaml`]!) as Record<string, string>;
    expect(en["sources.categories.armes.name"]).toBe("Weapons");
    // Declared models never emitted.
    expect(Object.keys(files).filter((k) => k.includes("/models/"))).toEqual([]);
  });

  it("single-file table with an OWNED project model: bare list + models/<sourceId>.yaml doc", () => {
    const pack = {
      ...basePack(),
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
    const files = transform(pack as never);

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
    const pack = {
      ...basePack(),
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
    const files = transform(pack as never);

    expect(parse(files[`${base}/data/settings.yaml`]!)).toEqual({ motd: "Welcome", discount: 5 });
    const doc = parse(files[`${base}/models/settings.yaml`]!) as Record<string, unknown>;
    expect(doc.name).toBe("Réglages");
    expect(Array.isArray(doc.fields)).toBe(true);
  });

  it("model hints become generated comments; a hand-written header survives the round-trip", () => {
    const pack = {
      ...basePack(),
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
    const files = transform(pack as never);
    const dataFile = files[`${base}/data/settings.yaml`]!;
    expect(dataFile).toContain("# discount: Remise globale en % (0-100)");

    // Hand-written header (leading comment lines before the generated block)
    // is captured at import and re-emitted verbatim.
    const edited = { ...files };
    edited[`${base}/data/settings.yaml`] = `# ma note perso\n${dataFile}`;
    const p2 = projectFromFiles(PID, edited, { name: "Bare Out" });
    const files2 = transform(p2);
    expect(files2[`${base}/data/settings.yaml`]!.startsWith("# ma note perso\n")).toBe(true);
    // The generated block is not duplicated.
    const occurrences = files2[`${base}/data/settings.yaml`]!.split("# discount:").length - 1;
    expect(occurrences).toBe(1);
  });

  it("files → domain → files is a fixed point on the bare forms", () => {
    const pack = {
      ...basePack(),
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
    const files1 = transform(pack as never);
    // Declared models arrive via Presence, not files — reinject + adopt the
    // bare literals, the way the loader does after injection.
    const p2 = projectFromFiles(PID, files1, { name: "Bare Out" });
    (p2.dataModels ??= []).push((pack.dataModels as never[])[0]! as never);
    const cats = p2.dataSources.find((d) => d.id === ("categories" as DataSourceId));
    if (cats?.shape !== "table") throw new Error("expected table");
    adoptBareLTexts(p2, cats);
    const files2 = transform(p2);
    expect(files2).toEqual(files1);
  });
});
