import type { ContextInput, DataSource, DataSourceId, Menu, Pack, SourceRef } from "@/domain/types";
import { describe, expect, it } from "vitest";
import { buildPreviewScope, resolveSourceRef } from "./menuPreviewScope";

const stubPack = (overrides: Partial<Pack> = {}): Pack =>
  ({
    id: "p1" as Pack["id"],
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
  }) as Pack;

const stubMenu = (inputs: ContextInput[] = []): Menu =>
  ({
    id: "m1" as Menu["id"],
    packId: "p1" as Menu["packId"],
    title: { key: "k" } as Menu["title"],
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
    const pack = stubPack({ dataSources: [ds] });
    expect(resolveSourceRef("pack:categories" as SourceRef, pack)).toEqual(["weapon", "armor"]);
  });

  it("returns the connector sample for a <plugin>:<source> ref", () => {
    const pack = stubPack({
      importedConnectors: [
        { ref: "chestshop:items", type: { kind: "list", of: { kind: "string" } }, sample: ["a"] },
      ],
    });
    expect(resolveSourceRef("chestshop:items" as SourceRef, pack)).toEqual(["a"]);
  });

  it("returns undefined for unknown pack ref", () => {
    expect(resolveSourceRef("pack:missing" as SourceRef, stubPack())).toBeUndefined();
  });

  it("returns undefined for unknown connector ref", () => {
    expect(resolveSourceRef("chestshop:bogus" as SourceRef, stubPack())).toBeUndefined();
  });

  it("returns undefined for empty / malformed ref", () => {
    expect(resolveSourceRef("" as SourceRef, stubPack())).toBeUndefined();
    expect(resolveSourceRef("no_colon" as SourceRef, stubPack())).toBeUndefined();
  });
});

describe("buildPreviewScope", () => {
  it("builds an empty scope for a menu with no inputs", () => {
    expect(buildPreviewScope(stubMenu(), stubPack())).toEqual({});
  });

  it("includes primitive input default coerced to its type", () => {
    const menu = stubMenu([
      { kind: "primitive", name: "category", type: "string", default: "weapons" },
      { kind: "primitive", name: "page", type: "integer", default: "3" },
    ]);
    const scope = buildPreviewScope(menu, stubPack());
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
    const pack = stubPack({ dataSources: [ds] });
    const menu = stubMenu([
      { kind: "sourceRef", name: "categories", ref: "pack:categories" as SourceRef },
    ]);
    expect(buildPreviewScope(menu, pack)).toEqual({ categories: ["weapon", "armor"] });
  });

  it("falls back to undefined for unresolvable sourceRef inputs", () => {
    const menu = stubMenu([{ kind: "sourceRef", name: "x", ref: "pack:missing" as SourceRef }]);
    expect(buildPreviewScope(menu, stubPack())).toEqual({ x: undefined });
  });
});
