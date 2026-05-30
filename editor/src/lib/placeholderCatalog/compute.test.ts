import { describe, expect, it, vi } from "vitest";
import type { DataSourceId, DialogId, ElementId, MenuId, Pack, SourceRef } from "@/domain/types";
import { compute } from "./compute";

const emptyPack = (): Pack => ({
  id: "p1" as Pack["id"],
  name: "p1",
  source: "user_created",
  createdAt: "2026-05-30",
  updatedAt: "2026-05-30",
  menus: [],
  commands: [],
  templates: [],
  assets: [],
  dataSources: [],
  importedConnectors: [],
  i18nKeys: {},
  defaultLang: "en",
  dialogs: [],
  canvasLayout: {},
});

describe("PlaceholderCatalog.compute", () => {
  it("returns [] for a menu location when the menu id is unknown", () => {
    const pack = emptyPack();
    const result = compute(pack, { kind: "menu", menuId: "missing" as MenuId });
    expect(result).toEqual([]);
  });

  it("returns [] for a menu with no contextInputs", () => {
    const pack = emptyPack();
    pack.menus.push({
      id: "m1" as MenuId,
      packId: pack.id,
      title: [],
      rows: 3,
      layers: [],
      contextInputs: [],
    });
    const result = compute(pack, { kind: "menu", menuId: "m1" as MenuId });
    expect(result).toEqual([]);
  });

  // Task 3 tests
  it("emits a primitive contextInput as a single entry with coerced sample", () => {
    const pack = emptyPack();
    pack.menus.push({
      id: "m1" as MenuId,
      packId: pack.id,
      title: [],
      rows: 3,
      layers: [],
      contextInputs: [
        { kind: "primitive", name: "player", type: "player", default: "Steve" },
        { kind: "primitive", name: "rank", type: "integer", default: "5" },
        { kind: "primitive", name: "active", type: "boolean", default: "true" },
      ],
    });
    const out = compute(pack, { kind: "menu", menuId: "m1" as MenuId });
    // Sorted alpha by path within context origin (Task 8 sort applied throughout).
    expect(out).toEqual([
      { path: "active", type: "boolean", sample: "true", origin: "context" },
      { path: "player", type: "player", sample: "Steve", origin: "context" },
      { path: "rank", type: "integer", sample: "5", origin: "context" },
    ]);
  });

  it("emits the same primitive entries when locating an element inside the menu", () => {
    const pack = emptyPack();
    pack.menus.push({
      id: "m1" as MenuId,
      packId: pack.id,
      title: [],
      rows: 3,
      layers: [
        {
          id: "l1" as Pack["menus"][number]["layers"][number]["id"],
          name: "default",
          elements: [
            { id: "e1" as ElementId, positions: "0", appearances: [] },
          ],
        },
      ],
      contextInputs: [
        { kind: "primitive", name: "player", type: "player", default: "Steve" },
      ],
    });
    const out = compute(pack, {
      kind: "element",
      menuId: "m1" as MenuId,
      elementId: "e1" as ElementId,
    });
    expect(out.map((e) => e.path)).toContain("player");
  });

  // Task 4 tests
  it("flattens an object-typed dataSource into one entry per leaf", () => {
    const pack = emptyPack();
    pack.dataSources.push({
      id: "ds1" as DataSourceId,
      name: "currentQuest",
      type: {
        kind: "object",
        fields: [
          { name: "name", type: { kind: "string" } },
          { name: "reward", type: { kind: "integer" } },
        ],
      },
      value: { name: "Tuer 10 zombies", reward: 500 },
    });
    pack.menus.push({
      id: "m1" as MenuId,
      packId: pack.id,
      title: [],
      rows: 3,
      layers: [],
      contextInputs: [
        { kind: "sourceRef", name: "quest", ref: "pack:ds1" as SourceRef },
      ],
    });
    const out = compute(pack, { kind: "menu", menuId: "m1" as MenuId });
    expect(out).toEqual([
      { path: "quest.name", type: "string", sample: "Tuer 10 zombies", origin: "context" },
      { path: "quest.reward", type: "integer", sample: "500", origin: "context" },
    ]);
  });

  it("omits list-typed contextInputs at menu scope (no useful single-value placement)", () => {
    const pack = emptyPack();
    pack.dataSources.push({
      id: "ds2" as DataSourceId,
      name: "questList",
      type: { kind: "list", of: { kind: "object", fields: [{ name: "name", type: { kind: "string" } }] } },
      value: [],
    });
    pack.menus.push({
      id: "m1" as MenuId,
      packId: pack.id,
      title: [],
      rows: 3,
      layers: [],
      contextInputs: [
        { kind: "sourceRef", name: "quests", ref: "pack:ds2" as SourceRef },
      ],
    });
    const out = compute(pack, { kind: "menu", menuId: "m1" as MenuId });
    expect(out).toEqual([]);
  });

  // Task 5 tests
  it("emits iteration alias leaves + pagination when the element iterates over a list of objects", () => {
    const pack = emptyPack();
    pack.dataSources.push({
      id: "ds3" as DataSourceId,
      name: "quests",
      type: {
        kind: "list",
        of: {
          kind: "object",
          fields: [
            { name: "name", type: { kind: "string" } },
            { name: "reward", type: { kind: "integer" } },
          ],
        },
      },
      value: [{ name: "Q1", reward: 100 }],
    });
    pack.menus.push({
      id: "m1" as MenuId,
      packId: pack.id,
      title: [],
      rows: 3,
      layers: [
        {
          id: "l1" as Pack["menus"][number]["layers"][number]["id"],
          name: "default",
          elements: [
            {
              id: "e1" as ElementId,
              positions: "0,1,2",
              appearances: [],
              iterates: { source: "quests", alias: "quest" },
            },
          ],
        },
      ],
      contextInputs: [
        { kind: "sourceRef", name: "quests", ref: "pack:ds3" as SourceRef },
      ],
    });
    const out = compute(pack, {
      kind: "element",
      menuId: "m1" as MenuId,
      elementId: "e1" as ElementId,
    });
    expect(out).toEqual([
      { path: "quest.name", type: "string", sample: "Q1", origin: "iteration" },
      { path: "quest.reward", type: "integer", sample: "100", origin: "iteration" },
      { path: "pagination.page", type: "integer", sample: "1", origin: "pagination" },
      { path: "pagination.totalPages", type: "integer", sample: "1", origin: "pagination" },
    ]);
  });

  it("does not emit iteration / pagination entries when the element does not iterate", () => {
    const pack = emptyPack();
    pack.menus.push({
      id: "m1" as MenuId,
      packId: pack.id,
      title: [],
      rows: 3,
      layers: [
        {
          id: "l1" as Pack["menus"][number]["layers"][number]["id"],
          name: "default",
          elements: [
            { id: "e1" as ElementId, positions: "0", appearances: [] },
          ],
        },
      ],
      contextInputs: [],
    });
    const out = compute(pack, {
      kind: "element",
      menuId: "m1" as MenuId,
      elementId: "e1" as ElementId,
    });
    expect(out.filter((e) => e.origin === "iteration" || e.origin === "pagination")).toEqual([]);
  });

  it("action location returns the same scope as the parent element", () => {
    const pack = emptyPack();
    pack.menus.push({
      id: "m1" as MenuId,
      packId: pack.id,
      title: [],
      rows: 3,
      layers: [
        {
          id: "l1" as Pack["menus"][number]["layers"][number]["id"],
          name: "default",
          elements: [
            { id: "e1" as ElementId, positions: "0", appearances: [], iterates: { source: "list", alias: "item" } },
          ],
        },
      ],
      contextInputs: [],
    });
    const elementOut = compute(pack, {
      kind: "element",
      menuId: "m1" as MenuId,
      elementId: "e1" as ElementId,
    });
    const actionOut = compute(pack, {
      kind: "action",
      menuId: "m1" as MenuId,
      elementId: "e1" as ElementId,
      clickType: "left",
    });
    expect(actionOut.map((e) => e.path)).toEqual(elementOut.map((e) => e.path));
  });

  // Task 6 tests
  it("returns [] for dialog scope in v1 (dialog contextInputs not yet modeled)", () => {
    const pack = emptyPack();
    const out = compute(pack, { kind: "dialog", dialogId: "d1" as DialogId });
    expect(out).toEqual([]);
  });

  it("returns [] for dialog-action scope in v1", () => {
    const pack = emptyPack();
    const out = compute(pack, {
      kind: "dialog-action",
      dialogId: "d1" as DialogId,
      buttonId: "btn_confirm",
    });
    expect(out).toEqual([]);
  });

  // Task 7 test
  it("omits sourceRef inputs whose dataSource was deleted, and warns once per render", () => {
    const pack = emptyPack();
    pack.menus.push({
      id: "m1" as MenuId,
      packId: pack.id,
      title: [],
      rows: 3,
      layers: [],
      contextInputs: [
        { kind: "sourceRef", name: "ghost", ref: "pack:deleted" as SourceRef },
      ],
    });
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const out = compute(pack, { kind: "menu", menuId: "m1" as MenuId });
    expect(out).toEqual([]);
    expect(warn).toHaveBeenCalledTimes(1);
    expect(warn.mock.calls[0]![0]).toMatch(/deleted/);
    warn.mockRestore();
  });

  // Task 8 test
  it("sorts entries by origin (context → iteration → pagination → source) then alpha by path", () => {
    const pack = emptyPack();
    pack.dataSources.push({
      id: "ds4" as DataSourceId,
      name: "quests",
      type: { kind: "list", of: { kind: "object", fields: [{ name: "name", type: { kind: "string" } }] } },
      value: [{ name: "Q1" }],
    });
    pack.menus.push({
      id: "m1" as MenuId,
      packId: pack.id,
      title: [],
      rows: 3,
      layers: [
        {
          id: "l1" as Pack["menus"][number]["layers"][number]["id"],
          name: "default",
          elements: [
            {
              id: "e1" as ElementId,
              positions: "0",
              appearances: [],
              iterates: { source: "quests", alias: "quest" },
            },
          ],
        },
      ],
      contextInputs: [
        { kind: "primitive", name: "zoo", type: "string" },
        { kind: "primitive", name: "alpha", type: "string" },
        { kind: "sourceRef", name: "quests", ref: "pack:ds4" as SourceRef },
      ],
    });
    const out = compute(pack, {
      kind: "element",
      menuId: "m1" as MenuId,
      elementId: "e1" as ElementId,
    });
    expect(out.map((e) => `${e.origin}:${e.path}`)).toEqual([
      "context:alpha",
      "context:zoo",
      "iteration:quest.name",
      "pagination:pagination.page",
      "pagination:pagination.totalPages",
    ]);
  });
});
