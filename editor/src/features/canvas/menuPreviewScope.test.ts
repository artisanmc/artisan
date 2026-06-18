import type { ContextInput, DataSource, DataSourceId, Menu, Project, SourceRef } from "@/domain/types";
import { describe, expect, it } from "vitest";
import { buildPreviewScope, renderPreview, resolveSourceRef } from "./menuPreviewScope";

const stubProject = (overrides: Partial<Project> = {}): Project =>
  ({
    id: "p1" as Project["id"],
    name: "Test pack",
    source: "user_created",
    createdAt: "",
    updatedAt: "",
    menus: [],
    commands: [],
    templates: [],
    assets: [],
    dataSources: [],
    importedConnectors: [],
    i18nKeys: {},
    defaultLang: "en",
    canvasLayout: {},
    ...overrides,
  }) as Project;

const stubMenu = (inputs: ContextInput[] = []): Menu =>
  ({
    id: "m1" as Menu["id"],
    projectId: "p1" as Menu["projectId"],
    title: [] as Menu["title"],
    rows: 6,
    layers: [],
    contextInputs: inputs,
  }) as Menu;

describe("resolveSourceRef", () => {
  it("returns the dataSource value for a pack:<id> ref", () => {
    const ds: DataSource = {
      id: "categories" as DataSourceId,
      name: "Categories",
      type: { kind: "list", of: { kind: "string" } },
      value: ["weapon", "armor"],
    };
    const pack = stubProject({ dataSources: [ds] });
    expect(resolveSourceRef("pack:categories" as SourceRef, pack)).toEqual(["weapon", "armor"]);
  });

  it("returns the connector sample for a <plugin>:<source> ref", () => {
    const pack = stubProject({
      importedConnectors: [
        { ref: "chestshop:items", type: { kind: "list", of: { kind: "string" } }, sample: ["a"] },
      ],
    });
    expect(resolveSourceRef("chestshop:items" as SourceRef, pack)).toEqual(["a"]);
  });

  it("returns undefined for unknown pack ref", () => {
    expect(resolveSourceRef("pack:missing" as SourceRef, stubProject())).toBeUndefined();
  });

  it("returns undefined for unknown connector ref", () => {
    expect(resolveSourceRef("chestshop:bogus" as SourceRef, stubProject())).toBeUndefined();
  });

  it("returns undefined for empty / malformed ref", () => {
    expect(resolveSourceRef("" as SourceRef, stubProject())).toBeUndefined();
    expect(resolveSourceRef("no_colon" as SourceRef, stubProject())).toBeUndefined();
  });
});

describe("buildPreviewScope", () => {
  it("seeds the builtin sample player when no input named `player` exists", () => {
    const scope = buildPreviewScope(stubMenu(), stubProject());
    expect(Object.keys(scope)).toEqual(["player"]);
    const p = scope.player as Record<string, unknown>;
    expect(p.name).toBe("Steve");
    expect(p.uuid).toBe("8667ba71-b85a-4004-af54-457a9734eed7");
    expect(p.world).toBe("world");
    // Bare {player} must stringify to the name, not [object Object].
    expect(String(scope.player)).toBe("Steve");
  });

  it("does not seed `player` when an input with that name is declared (caller wins)", () => {
    const menu = stubMenu([{ kind: "sourceRef", name: "player", ref: "pack:missing" as SourceRef }]);
    const scope = buildPreviewScope(menu, stubProject());
    expect(scope.player).toBeUndefined();
  });

  it("coerces a player-typed primitive input to a sample player object", () => {
    const menu = stubMenu([{ kind: "primitive", name: "target", type: "player" }]);
    const scope = buildPreviewScope(menu, stubProject());
    const t = scope.target as Record<string, unknown>;
    expect(t.name).toBe("Steve");
    expect(t.uuid).toBe("8667ba71-b85a-4004-af54-457a9734eed7");
    expect(t.world).toBe("world");
    expect(String(scope.target)).toBe("Steve");
  });

  it("uses the declared default as the player name for player-typed inputs", () => {
    const menu = stubMenu([{ kind: "primitive", name: "player", type: "player", default: "Alex" }]);
    const scope = buildPreviewScope(menu, stubProject());
    expect((scope.player as Record<string, unknown>).name).toBe("Alex");
    expect(String(scope.player)).toBe("Alex");
  });

  it("includes primitive input default coerced to its type", () => {
    const menu = stubMenu([
      { kind: "primitive", name: "category", type: "string", default: "weapons" },
      { kind: "primitive", name: "page", type: "integer", default: "3" },
    ]);
    const scope = buildPreviewScope(menu, stubProject());
    expect(scope.category).toBe("weapons");
    expect(scope.page).toBe(3);
  });

  it("resolves a sourceRef input to the dataSource value", () => {
    const ds: DataSource = {
      id: "categories" as DataSourceId,
      name: "Categories",
      type: { kind: "list", of: { kind: "string" } },
      value: ["weapon", "armor"],
    };
    const pack = stubProject({ dataSources: [ds] });
    const menu = stubMenu([
      { kind: "sourceRef", name: "categories", ref: "pack:categories" as SourceRef },
    ]);
    expect(buildPreviewScope(menu, pack).categories).toEqual(["weapon", "armor"]);
  });

  it("falls back to undefined for unresolvable sourceRef inputs", () => {
    const menu = stubMenu([{ kind: "sourceRef", name: "x", ref: "pack:missing" as SourceRef }]);
    const scope = buildPreviewScope(menu, stubProject());
    expect("x" in scope).toBe(true);
    expect(scope.x).toBeUndefined();
  });
});

describe("renderPreview with the builtin player", () => {
  it("renders player subfields", () => {
    const pack = stubProject();
    const menu = stubMenu();
    const ctx = buildPreviewScope(menu, pack);
    expect(renderPreview("{player.name} in {player.world}", ctx, pack, "en")).toBe(
      "Steve in world",
    );
  });

  it("renders bare {player} as the name, not [object Object]", () => {
    const pack = stubProject();
    const ctx = buildPreviewScope(stubMenu(), pack);
    expect(renderPreview("{player}", ctx, pack, "en")).toBe("Steve");
  });

  it("renders subfields of a player-typed contextInput", () => {
    const pack = stubProject();
    const menu = stubMenu([{ kind: "primitive", name: "target", type: "player" }]);
    const ctx = buildPreviewScope(menu, pack);
    expect(renderPreview("{target.name}", ctx, pack, "en")).toBe("Steve");
    expect(renderPreview("{target}", ctx, pack, "en")).toBe("Steve");
  });
});
