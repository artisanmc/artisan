// Bare data emission (ADR bare-data-files): data files are PURE VALUES —
// ltext inlined as the default language's literal, schema beside the data in
// models/ (owned doc at the source's filename, or a `model:` ref), minimal
// per-row _source.yaml. Same semantic coverage as the old data/v1 suite,
// relocked on the bare forms.
import type { Project, ProjectId } from "@/domain/types";
import { flattenLangTree } from "@/lib/langTree";
import { projectFromFiles } from "@/schema/projectFromFiles";
import { describe, expect, it } from "vitest";
import { parse } from "yaml";
import { projectToFiles } from "./projectToFiles";

const PID = "p1" as ProjectId;

function makeProject(): Project {
  return {
    id: PID,
    name: "p",
    source: "user_created",
    createdAt: "",
    updatedAt: "",
    documents: {
      menu: [],
      command: [],
      dialog: [],
    },
    assets: [],
    dataModels: [
      {
        id: "m_rank",
        name: "rank",
        keyField: "id",
        fields: [
          { name: "id", type: { kind: "string" } },
          { name: "name", type: { kind: "ltext" } },
          { name: "icon", type: { kind: "item" } },
          { name: "perks", type: { kind: "list", of: { kind: "ltext" } } },
        ],
      },
      {
        id: "m_cat",
        name: "cat",
        keyField: "id",
        fields: [
          { name: "id", type: { kind: "string" } },
          { name: "featured", type: { kind: "model", ref: "m_rank" } },
        ],
      },
    ],
    dataSources: [
      {
        id: "ranks",
        name: "ranks",
        shape: "table",
        modelId: "m_rank",
        rows: [
          {
            id: "vip",
            name: { key: "sources.ranks.vip.name" },
            icon: "item:ci_1",
            perks: [{ key: "sources.ranks.vip.perks" }],
          },
        ],
      },
      {
        id: "cats",
        name: "cats",
        shape: "table",
        modelId: "m_cat",
        rows: [
          {
            id: "c1",
            featured: {
              id: "vip",
              name: { key: "sources.cats.c1.featured.name" },
              icon: "",
              perks: [],
            },
          },
        ],
      },
      {
        id: "settings",
        name: "settings",
        shape: "config",
        fields: [
          { name: "currency", type: { kind: "string" } },
          { name: "motd", type: { kind: "ltext" } },
          { name: "broadcast", type: { kind: "minimessage" } },
          { name: "rules", type: { kind: "minimessage_multiline" } },
          { name: "on_join", type: { kind: "actions" } },
        ],
        value: {
          currency: "coins",
          motd: { key: "sources.settings.motd" },
          broadcast: "<gold>Hello",
          rules: "<red>Rule 1\nRule 2",
          on_join: 'broadcast "hi"\ngive_item DIAMOND 1',
        },
      },
    ],
    i18nKeys: {
      "sources.ranks.vip.name": { en: "VIP", fr: "V.I.P." },
      "sources.ranks.vip.perks": { en: "Fly" },
      "sources.cats.c1.featured.name": { en: "Nested" },
      "sources.settings.motd": { en: "Welcome" },
    },
    defaultLang: "en",
    canvasLayout: {},
  } as unknown as Project;
}

const BASE = `plugins/Artisan/projects/${PID}`;

