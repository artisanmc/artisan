import type { Project, ProjectId } from "@/domain/types";
import type { BoardEdge } from "@/features/canvas/serverGraph";
import type { ServerEditorScreen } from "@/lib/api/configScreens";
import { describe, expect, it } from "vitest";
import { buildRegistry, selectDocument, toggleGroup } from "./registryTree";

const project = (id: string, menus: string[], commands: string[] = []): Project =>
  ({
    id: id as ProjectId,
    name: id.toUpperCase(),
    menus: menus.map((m) => ({ id: m, layers: [] })),
    commands: commands.map((c) => ({ id: c, name: c.replace("cmd_", "") })),
    dialogs: [],
  }) as unknown as Project;

const core = project("core", ["menu_accueil", "menu_vide"], ["cmd_menu"]);
const shop = project("boutique_shop", ["menu_catalogue"]);
const screen: ServerEditorScreen = {
  id: "catalogue",
  moduleId: "boutique",
  label: "Catalogue",
  table: "items",
  projectId: "boutique_shop",
};

const edges: BoardEdge[] = [
  { id: "a", source: "core/cmd_menu", target: "core/menu_accueil", edge: {} as never },
  {
    id: "b",
    source: "core/menu_accueil",
    target: "boutique_shop/menu_catalogue",
    edge: {} as never,
  },
];

const input = {
  entries: [
    { project: core, ownerModule: null },
    { project: shop, ownerModule: "boutique" },
  ],
  modules: [
    { id: "boutique", label: "Boutique", screens: [screen] },
    { id: "quetes", label: "Quêtes", screens: [] },
  ],
  edges,
  activeLang: "fr",
};

describe("buildRegistry", () => {
  it("groups ordinary projects first, then each installed module with its screens", () => {
    const { groups } = buildRegistry({ ...input, filter: {} });
    expect(groups.map((g) => [g.id, g.label])).toEqual([
      ["core", "CORE"],
      ["module:boutique", "Boutique"],
      ["module:quetes", "Quêtes"],
    ]);
    const boutique = groups[1]!;
    expect(boutique.projectIds).toEqual(["boutique_shop"]);
    expect(boutique.screens.map((s) => s.id)).toEqual(["catalogue"]);
    expect(boutique.sections[0]!.items.map((i) => i.key)).toEqual(["boutique_shop/menu_catalogue"]);
  });

  it("lists what has no link as unlinked — the board's gutter", () => {
    const { unlinked } = buildRegistry({ ...input, filter: {} });
    expect(unlinked.map((i) => i.key)).toEqual(["core/menu_vide"]);
  });

  it("keeps hidden groups listed but out of the gutter", () => {
    const { groups, unlinked } = buildRegistry({ ...input, filter: { hide: ["core"] } });
    expect(groups[0]!.hidden).toBe(true);
    expect(groups[0]!.sections.length).toBeGreaterThan(0);
    expect(unlinked).toEqual([]);
  });

  it("applies the text and type filters, dropping groups left empty", () => {
    const { groups } = buildRegistry({ ...input, filter: { q: "/menu" } });
    expect(groups.map((g) => g.id)).toEqual(["core"]);
    expect(groups[0]!.sections.map((s) => s.kind)).toEqual(["command"]);
    const menus = buildRegistry({ ...input, filter: { kind: "menu" } }).groups;
    expect(menus.map((g) => g.id)).toEqual(["core", "module:boutique"]);
  });
});

describe("toggleGroup / selectDocument", () => {
  it("unchecks then rechecks every project of a group", () => {
    const [coreGroup] = buildRegistry({ ...input, filter: {} }).groups;
    const off = toggleGroup({}, coreGroup!);
    expect(off.hide).toEqual(["core"]);
    const [hiddenGroup] = buildRegistry({ ...input, filter: off }).groups;
    expect(toggleGroup(off, hiddenGroup!).hide).toBeUndefined();
  });

  it("reveals the project of a Document picked while it was hidden", () => {
    const [coreGroup] = buildRegistry({ ...input, filter: { hide: ["core"] } }).groups;
    const item = coreGroup!.sections[0]!.items[0]!;
    expect(selectDocument({ hide: ["core"], q: "x" }, item)).toEqual({
      q: "x",
      hide: undefined,
      doc: item.key,
    });
  });
});
