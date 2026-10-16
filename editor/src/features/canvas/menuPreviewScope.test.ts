import type {
  ContextInput,
  DataSource,
  DataSourceId,
  Menu,
  Project,
  SourceRef,
} from "@/domain/types";
import { useUiStore } from "@/state/uiStore";
import { registerModule } from "@artisan/editor-sdk";
import { afterEach, describe, expect, it } from "vitest";
import boutiqueModule from "../../../packages/boutique-editor/src";
import { clearRegistry } from "../../../packages/editor-sdk/src/contract/registry";
import { buildPreviewScope, renderPreview, resolveSourceRef } from "./menuPreviewScope";

const stubProject = (overrides: Partial<Project> = {}): Project =>
  ({
    id: "p1" as Project["id"],
    name: "Test project",
    source: "user_created",
    createdAt: "",
    updatedAt: "",
    documents: {
      menu: [],
      command: [],
    },
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

describe("resolveSourceRef — module-local rows (authoring-time)", () => {
  it("renders localized boutique lore and configured price in the active language", () => {
    registerModule(boutiqueModule);
    useUiStore.setState({ activeLang: "fr" });
    const project = stubProject({
      i18nKeys: {
        line1: { en: "Rare", fr: "Rare FR" },
        line2: { en: "Sharp", fr: "Tranchante" },
      } as Project["i18nKeys"],
      dataSources: [
        {
          id: "categories",
          shape: "table",
          rows: [
            {
              id: "weapons",
              items: [{ id: "sword", price: 100, lore: [{ key: "line1" }, { key: "line2" }] }],
            },
          ],
        },
        {
          id: "shop_settings",
          shape: "config",
          value: { placeholders: { price_display: "%price% jetons" } },
        },
      ] as unknown as Project["dataSources"],
    });
    const rows = resolveSourceRef("boutique:items" as SourceRef, project) as Record<
      string,
      unknown
    >[];
    expect(
      renderPreview("{item.lore}\n{item.price_display}", { item: rows[0] }, project, "fr"),
    ).toBe("Rare FR\nTranchante\n100 jetons");
  });
  afterEach(() => clearRegistry());

  const registerLocalRowsModule = (rows: Record<string, unknown>[] | null) =>
    registerModule({
      id: "boutique",
      displayName: "Boutique",
      schemaVersion: "boutique/v1",
      sidebar: { icon: () => null, label: "Boutique", to: "/m/boutique" },
      routes: [],
      localPreviewRows: (_project, ref) => (ref === "boutique:items" ? rows : null),
    });

  it("module-local rows win over the server snapshot (live editing feedback)", () => {
    registerLocalRowsModule([{ id: "sword", name: "Local edit" }]);
    const project = stubProject();
    const snapshots = { "boutique:items": [{ id: "sword", name: "Stale server row" }] };
    expect(resolveSourceRef("boutique:items" as SourceRef, project, snapshots)).toEqual([
      { id: "sword", name: "Local edit" },
    ]);
  });

  it("falls back to the snapshot when the module returns null (no local data)", () => {
    registerLocalRowsModule(null);
    const project = stubProject();
    const snapshots = { "boutique:items": [{ id: "sword", name: "Server row" }] };
    expect(resolveSourceRef("boutique:items" as SourceRef, project, snapshots)).toEqual([
      { id: "sword", name: "Server row" },
    ]);
  });

  it("probes sibling projects: module data in ANOTHER project still resolves (plugin merges across projects)", async () => {
    const { useProjectsStore } = await import("@/state/projectsStore");
    registerModule({
      id: "boutique",
      displayName: "Boutique",
      schemaVersion: "boutique/v1",
      sidebar: { icon: () => null, label: "Boutique", to: "/m/boutique" },
      routes: [],
      localPreviewRows: (project, ref) => {
        if (ref !== "boutique:items") return null;
        const md = (project as { moduleData?: Record<string, unknown> }).moduleData?.boutique;
        return md ? [{ id: "from_sibling" }] : null;
      },
    });
    const current = stubProject(); // no boutique data (the menus project)
    const sibling = stubProject({
      id: "p_shop" as Project["id"],
      moduleData: { boutique: { wholeShopDiscount: 0, categories: [] } },
    } as Partial<Project>);
    useProjectsStore.setState({
      openProjects: { projects: [current, sibling], projectOrder: [] },
    } as never);

    const snapshots = { "boutique:items": [{ id: "stale_server" }] };
    expect(resolveSourceRef("boutique:items" as SourceRef, current, snapshots)).toEqual([
      { id: "from_sibling" },
    ]);
  });
});

describe("resolveSourceRef", () => {
  it("returns the dataSource value for a pack:<id> ref", () => {
    const ds: DataSource = {
      id: "categories" as DataSourceId,
      name: "Categories",
      shape: "table",
      modelId: "m_cat" as never,
      rows: [{ id: "weapon" }, { id: "armor" }],
    };
    const project = stubProject({ dataSources: [ds] });
    expect(resolveSourceRef("pack:categories" as SourceRef, project)).toEqual([
      { id: "weapon" },
      { id: "armor" },
    ]);
  });

  it("returns undefined for unknown project ref", () => {
    expect(resolveSourceRef("pack:missing" as SourceRef, stubProject())).toBeUndefined();
  });

  it("returns undefined for an unknown server ref (no snapshot, no local rows)", () => {
    expect(resolveSourceRef("chestshop:bogus" as SourceRef, stubProject())).toBeUndefined();
  });

  it("returns undefined for empty / malformed ref", () => {
    expect(resolveSourceRef("" as SourceRef, stubProject())).toBeUndefined();
    expect(resolveSourceRef("no_colon" as SourceRef, stubProject())).toBeUndefined();
  });

  it("resolves a server ref from the live snapshot", () => {
    const snapshots = { "boutique:items": [{ id: "real", name: "Real" }] };
    expect(resolveSourceRef("boutique:items" as SourceRef, stubProject(), snapshots)).toEqual([
      { id: "real", name: "Real" },
    ]);
  });

  it("never uses snapshots for a pack:<id> ref (project data wins)", () => {
    const ds: DataSource = {
      id: "categories" as DataSourceId,
      name: "Categories",
      shape: "table",
      modelId: "m_cat" as never,
      rows: [{ id: "weapon" }],
    };
    const project = stubProject({ dataSources: [ds] });
    const snapshots = { "pack:categories": [{ id: "hijack" }] };
    expect(resolveSourceRef("pack:categories" as SourceRef, project, snapshots)).toEqual([
      { id: "weapon" },
    ]);
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
    const menu = stubMenu([
      { kind: "sourceRef", name: "player", ref: "pack:missing" as SourceRef },
    ]);
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
      shape: "table",
      modelId: "m_cat" as never,
      rows: [{ id: "weapon" }, { id: "armor" }],
    };
    const project = stubProject({ dataSources: [ds] });
    const menu = stubMenu([
      { kind: "sourceRef", name: "categories", ref: "pack:categories" as SourceRef },
    ]);
    expect(buildPreviewScope(menu, project).categories).toEqual([
      { id: "weapon" },
      { id: "armor" },
    ]);
  });

  it("falls back to undefined for unresolvable sourceRef inputs", () => {
    const menu = stubMenu([{ kind: "sourceRef", name: "x", ref: "pack:missing" as SourceRef }]);
    const scope = buildPreviewScope(menu, stubProject());
    expect("x" in scope).toBe(true);
    expect(scope.x).toBeUndefined();
  });
});

describe("buildPreviewScope — sourceRef shaping + preview args", () => {
  const ROWS = [
    { id: "sword", name: "Épée", category: "weapons", price: 100 },
    { id: "bow", name: "Arc", category: "weapons", price: 50 },
    { id: "bread", name: "Pain", category: "food", price: 5 },
  ];
  const projectWithSource = () =>
    stubProject({
      dataSources: [
        {
          id: "items" as DataSourceId,
          name: "items",
          shape: "table",
          modelId: "m_items",
          rows: ROWS,
        },
      ] as unknown as DataSource[],
    });
  const menuWithFilter = (): Menu =>
    stubMenu([
      { kind: "primitive", name: "category_id", type: "string" },
      {
        kind: "sourceRef",
        name: "items",
        ref: "pack:items" as SourceRef,
        filter: { category: "{category_id}" },
      },
    ]);

  it("leaves the source unfiltered while the filter's arg has no value", () => {
    const scope = buildPreviewScope(menuWithFilter(), projectWithSource());
    expect((scope.items as unknown[]).length).toBe(3);
  });

  it("applies the filter when previewArgs provide the arg value", () => {
    const scope = buildPreviewScope(menuWithFilter(), projectWithSource(), undefined, {
      category_id: "food",
    });
    expect(scope.items).toEqual([ROWS[2]]);
    // The primitive itself reflects the preview value too (titles use it).
    expect(scope.category_id).toBe("food");
  });

  it("applies sort and limit shaping", () => {
    const menu = stubMenu([
      {
        kind: "sourceRef",
        name: "items",
        ref: "pack:items" as SourceRef,
        sort: { by: "price", direction: "desc" },
        limit: 2,
      },
    ]);
    const scope = buildPreviewScope(menu, projectWithSource());
    expect((scope.items as { id: string }[]).map((r) => r.id)).toEqual(["sword", "bow"]);
  });

  it("literal filter values apply without any preview arg", () => {
    const menu = stubMenu([
      {
        kind: "sourceRef",
        name: "items",
        ref: "pack:items" as SourceRef,
        filter: { category: "weapons" },
      },
    ]);
    const scope = buildPreviewScope(menu, projectWithSource());
    expect((scope.items as { id: string }[]).map((r) => r.id)).toEqual(["sword", "bow"]);
  });
});

describe("renderPreview with the builtin player", () => {
  it("renders player subfields", () => {
    const project = stubProject();
    const menu = stubMenu();
    const ctx = buildPreviewScope(menu, project);
    expect(renderPreview("{player.name} in {player.world}", ctx, project, "en")).toBe(
      "Steve in world",
    );
  });

  it("renders bare {player} as the name, not [object Object]", () => {
    const project = stubProject();
    const ctx = buildPreviewScope(stubMenu(), project);
    expect(renderPreview("{player}", ctx, project, "en")).toBe("Steve");
  });

  it("renders subfields of a player-typed contextInput", () => {
    const project = stubProject();
    const menu = stubMenu([{ kind: "primitive", name: "target", type: "player" }]);
    const ctx = buildPreviewScope(menu, project);
    expect(renderPreview("{target.name}", ctx, project, "en")).toBe("Steve");
    expect(renderPreview("{target}", ctx, project, "en")).toBe("Steve");
  });
});

// An Add-on's project declares its owner (`manifest.module`) and carries the
// module's data as ordinary Project sources (ADR bare-data-files). Before this,
// `boutique:categories` only resolved through the module's moduleData path
// or a live server snapshot — so offline, a placement element found no rows and
// the canvas drew dashed "dangling" slots labelled after the element id
// ("Grid"), instead of the seven categories.
describe("resolveSourceRef — a module-owned project answers for its own namespace", () => {
  afterEach(() => clearRegistry());

  const rows = [
    { id: "les_cles", name: "Les Clés" },
    { id: "premium", name: "Premium" },
  ];
  const table = {
    id: "categories" as DataSourceId,
    name: "Catégories",
    shape: "table",
    rows,
  } as unknown as DataSource;

  it("resolves <owner>:<sourceId> from the project's own table source", () => {
    const project = stubProject({ ownerModule: "boutique", dataSources: [table] });
    expect(resolveSourceRef("boutique:categories" as SourceRef, project)).toEqual(rows);
  });

  it("does not answer for a namespace the project does not own", () => {
    const project = stubProject({ ownerModule: "quests", dataSources: [table] });
    expect(resolveSourceRef("boutique:categories" as SourceRef, project)).toBeUndefined();
  });

  it("does not answer when the project declares no owner", () => {
    const project = stubProject({ dataSources: [table] });
    expect(resolveSourceRef("boutique:categories" as SourceRef, project)).toBeUndefined();
  });

  it("resolves ltext fields to text — a consumer expects text, not an LText node", () => {
    const project = stubProject({
      ownerModule: "boutique",
      defaultLang: "fr",
      i18nKeys: { "sources.categories.premium.name": { fr: "Premium" } } as Project["i18nKeys"],
      dataSources: [
        {
          id: "categories" as DataSourceId,
          name: "Catégories",
          shape: "table",
          rows: [
            { id: "premium", name: { key: "sources.categories.premium.name" } },
            // Nested rows carry ltext too (a category's items).
            {
              id: "divers",
              name: "Divers",
              items: [{ id: "i1", name: { key: "sources.categories.premium.name" } }],
            },
          ],
        } as unknown as DataSource,
      ],
    });
    expect(resolveSourceRef("boutique:categories" as SourceRef, project)).toEqual([
      { id: "premium", name: "Premium" },
      { id: "divers", name: "Divers", items: [{ id: "i1", name: "Premium" }] },
    ]);
  });

  it("still prefers a live snapshot for a source the project does not hold", () => {
    const project = stubProject({ ownerModule: "boutique", dataSources: [table] });
    const snap = [{ id: "x" }];
    expect(
      resolveSourceRef("boutique:items" as SourceRef, project, { "boutique:items": snap }),
    ).toEqual(snap);
  });
});
