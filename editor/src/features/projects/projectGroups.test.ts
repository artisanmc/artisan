import { describe, expect, it, vi } from "vitest";

vi.mock("@artisan/editor-sdk", () => ({
  getModule: (id: string) =>
    id === "boutique"
      ? { id: "boutique", displayName: "Boutique", routes: [] }
      : id === "quests"
        ? {
            id: "quests",
            displayName: "Quêtes",
            sidebar: { label: "Quêtes" },
            routes: [{ path: "/" }],
          }
        : undefined,
}));

import type { ServerEditorScreen } from "@/lib/api/configScreens";
import type { ProjectSummary } from "@/lib/api/servers";
import { buildProjectGroups, diskProjectsToSummaries } from "./projectGroups";

const project = (id: string, extra: Partial<ProjectSummary> = {}): ProjectSummary => ({
  id,
  name: id,
  slug: id,
  hash: "",
  serverKeyId: "sk_1",
  ...extra,
});

const screen = (id: string, moduleId: string, projectId: string): ServerEditorScreen => ({
  id,
  moduleId,
  label: id,
  table: `data/${id}`,
  projectId,
});

describe("buildProjectGroups", () => {
  it("preserves backend identities and rename capabilities for listed disk folders", () => {
    const metadata = project("immutable", {
      externalId: "shop",
      capabilities: { canRename: true },
    });
    expect(diskProjectsToSummaries("sk_1", ["shop"], [metadata])).toEqual([metadata]);
    expect(diskProjectsToSummaries("sk_1", ["legacy"])[0]?.capabilities).toBeUndefined();
  });
  it("keeps ordinary projects flat", () => {
    const { flatProjects, moduleGroups } = buildProjectGroups({
      projects: [project("hub"), project("lobby")],
      screens: [],
      mountedModuleIds: [],
      localProjects: [],
    });
    expect(flatProjects.map((p) => p.id)).toEqual(["hub", "lobby"]);
    expect(moduleGroups).toEqual([]);
  });

  it("moves an add-on-owned project under its module, named after the module", () => {
    const { flatProjects, moduleGroups } = buildProjectGroups({
      projects: [project("hub"), project("boutique_shop")],
      screens: [screen("catalogue", "boutique", "boutique_shop")],
      mountedModuleIds: [],
      localProjects: [],
    });
    expect(flatProjects.map((p) => p.id)).toEqual(["hub"]);
    expect(moduleGroups).toHaveLength(1);
    expect(moduleGroups[0]!.id).toBe("boutique");
    expect(moduleGroups[0]!.label).toBe("Boutique");
    expect(moduleGroups[0]!.projects.map((p) => p.id)).toEqual(["boutique_shop"]);
  });

  it("lists the module's entries: editor, declared screens, then its configuration route", () => {
    const { moduleGroups } = buildProjectGroups({
      projects: [project("quests_data")],
      screens: [screen("quests_list", "quests", "quests_data")],
      mountedModuleIds: ["quests"],
      localProjects: [],
    });
    const g = moduleGroups[0]!;
    expect(g.hasScreen).toBe(true);
    expect(g.collapsed).toBe(false);
    expect(g.entries.map((e) => e.kind)).toEqual(["project", "screen", "config"]);
    expect(g.entries[0]).toMatchObject({ kind: "project", label: null });
  });

  it("collapses a screenless single-project module to one entry", () => {
    const { moduleGroups } = buildProjectGroups({
      projects: [project("boutique_shop", { ownerModule: "boutique" })],
      screens: [],
      mountedModuleIds: ["boutique"],
      localProjects: [],
    });
    const g = moduleGroups[0]!;
    expect(g.collapsed).toBe(true);
    expect(g.entries).toHaveLength(1);
  });

  it("keeps real names when a module owns several projects", () => {
    const { moduleGroups } = buildProjectGroups({
      projects: [
        project("a", { ownerModule: "boutique" }),
        project("b", { ownerModule: "boutique" }),
      ],
      screens: [],
      mountedModuleIds: [],
      localProjects: [],
    });
    const g = moduleGroups[0]!;
    expect(g.collapsed).toBe(false);
    expect(g.entries.map((e) => (e.kind === "project" ? e.label : e.kind))).toEqual(["a", "b"]);
  });

  it("surfaces a mounted module even when it owns no project", () => {
    const { moduleGroups } = buildProjectGroups({
      projects: [],
      screens: [],
      mountedModuleIds: ["quests"],
      localProjects: [],
    });
    expect(moduleGroups.map((g) => g.id)).toEqual(["quests"]);
  });
});
