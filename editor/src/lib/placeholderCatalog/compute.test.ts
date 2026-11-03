import { mutableCommands, mutableMenus } from "@/domain/documents";
import type {
  CommandId,
  DataSourceId,
  DialogId,
  ElementId,
  Menu,
  MenuId,
  Project,
  SourceRef,
} from "@/domain/types";
import { describe, expect, it, vi } from "vitest";
import { compute } from "./compute";

const emptyProject = (): Project => ({
  id: "p1" as Project["id"],
  name: "p1",
  source: "user_created",
  createdAt: "2026-05-30",
  updatedAt: "2026-05-30",
  documents: {
    menu: [],
    command: [],
    dialog: [],
  },
  assets: [],
  dataSources: [],
  importedConnectors: [],
  i18nKeys: {},
  defaultLang: "en",
  canvasLayout: {},
});

const BUILTIN_PLAYER = [
  { path: "player", type: "player", sample: "Steve", origin: "context" },
  { path: "player.first_seen.ago()", type: "string", sample: "40d", origin: "context" },
  { path: "player.last_seen.ago()", type: "string", sample: "3d 4h", origin: "context" },
  { path: "player.location", type: "string", sample: "world 12 64 -30", origin: "context" },
  { path: "player.name", type: "string", sample: "Steve", origin: "context" },
  { path: "player.playtime.duration()", type: "string", sample: "12h 30m", origin: "context" },
  {
    path: "player.uuid",
    type: "string",
    sample: "8667ba71-b85a-4004-af54-457a9734eed7",
    origin: "context",
  },
  { path: "player.vanished", type: "boolean", sample: "false", origin: "context" },
  { path: "player.world", type: "string", sample: "world", origin: "context" },
];

/** The navigation-history builtins every menu/element/action/dialog scope adds. */
const BUILTIN_NAV = [
  { path: "has_previous_menu", type: "boolean", sample: "true", origin: "context" },
  { path: "previous_menu", type: "object", sample: null, origin: "context" },
  { path: "previous_menu.id", type: "string", sample: null, origin: "context" },
  { path: "previous_menu.title", type: "string", sample: null, origin: "context" },
];

/** Player builtins + navigation builtins, in the catalog's sorted order. */
const BUILTIN_MENU = [BUILTIN_NAV[0], ...BUILTIN_PLAYER, ...BUILTIN_NAV.slice(1)];