describe("bare data export", () => {
  it("round-trips complete item values without flattening their metadata", () => {
    const p = makeProject();
    const icon = { material: "item:ci_1", count: 3, enchants: { sharpness: 5 }, unbreakable: true };
    const source = p.dataSources[0] as Extract<Project["dataSources"][number], { shape: "table" }>;
    source.rows[0]!.icon = icon;
    const files = projectToFiles(p);
    expect(parse(files[`${BASE}/data/ranks.yaml`]!)[0].icon).toEqual(icon);
    const imported = projectFromFiles(PID, files);
    const importedSource = imported.dataSources.find((s) => s.id === "ranks") as typeof source;
    expect(importedSource.rows[0]!.icon).toEqual(icon);
  });
  it("emits one BARE data/<id>.yaml per table source — a list of pure-value rows", () => {
    const files = projectToFiles(makeProject());
    const ranks = parse(files[`${BASE}/data/ranks.yaml`]!);
    // ltext values inline the DEFAULT language's literal; item refs verbatim.
    expect(ranks).toEqual([{ id: "vip", name: "VIP", icon: "item:ci_1", perks: ["Fly"] }]);
  });

  it("a model shared via a model-kind ref links through a one-line models/<sourceId>.yaml ref", () => {
    const files = projectToFiles(makeProject());
    // m_rank is referenced by m_cat's `featured` field — shared, so the
    // source links by ref and the model keeps its own doc.
    expect(parse(files[`${BASE}/models/ranks.yaml`]!)).toEqual({ model: "m_rank" });
    const rank = parse(files[`${BASE}/models/m_rank.yaml`]!);
    expect(rank.id).toBe("m_rank");
    expect(rank.fields[1]).toEqual({ name: "name", type: { kind: "ltext" } });
  });

  it("an OWNED model's doc lives at models/<sourceId>.yaml, cross-model refs preserved", () => {
    const files = projectToFiles(makeProject());
    const cats = parse(files[`${BASE}/data/cats.yaml`]!);
    expect(cats).toEqual([
      { id: "c1", featured: { id: "vip", name: "Nested", icon: "", perks: [] } },
    ]);
    const doc = parse(files[`${BASE}/models/cats.yaml`]!);
    expect(doc.id).toBe("m_cat");
    // Refs stay refs — models/ is the editor's lossless store.
    expect(doc.fields[1]).toEqual({ name: "featured", type: { kind: "model", ref: "m_rank" } });
    expect(files[`${BASE}/models/m_cat.yaml`]).toBeUndefined();
  });

  it("config sources are a bare mapping + a fields doc beside", () => {
    const files = projectToFiles(makeProject());
    expect(parse(files[`${BASE}/data/settings.yaml`]!)).toEqual({
      currency: "coins",
      motd: "Welcome",
      broadcast: "<gold>Hello",
      rules: "<red>Rule 1\nRule 2",
      // actions keep their DSL string verbatim.
      on_join: 'broadcast "hi"\ngive_item DIAMOND 1',
    });
    const doc = parse(files[`${BASE}/models/settings.yaml`]!);
    expect(doc.name).toBe("settings");
    // Fields are VERBATIM domain fields — minimessage kinds survive lossless
    // (the runtime is tolerant: unknown kinds pass values through).
    expect(doc.fields).toEqual([
      { name: "currency", type: { kind: "string" } },
      { name: "motd", type: { kind: "ltext" } },
      { name: "broadcast", type: { kind: "minimessage" } },
      { name: "rules", type: { kind: "minimessage_multiline" } },
      { name: "on_join", type: { kind: "actions" } },
    ]);
  });

  it("default-language file drops data-only keys; other languages keep the canonical address", () => {
    const files = projectToFiles(makeProject());
    const en = flattenLangTree(parse(files[`${BASE}/lang/en.yaml`]!));
    expect(en?.["sources.ranks.vip.name"]).toBeUndefined();
    expect(en?.["sources.settings.motd"]).toBeUndefined();
    const fr = flattenLangTree(parse(files[`${BASE}/lang/fr.yaml`]!));
    expect(fr["sources.ranks.vip.name"]).toBe("V.I.P.");
  });
});

// Composable kinds: map / enum / union

