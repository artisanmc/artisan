import type { Project, ProjectId } from "@/domain/types";
import { parse } from "yaml";
import { describe, expect, it } from "vitest";
import { transform } from "./transform";

const PID = "p1" as ProjectId;

function makeProject(): Project {
  return {
    id: PID,
    name: "p",
    source: "user_created",
    createdAt: "",
    updatedAt: "",
    menus: [],
    commands: [],
    templates: [],
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
            featured: { id: "vip", name: { key: "sources.cats.c1.featured.name" }, icon: "", perks: [] },
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
    dialogs: [],
    canvasLayout: {},
  } as unknown as Project;
}

const BASE = `plugins/Artisan/projects/${PID}`;

describe("data/v1 export", () => {
  it("emits one denormalized data/<id>.yaml per source", () => {
    const files = transform(makeProject());
    const ranks = parse(files[`${BASE}/data/ranks.yaml`]!);
    expect(ranks.schema).toBe("data/v1");
    expect(ranks.id).toBe("ranks");
    expect(ranks.shape).toBe("table");
    expect(ranks.key_field).toBe("id");
    expect(ranks.fields).toEqual([
      { name: "id", kind: "string" },
      { name: "name", kind: "ltext" },
      { name: "icon", kind: "item" },
      { name: "perks", kind: "list", of: { kind: "ltext" } },
    ]);
    // ltext values export as their canonical i18n keys; item refs verbatim.
    expect(ranks.rows).toEqual([
      { id: "vip", name: "sources.ranks.vip.name", icon: "item:ci_1", perks: ["sources.ranks.vip.perks"] },
    ]);
  });

  it("inlines model refs — the bundle never sees model identity", () => {
    const files = transform(makeProject());
    const cats = parse(files[`${BASE}/data/cats.yaml`]!);
    expect(cats.fields).toEqual([
      { name: "id", kind: "string" },
      {
        name: "featured",
        kind: "object",
        fields: [
          { name: "id", kind: "string" },
          { name: "name", kind: "ltext" },
          { name: "icon", kind: "item" },
          { name: "perks", kind: "list", of: { kind: "ltext" } },
        ],
      },
    ]);
    expect(cats.rows[0].featured.name).toBe("sources.cats.c1.featured.name");
  });

  it("emits config sources with their value object (no key_field, no rows)", () => {
    const files = transform(makeProject());
    const settings = parse(files[`${BASE}/data/settings.yaml`]!);
    expect(settings.shape).toBe("config");
    expect(settings.key_field).toBeUndefined();
    expect(settings.rows).toBeUndefined();
    expect(settings.value).toEqual({
      currency: "coins",
      motd: "sources.settings.motd",
      broadcast: "<gold>Hello",
      rules: "<red>Rule 1\nRule 2",
      on_join: 'broadcast "hi"\ngive_item DIAMOND 1',
    });
  });

  it("exports minimessage fields as plain strings — data/v1 stays unchanged", () => {
    const files = transform(makeProject());
    const settings = parse(files[`${BASE}/data/settings.yaml`]!);
    expect(settings.fields).toEqual([
      { name: "currency", kind: "string" },
      { name: "motd", kind: "ltext" },
      { name: "broadcast", kind: "string" },
      { name: "rules", kind: "string" },
      { name: "on_join", kind: "actions" },
    ]);
  });

  it("exports an actions field as kind=actions with the DSL string verbatim", () => {
    const files = transform(makeProject());
    const settings = parse(files[`${BASE}/data/settings.yaml`]!);
    expect(settings.fields).toContainEqual({ name: "on_join", kind: "actions" });
    expect(settings.value.on_join).toBe('broadcast "hi"\ngive_item DIAMOND 1');
  });

  it("emits models/<id>.yaml verbatim (model refs preserved — lossless)", () => {
    const files = transform(makeProject());
    const rank = parse(files[`plugins/Artisan/projects/${PID}/models/m_rank.yaml`]!);
    expect(rank).toEqual({
      schema: "model/v1",
      id: "m_rank",
      name: "rank",
      key_field: "id",
      fields: [
        { name: "id", type: { kind: "string" } },
        { name: "name", type: { kind: "ltext" } },
        { name: "icon", type: { kind: "item" } },
        { name: "perks", type: { kind: "list", of: { kind: "ltext" } } },
      ],
    });
    // Cross-model refs stay refs — models/ is the editor's lossless store;
    // data/<id>.yaml stays denormalized for the runtime.
    const cat = parse(files[`plugins/Artisan/projects/${PID}/models/m_cat.yaml`]!);
    expect(cat.fields[1]).toEqual({ name: "featured", type: { kind: "model", ref: "m_rank" } });
  });

  it("includes source ltext keys in the lang files", () => {
    const files = transform(makeProject());
    const en = parse(files[`${BASE}/lang/en.yaml`]!);
    expect(en["sources.ranks.vip.name"]).toBe("VIP");
    expect(en["sources.settings.motd"]).toBe("Welcome");
    const fr = parse(files[`${BASE}/lang/fr.yaml`]!);
    expect(fr["sources.ranks.vip.name"]).toBe("V.I.P.");
  });
});