describe("PlaceholderCatalog.compute", () => {
  it("returns [] for a menu location when the menu id is unknown", () => {
    const project = emptyProject();
    const result = compute(project, { kind: "menu", menuId: "missing" as MenuId });
    expect(result).toEqual([]);
  });

  it("includes the builtin {player} entries for a menu with no contextInputs", () => {
    const project = emptyProject();
    mutableMenus(project).push({
      id: "m1" as MenuId,
      projectId: project.id,
      title: [],
      rows: 3,
      layers: [],
      contextInputs: [],
    });
    const result = compute(project, { kind: "menu", menuId: "m1" as MenuId });
    expect(result).toEqual(BUILTIN_MENU);
  });

  it("emits a primitive contextInput as a single entry with coerced sample", () => {
    const project = emptyProject();
    mutableMenus(project).push({
      id: "m1" as MenuId,
      projectId: project.id,
      title: [],
      rows: 3,
      layers: [],
      contextInputs: [
        { kind: "primitive", name: "player", type: "player", default: "Steve" },
        { kind: "primitive", name: "rank", type: "integer", default: "5" },
        { kind: "primitive", name: "active", type: "boolean", default: "true" },
      ],
    });
    const out = compute(project, { kind: "menu", menuId: "m1" as MenuId });
    // Sorted alpha by path within context origin.
    // The declared `player` input shadows the builtins (caller arg wins), so
    // there is exactly one `player` entry; its player-typed subfields still show.
    expect(out).toEqual([
      { path: "active", type: "boolean", sample: "true", origin: "context" },
      BUILTIN_NAV[0],
      { path: "player", type: "player", sample: "Steve", origin: "context" },
      { path: "player.location", type: "string", sample: "world 12 64 -30", origin: "context" },
      { path: "player.name", type: "string", sample: "Steve", origin: "context" },
      {
        path: "player.uuid",
        type: "string",
        sample: "8667ba71-b85a-4004-af54-457a9734eed7",
        origin: "context",
      },
      { path: "player.vanished", type: "boolean", sample: "false", origin: "context" },
      { path: "player.world", type: "string", sample: "world", origin: "context" },
      ...BUILTIN_NAV.slice(1),
      { path: "rank", type: "integer", sample: "5", origin: "context" },
    ]);
    expect(out.filter((e) => e.path === "player")).toHaveLength(1);
  });

  it("emits dotted subfields for a player-typed contextInput (e.g. command arg `target`)", () => {
    const project = emptyProject();
    mutableMenus(project).push({
      id: "m1" as MenuId,
      projectId: project.id,
      title: [],
      rows: 3,
      layers: [],
      contextInputs: [{ kind: "primitive", name: "target", type: "player", default: "Alex" }],
    });
    const out = compute(project, { kind: "menu", menuId: "m1" as MenuId });
    // No input named `player` → builtins stay, then target + its subfields.
    expect(out).toEqual([
      ...BUILTIN_MENU,
      { path: "target", type: "player", sample: "Alex", origin: "context" },
      { path: "target.location", type: "string", sample: "world 12 64 -30", origin: "context" },
      { path: "target.name", type: "string", sample: "Alex", origin: "context" },
      {
        path: "target.uuid",
        type: "string",
        sample: "8667ba71-b85a-4004-af54-457a9734eed7",
        origin: "context",
      },
      { path: "target.vanished", type: "boolean", sample: "false", origin: "context" },
      { path: "target.world", type: "string", sample: "world", origin: "context" },
    ]);
  });

  it("emits the same primitive entries when locating an element inside the menu", () => {
    const project = emptyProject();
    mutableMenus(project).push({
      id: "m1" as MenuId,
      projectId: project.id,
      title: [],
      rows: 3,
      layers: [
        {
          id: "l1" as Menu["layers"][number]["id"],
          name: "default",
          elements: [{ id: "e1" as ElementId, positions: "0", display: {}, states: [] }],
        },
      ],
      contextInputs: [{ kind: "primitive", name: "player", type: "player", default: "Steve" }],
    });
    const out = compute(project, {
      kind: "element",
      menuId: "m1" as MenuId,
      elementId: "e1" as ElementId,
    });
    expect(out.map((e) => e.path)).toContain("player");
  });

  it("flattens an object-typed dataSource into one entry per leaf", () => {
    const project = emptyProject();
    project.dataSources.push({
      id: "ds1" as DataSourceId,
      name: "currentQuest",
      shape: "config",
      fields: [
        { name: "name", type: { kind: "string" } },
        { name: "reward", type: { kind: "integer" } },
      ],
      value: { name: "Tuer 10 zombies", reward: 500 },
    });
    mutableMenus(project).push({
      id: "m1" as MenuId,
      projectId: project.id,
      title: [],
      rows: 3,
      layers: [],
      contextInputs: [{ kind: "sourceRef", name: "quest", ref: "pack:ds1" as SourceRef }],
    });
    const out = compute(project, { kind: "menu", menuId: "m1" as MenuId });
    expect(out).toEqual([
      ...BUILTIN_MENU,
      { path: "quest.name", type: "string", sample: "Tuer 10 zombies", origin: "context" },
      { path: "quest.reward", type: "integer", sample: "500", origin: "context" },
    ]);
  });

  it("row-model input (type object + rowOf) exposes the source's declared fields", () => {
    const project = emptyProject();
    mutableMenus(project).push({
      id: "shop_category" as MenuId,
      projectId: project.id,
      title: [],
      rows: 6,
      layers: [],
      contextInputs: [
        {
          kind: "primitive",
          name: "cat",
          type: "object",
          rowOf: "boutique:categories" as SourceRef,
        },
      ],
    });
    const entries = compute(
      project,
      { kind: "menu", menuId: "shop_category" as MenuId },
      {
        "boutique:categories": [
          { name: "id", type: "string" },
          { name: "name", type: "string" },
          { name: "discount", type: "number" },
        ],
      },
    );
    const paths = entries.map((e) => `${e.path}:${e.type}`);
    expect(paths).toContain("cat:object");
    expect(paths).toContain("cat.id:string");
    expect(paths).toContain("cat.name:string");
    expect(paths).toContain("cat.discount:number");
  });

  it("omits list-typed contextInputs at menu scope (only builtins remain)", () => {
    const project = emptyProject();
    project.dataModels = [
      {
        id: "m2" as never,
        name: "quest",
        keyField: "name",
        fields: [{ name: "name", type: { kind: "string" } }],
      },
    ];
    project.dataSources.push({
      id: "ds2" as DataSourceId,
      name: "questList",
      shape: "table",
      modelId: "m2" as never,
      rows: [],
    });
    mutableMenus(project).push({
      id: "m1" as MenuId,
      projectId: project.id,
      title: [],
      rows: 3,
      layers: [],
      contextInputs: [{ kind: "sourceRef", name: "quests", ref: "pack:ds2" as SourceRef }],
    });
    const out = compute(project, { kind: "menu", menuId: "m1" as MenuId });
    expect(out).toEqual(BUILTIN_MENU);
  });

  it("emits iteration alias leaves when the element iterates over a list of objects", () => {
    const project = emptyProject();
    project.dataModels = [
      {
        id: "m3" as never,
        name: "quest",
        keyField: "name",
        fields: [
          { name: "name", type: { kind: "string" } },
          { name: "reward", type: { kind: "integer" } },
        ],
      },
    ];
    project.dataSources.push({
      id: "ds3" as DataSourceId,
      name: "quests",
      shape: "table",
      modelId: "m3" as never,
      rows: [{ name: "Q1", reward: 100 }],
    });
    mutableMenus(project).push({
      id: "m1" as MenuId,
      projectId: project.id,
      title: [],
      rows: 3,
      layers: [
        {
          id: "l1" as Menu["layers"][number]["id"],
          name: "default",
          elements: [
            {
              id: "e1" as ElementId,
              positions: "0,1,2",
              display: {},
              states: [],
              iterates: { source: "quests", alias: "quest" },
            },
          ],
        },
      ],
      contextInputs: [{ kind: "sourceRef", name: "quests", ref: "pack:ds3" as SourceRef }],
    });
    const out = compute(project, {
      kind: "element",
      menuId: "m1" as MenuId,
      elementId: "e1" as ElementId,
    });
    expect(out).toEqual([
      ...BUILTIN_MENU,
      { path: "quest.name", type: "string", sample: "Q1", origin: "iteration" },
      { path: "quest.reward", type: "integer", sample: "100", origin: "iteration" },
    ]);
  });

  it("exposes a placed element's alias from a server source's reported schema", () => {
    const project = emptyProject();
    mutableMenus(project).push({
      id: "m1" as MenuId,
      projectId: project.id,
      title: [],
      rows: 6,
      layers: [
        {
          id: "l1" as Menu["layers"][number]["id"],
          name: "default",
          elements: [
            {
              id: "e1" as ElementId,
              positions: "",
              display: {},
              states: [],
              places: { source: "items", alias: "item", keyField: "id", placements: [] },
            },
          ],
        },
      ],
      contextInputs: [{ kind: "sourceRef", name: "items", ref: "boutique:items" as SourceRef }],
    });
    const out = compute(
      project,
      { kind: "action", menuId: "m1" as MenuId, elementId: "e1" as ElementId, clickType: "left" },
      {
        "boutique:items": [
          { name: "id", type: "string" },
          { name: "final_price", type: "integer" },
        ],
      },
    );
    expect(out.filter((e) => e.origin === "iteration")).toEqual([
      { path: "item.final_price", type: "integer", sample: null, origin: "iteration" },
      { path: "item.id", type: "string", sample: null, origin: "iteration" },
    ]);
  });

  it("resolves an iteration whose source names a server ref directly", () => {
    const project = emptyProject();
    mutableMenus(project).push({
      id: "m1" as MenuId,
      projectId: project.id,
      title: [],
      rows: 6,
      layers: [
        {
          id: "l1" as Menu["layers"][number]["id"],
          name: "default",
          elements: [
            {
              id: "e1" as ElementId,
              positions: "0-8",
              display: {},
              states: [],
              iterates: { source: "boutique:categories", alias: "cat" },
            },
          ],
        },
      ],
      contextInputs: [],
    });
    const out = compute(
      project,
      { kind: "element", menuId: "m1" as MenuId, elementId: "e1" as ElementId },
      { "boutique:categories": [{ name: "name", type: "string" }] },
    );
    expect(out.filter((e) => e.origin === "iteration").map((e) => e.path)).toEqual(["cat.name"]);
  });

  it("command scope exposes its arguments next to the builtin {player}", () => {
    const project = emptyProject();
    mutableCommands(project).push({
      id: "c1" as CommandId,
      projectId: project.id,
      name: "shop",
      arguments: [
        { name: "target", type: "player", required: true },
        { name: "amount", type: "integer", required: false },
      ],
      steps: [],
    });
    const out = compute(project, { kind: "command", commandId: "c1" as CommandId });
    expect(out.map((e) => [e.path, e.type])).toEqual([
      ["amount", "integer"],
      ["player", "player"],
      ["player.first_seen.ago()", "string"],
      ["player.last_seen.ago()", "string"],
      ["player.location", "string"],
      ["player.name", "string"],
      ["player.playtime.duration()", "string"],
      ["player.uuid", "string"],
      ["player.vanished", "boolean"],
      ["player.world", "string"],
      ["target", "player"],
      ["target.location", "string"],
      ["target.name", "string"],
      ["target.uuid", "string"],
      ["target.vanished", "boolean"],
      ["target.world", "string"],
    ]);
  });

  it("does not emit iteration entries when the element does not iterate", () => {
    const project = emptyProject();
    mutableMenus(project).push({
      id: "m1" as MenuId,
      projectId: project.id,
      title: [],
      rows: 3,
      layers: [
        {
          id: "l1" as Menu["layers"][number]["id"],
          name: "default",
          elements: [{ id: "e1" as ElementId, positions: "0", display: {}, states: [] }],
        },
      ],
      contextInputs: [],
    });
    const out = compute(project, {
      kind: "element",
      menuId: "m1" as MenuId,
      elementId: "e1" as ElementId,
    });
    expect(out.filter((e) => e.origin === "iteration")).toEqual([]);
  });

  it("action location returns the same scope as the parent element", () => {
    const project = emptyProject();
    // Provide a real dataSource so the iteration entries are non-empty and the
    // assertion verifies genuine delegation rather than two empty arrays.
    project.dataModels = [
      {
        id: "m_list" as never,
        name: "row",
        keyField: "label",
        fields: [{ name: "label", type: { kind: "string" } }],
      },
    ];
    project.dataSources.push({
      id: "ds_list" as DataSourceId,
      name: "list",
      shape: "table",
      modelId: "m_list" as never,
      rows: [{ label: "hello" }],
    });
    mutableMenus(project).push({
      id: "m1" as MenuId,
      projectId: project.id,
      title: [],
      rows: 3,
      layers: [
        {
          id: "l1" as Menu["layers"][number]["id"],
          name: "default",
          elements: [
            {
              id: "e1" as ElementId,
              positions: "0",
              display: {},
              states: [],
              iterates: { source: "list", alias: "item" },
            },
          ],
        },
      ],
      contextInputs: [{ kind: "sourceRef", name: "list", ref: "pack:ds_list" as SourceRef }],
    });
    const elementOut = compute(project, {
      kind: "element",
      menuId: "m1" as MenuId,
      elementId: "e1" as ElementId,
    });
    const actionOut = compute(project, {
      kind: "action",
      menuId: "m1" as MenuId,
      elementId: "e1" as ElementId,
      clickType: "left",
    });
    // Both must include the iteration leaf (non-empty), confirming delegation.
    expect(elementOut.some((e) => e.path === "item.label" && e.origin === "iteration")).toBe(true);
    expect(actionOut.map((e) => e.path)).toEqual(elementOut.map((e) => e.path));
  });

  it("returns the builtin {player} entries for dialog scope (no contextInputs modeled)", () => {
    const project = emptyProject();
    const out = compute(project, { kind: "dialog", dialogId: "d1" as DialogId });
    expect(out).toEqual(BUILTIN_MENU);
  });

  it("returns the builtin {player} entries for dialog-action scope", () => {
    const project = emptyProject();
    const out = compute(project, {
      kind: "dialog-action",
      dialogId: "d1" as DialogId,
      buttonId: "btn_confirm",
    });
    expect(out).toEqual(BUILTIN_MENU);
  });

  it("omits sourceRef inputs whose dataSource was deleted, and warns once per render", () => {
    const project = emptyProject();
    mutableMenus(project).push({
      id: "m1" as MenuId,
      projectId: project.id,
      title: [],
      rows: 3,
      layers: [],
      contextInputs: [{ kind: "sourceRef", name: "ghost", ref: "pack:deleted" as SourceRef }],
    });
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const out = compute(project, { kind: "menu", menuId: "m1" as MenuId });
    expect(out).toEqual(BUILTIN_MENU);
    expect(warn).toHaveBeenCalledTimes(1);
    expect(warn.mock.calls[0]![0]).toMatch(/deleted/);
    warn.mockRestore();
  });

  it("sorts entries by origin (context → iteration → source) then alpha by path", () => {
    const project = emptyProject();
    project.dataModels = [
      {
        id: "m4" as never,
        name: "quest",
        keyField: "name",
        fields: [{ name: "name", type: { kind: "string" } }],
      },
    ];
    project.dataSources.push({
      id: "ds4" as DataSourceId,
      name: "quests",
      shape: "table",
      modelId: "m4" as never,
      rows: [{ name: "Q1" }],
    });
    mutableMenus(project).push({
      id: "m1" as MenuId,
      projectId: project.id,
      title: [],
      rows: 3,
      layers: [
        {
          id: "l1" as Menu["layers"][number]["id"],
          name: "default",
          elements: [
            {
              id: "e1" as ElementId,
              positions: "0",
              display: {},
              states: [],
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
    const out = compute(project, {
      kind: "element",
      menuId: "m1" as MenuId,
      elementId: "e1" as ElementId,
    });
    expect(out.map((e) => `${e.origin}:${e.path}`)).toEqual([
      "context:alpha",
      "context:has_previous_menu",
      "context:player",
      "context:player.first_seen.ago()",
      "context:player.last_seen.ago()",
      "context:player.location",
      "context:player.name",
      "context:player.playtime.duration()",
      "context:player.uuid",
      "context:player.vanished",
      "context:player.world",
      "context:previous_menu",
      "context:previous_menu.id",
      "context:previous_menu.title",
      "context:zoo",
      "iteration:quest.name",
    ]);
  });
});