describe("bare export — map / enum / union kinds", () => {
  const B = `plugins/Artisan/projects/${PID}`;

  function questsProject(): Project {
    return {
      id: PID,
      name: "p",
      source: "user_created",
      createdAt: "",
      updatedAt: "",
      documents: {
        menu: [],
        command: [],
        dialog: [],
      },
      assets: [],
      dataModels: [
        {
          id: "m_action",
          name: "action",
          keyField: "id",
          fields: [
            {
              name: "act",
              type: {
                kind: "union",
                tag: "type",
                variants: [
                  { name: "message", fields: [{ name: "text", type: { kind: "ltext" } }] },
                  { name: "command", fields: [{ name: "run", type: { kind: "string" } }] },
                ],
              },
            },
          ],
        },
        {
          id: "m_quest",
          name: "quest",
          keyField: "id",
          fields: [
            { name: "id", type: { kind: "string" } },
            { name: "strategy", type: { kind: "enum", values: ["sequential", "random"] } },
            { name: "tiers", type: { kind: "map", of: { kind: "model", ref: "m_action" } } },
          ],
        },
      ],
      dataSources: [
        {
          id: "quests",
          name: "quests",
          shape: "table",
          modelId: "m_quest",
          rows: [
            {
              id: "daily",
              strategy: "sequential",
              tiers: {
                gold: {
                  act: {
                    type: "message",
                    text: { key: "sources.quests.daily.tiers.gold.act.text" },
                  },
                },
                silver: { act: { type: "command", run: "say hi" } },
              },
            },
          ],
        },
      ],
      i18nKeys: {
        "sources.quests.daily.tiers.gold.act.text": { en: "Well done!", fr: "Bravo !" },
      },
      defaultLang: "en",
      canvasLayout: {},
    } as unknown as Project;
  }

  it("serializes values bare: enum as string, map entries by `of`, union by active variant (tag kept), ltext literal", () => {
    const files = projectToFiles(questsProject());
    const data = parse(files[`${B}/data/quests.yaml`]!);
    expect(data).toEqual([
      {
        id: "daily",
        strategy: "sequential",
        tiers: {
          gold: { act: { type: "message", text: "Well done!" } },
          silver: { act: { type: "command", run: "say hi" } },
        },
      },
    ]);
  });

  it("keeps the union/map shape verbatim in the owned model doc; nested ltext addresses reach lang/", () => {
    const files = projectToFiles(questsProject());
    const doc = parse(files[`${B}/models/quests.yaml`]!);
    expect(doc.id).toBe("m_quest");
    expect(doc.fields[2]).toEqual({
      name: "tiers",
      type: { kind: "map", of: { kind: "model", ref: "m_action" } },
    });
    // m_action is model-kind-referenced → its own doc.
    expect(parse(files[`${B}/models/m_action.yaml`]!).id).toBe("m_action");
    const fr = flattenLangTree(parse(files[`${B}/lang/fr.yaml`]!));
    expect(fr["sources.quests.daily.tiers.gold.act.text"]).toBe("Bravo !");
  });
});

// Per-row file granularity

describe("bare export — per-row file granularity", () => {
  const B = `plugins/Artisan/projects/${PID}`;

  function perRowProject(): Project {
    return {
      id: PID,
      name: "p",
      source: "user_created",
      createdAt: "",
      updatedAt: "",
      documents: {
        menu: [],
        command: [],
        dialog: [],
      },
      assets: [],
      dataModels: [
        {
          id: "m_cat2",
          name: "category",
          keyField: "id",
          fields: [
            { name: "id", type: { kind: "string" } },
            { name: "label", type: { kind: "ltext" } },
          ],
        },
      ],
      dataSources: [
        {
          id: "cats2",
          name: "categories",
          shape: "table",
          modelId: "m_cat2",
          granularity: "row",
          rows: [
            { id: "weekly", label: { key: "sources.categories.weekly.label" } },
            { id: "daily", label: { key: "sources.categories.daily.label" } },
          ],
        },
      ],
      i18nKeys: {
        "sources.categories.weekly.label": { en: "Weekly" },
        "sources.categories.daily.label": { en: "Daily" },
      },
      defaultLang: "en",
      canvasLayout: {},
    } as unknown as Project;
  }

  it("emits a MINIMAL _source.yaml (name/model/order) and bare row files", () => {
    const files = projectToFiles(perRowProject());
    expect(files[`${B}/data/cats2.yaml`]).toBeUndefined();
    expect(parse(files[`${B}/data/cats2/_source.yaml`]!)).toEqual({
      name: "categories",
      model: "m_cat2",
      order: ["weekly", "daily"],
    });
    expect(parse(files[`${B}/data/cats2/weekly.yaml`]!)).toEqual({ id: "weekly", label: "Weekly" });
    expect(parse(files[`${B}/data/cats2/daily.yaml`]!)).toEqual({ id: "daily", label: "Daily" });
    // Owned model doc at the source's filename.
    expect(parse(files[`${B}/models/cats2.yaml`]!).id).toBe("m_cat2");
  });
});