// ─── composable kinds: map / enum / union (ADR composable-data-models) ───────

describe("data/v1 — map / enum / union kinds", () => {
  const B = `plugins/Artisan/projects/${PID}`;

  function questsProject(): Project {
    return {
      id: PID,
      name: "p",
      source: "user_created",
      createdAt: "",
      updatedAt: "",
      menus: [],
      commands: [],
      templates: [],
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
                gold: { act: { type: "message", text: { key: "sources.quests.daily.tiers.gold.act.text" } } },
                silver: { act: { type: "command", run: "say hi" } },
              },
            },
          ],
        },
      ],
      i18nKeys: {
        "sources.quests.daily.tiers.gold.act.text": { en: "Well done!" },
      },
      defaultLang: "en",
      dialogs: [],
      canvasLayout: {},
    } as unknown as Project;
  }

  it("flattens map/enum/union into inline self-contained fields", () => {
    const files = transform(questsProject());
    const data = parse(files[`${B}/data/quests.yaml`]!);
    expect(data.fields).toEqual([
      { name: "id", kind: "string" },
      { name: "strategy", kind: "enum", values: ["sequential", "random"] },
      {
        name: "tiers",
        kind: "map",
        of: {
          kind: "object",
          fields: [
            {
              name: "act",
              kind: "union",
              tag: "type",
              variants: [
                { name: "message", fields: [{ name: "text", kind: "ltext" }] },
                { name: "command", fields: [{ name: "run", kind: "string" }] },
              ],
            },
          ],
        },
      },
    ]);
  });

  it("serializes values: enum as string, map entries by `of`, union by active variant (tag kept)", () => {
    const files = transform(questsProject());
    const data = parse(files[`${B}/data/quests.yaml`]!);
    expect(data.rows[0]).toEqual({
      id: "daily",
      strategy: "sequential",
      tiers: {
        gold: { act: { type: "message", text: "sources.quests.daily.tiers.gold.act.text" } },
        silver: { act: { type: "command", run: "say hi" } },
      },
    });
  });

  it("emits ltext keys nested in maps/unions into the lang files", () => {
    const files = transform(questsProject());
    const en = parse(files[`${B}/lang/en.yaml`]!);
    expect(en["sources.quests.daily.tiers.gold.act.text"]).toBe("Well done!");
  });
});

// ─── per-row file granularity (ADR composable-data-models §2) ────────────────

describe("data/v1 — per-row file granularity", () => {
  const B = `plugins/Artisan/projects/${PID}`;

  function perRowProject(): Project {
    return {
      id: PID,
      name: "p",
      source: "user_created",
      createdAt: "",
      updatedAt: "",
      menus: [],
      commands: [],
      templates: [],
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
      dialogs: [],
      canvasLayout: {},
    } as unknown as Project;
  }

  it("emits _source.yaml (meta + fields + order) and one row file per Row key", () => {
    const files = transform(perRowProject());
    expect(files[`${B}/data/cats2.yaml`]).toBeUndefined();
    const meta = parse(files[`${B}/data/cats2/_source.yaml`]!);
    expect(meta).toEqual({
      schema: "data/v1",
      id: "cats2",
      name: "categories",
      shape: "table",
      model: "m_cat2",
      key_field: "id",
      granularity: "row",
      order: ["weekly", "daily"],
      fields: [
        { name: "id", kind: "string" },
        { name: "label", kind: "ltext" },
      ],
    });
    expect(parse(files[`${B}/data/cats2/weekly.yaml`]!)).toEqual({
      id: "weekly",
      label: "sources.categories.weekly.label",
    });
    expect(parse(files[`${B}/data/cats2/daily.yaml`]!)).toEqual({
      id: "daily",
      label: "sources.categories.daily.label",
    });
  });
});
