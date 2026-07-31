import { describe, expect, it } from "vitest";
import { applyModelMigrations, type ModelMigration } from "./modelMigrations";

/**
 * Declarative model migrations (ADR composable-data-models §5): a closed
 * vocabulary of data transforms shipped WITH the declaration — never code.
 * Applied editor-side to instances written under an older model version.
 */
describe("applyModelMigrations", () => {
  const migrations: ModelMigration[] = [
    {
      from: 1,
      to: 2,
      steps: [
        { op: "rename_field", from: "label", to: "name" },
        { op: "set_default", field: "price", value: 0 },
      ],
    },
    {
      from: 2,
      to: 3,
      steps: [
        { op: "rename_enum_value", field: "rarity", from: "legendary", to: "epic" },
        { op: "rename_variant", field: "act", tag: "type", from: "msg", to: "message" },
      ],
    },
  ];

  it("applies the chain from the instance's version to the latest", () => {
    const rows = [
      { id: "a", label: "Sword", rarity: "legendary", act: { type: "msg", text: "hi" } },
      { id: "b", label: "Bow", rarity: "common", act: { type: "command", run: "say" } },
    ];
    const res = applyModelMigrations(rows, 1, migrations);
    expect(res).toEqual({ applied: true, toVersion: 3 });
    expect(rows[0]).toEqual({
      id: "a", name: "Sword", price: 0, rarity: "epic", act: { type: "message", text: "hi" },
    });
    expect(rows[1]).toEqual({
      id: "b", name: "Bow", price: 0, rarity: "common", act: { type: "command", run: "say" },
    });
  });

  it("starts mid-chain and skips already-applied migrations", () => {
    const rows = [{ id: "a", name: "Sword", price: 5, rarity: "legendary" }];
    const res = applyModelMigrations(rows, 2, migrations);
    expect(res).toEqual({ applied: true, toVersion: 3 });
    expect(rows[0]!.rarity).toBe("epic");
    expect(rows[0]!.price).toBe(5); // set_default (v1→v2) not re-applied
  });

  it("no-ops when already at the latest version or when the chain has a gap", () => {
    const rows = [{ id: "a" }];
    expect(applyModelMigrations(rows, 3, migrations)).toEqual({ applied: false, toVersion: 3 });
    // Gap: data at v0, chain starts at 1 → nothing applies (dangle, non-hermetic).
    const gap = applyModelMigrations(rows, 0, [{ from: 2, to: 3, steps: [] }]);
    expect(gap).toEqual({ applied: false, toVersion: 0 });
  });

  it("set_default never overwrites an existing value", () => {
    const rows = [{ id: "a", price: 42 }];
    applyModelMigrations(rows, 1, [
      { from: 1, to: 2, steps: [{ op: "set_default", field: "price", value: 0 }] },
    ]);
    expect(rows[0]!.price).toBe(42);
  });

  it("path segments navigate nested objects and fan out over lists and map values", () => {
    const rows = [
      {
        id: "daily",
        quests: [
          { stages: [{ label: "one" }, { label: "two" }] },
          { stages: [{ label: "three" }] },
        ],
        tiers: { gold: { label: "big" }, silver: { label: "small" } },
      },
    ];
    applyModelMigrations(rows, 1, [
      {
        from: 1,
        to: 2,
        steps: [
          { op: "rename_field", path: ["quests", "stages"], from: "label", to: "title" },
          { op: "rename_field", path: ["tiers"], from: "label", to: "title" },
        ],
      },
    ]);
    expect(rows[0]!.quests[0]!.stages[0]).toEqual({ title: "one" });
    expect(rows[0]!.quests[1]!.stages[0]).toEqual({ title: "three" });
    expect((rows[0]!.tiers as Record<string, unknown>).gold).toEqual({ title: "big" });
  });

  it("unknown ops are skipped (forward-compat, dangle rather than crash)", () => {
    const rows = [{ id: "a" }];
    const res = applyModelMigrations(rows, 1, [
      { from: 1, to: 2, steps: [{ op: "teleport_field" } as never] },
    ]);
    expect(res).toEqual({ applied: true, toVersion: 2 });
    expect(rows[0]).toEqual({ id: "a" });
  });
});

// ─── injection at load (declared models + pending migrations) ────────────────
import { injectDeclaredModels } from "./dataModels";
import type { Project } from "./types";

describe("injectDeclaredModels", () => {
  function packWith(modelVersion: number | undefined): Project {
    return {
      id: "p",
      name: "p",
      source: "user_created",
      createdAt: "",
      updatedAt: "",
      menus: [], commands: [], assets: [], dialogs: [],
      i18nKeys: {}, defaultLang: "en", canvasLayout: {},
      dataModels: [
        { id: "mdl_local", name: "local", keyField: "id", fields: [] },
        // Stale copy of a declared model from a previous load — must be replaced.
        { id: "boutique:category", name: "old", keyField: "id", fields: [], provenance: "module" },
      ],
      dataSources: [
        {
          id: "cats", name: "cats", shape: "table", modelId: "boutique:category",
          ...(modelVersion !== undefined ? { modelVersion } : {}),
          rows: [{ id: "c1", label: "Armes" }],
        },
      ],
    } as unknown as Project;
  }

  const doc = {
    schema: "model/v1", id: "boutique:category", name: "Category", key_field: "id", version: 2,
    migrations: [{ from: 1, to: 2, steps: [{ op: "rename_field", from: "label", to: "name" }] }],
    fields: [
      { name: "id", type: { kind: "string" } },
      { name: "name", type: { kind: "ltext" } },
    ],
  };

  it("replaces stale declared copies, keeps local models, runs pending migrations", () => {
    const pack = packWith(1);
    const migrated = injectDeclaredModels(pack, [doc]);
    expect(migrated).toBe(true);
    const ids = (pack.dataModels ?? []).map((m) => m.id);
    expect(ids).toContain("mdl_local");
    const injected = (pack.dataModels ?? []).find((m) => m.id === "boutique:category")!;
    expect(injected.name).toBe("Category");
    expect(injected.provenance).toBe("module");
    expect(injected.version).toBe(2);
    const cats = pack.dataSources[0] as { rows: Record<string, unknown>[]; modelVersion?: number };
    expect(cats.rows[0]).toEqual({ id: "c1", name: "Armes" });
    expect(cats.modelVersion).toBe(2);
  });

  it("data without a recorded version is treated as v1", () => {
    const pack = packWith(undefined);
    injectDeclaredModels(pack, [doc]);
    const cats = pack.dataSources[0] as { rows: Record<string, unknown>[] };
    expect(cats.rows[0]).toEqual({ id: "c1", name: "Armes" });
  });

  it("up-to-date data is untouched", () => {
    const pack = packWith(2);
    const migrated = injectDeclaredModels(pack, [doc]);
    expect(migrated).toBe(false);
    const cats = pack.dataSources[0] as { rows: Record<string, unknown>[] };
    expect(cats.rows[0]).toEqual({ id: "c1", label: "Armes" });
  });

  it("a declaration that disappeared removes its stale injected copy", () => {
    const pack = packWith(2);
    injectDeclaredModels(pack, []);
    expect((pack.dataModels ?? []).map((m) => m.id)).toEqual(["mdl_local"]);
  });
});
