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
import { buildModuleList, buildProjectGroups, diskProjectsToSummaries } from "./projectGroups";

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
  it("leaves a module's configuration root out of the list, its screens under the module", () => {
    const { projects, moduleGroups } = buildProjectGroups({
      projects: [
        project("hub"),
        project("dailyrewards", { ownerModule: "boutique", role: "config" }),
      ],
      screens: [screen("boutique:rewards", "boutique", "dailyrewards")],
      mountedModuleIds: [],
      localProjects: [],
    });
    expect(projects.map((p) => p.id)).toEqual(["hub"]);
    expect(moduleGroups.map((g) => [g.id, g.screens.map((s) => s.id)])).toEqual([
      ["boutique", ["boutique:rewards"]],
    ]);
  });
  it("keeps ordinary projects in the list, without a module group", () => {
    const { projects, moduleGroups } = buildProjectGroups({
      projects: [project("hub"), project("lobby")],
      screens: [],
      mountedModuleIds: [],
      localProjects: [],
    });
    expect(projects.map((p) => [p.id, p.ownerLabel])).toEqual([
      ["hub", null],
      ["lobby", null],
    ]);
    expect(moduleGroups).toEqual([]);
  });

  it("keeps an add-on-owned project in the list, in order, badged with its module", () => {
    const { projects, moduleGroups } = buildProjectGroups({
      projects: [project("hub"), project("boutique_shop"), project("lobby")],
      screens: [screen("catalogue", "boutique", "boutique_shop")],
      mountedModuleIds: [],
      localProjects: [],
    });
    expect(projects.map((p) => p.id)).toEqual(["hub", "boutique_shop", "lobby"]);
    expect(projects[1]).toMatchObject({ ownerModule: "boutique", ownerLabel: "Boutique" });
    expect(moduleGroups.map((g) => g.id)).toEqual(["boutique"]);
  });

  it("lists only what the module manages: declared screens, then its configuration route", () => {
    const { moduleGroups } = buildProjectGroups({
      projects: [project("quests_data")],
      screens: [screen("quests_list", "quests", "quests_data")],
      mountedModuleIds: ["quests"],
      localProjects: [],
    });
    const g = moduleGroups[0]!;
    expect(g.hasScreen).toBe(true);
    expect(g.entries.map((e) => e.kind)).toEqual(["screen", "config"]);
  });

  it("gives no group to a module with nothing to configure", () => {
    const { projects, moduleGroups } = buildProjectGroups({
      projects: [project("guild_menus", { ownerModule: "msguilds" })],
      screens: [],
      mountedModuleIds: [],
      localProjects: [],
    });
    expect(projects[0]).toMatchObject({ ownerModule: "msguilds", ownerLabel: "msguilds" });
    expect(moduleGroups).toEqual([]);
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

describe("buildModuleList", () => {
  const input = (
    projects: ProjectSummary[],
    screens: ServerEditorScreen[] = [],
    mounted: string[] = [],
  ) => ({
    projects,
    screens,
    mountedModuleIds: mounted,
    localProjects: [],
  });

  it("puts a plugin's folder under its module, the admin's folders apart, in order", () => {
    const { pluginModules, contentModules } = buildModuleList(
      input(
        [project("lobby"), project("boutique_shop"), project("hub")],
        [screen("catalogue", "boutique", "boutique_shop")],
      ),
    );
    expect(contentModules.map((p) => p.id)).toEqual(["lobby", "hub"]);
    expect(pluginModules).toHaveLength(1);
    expect(pluginModules[0]).toMatchObject({ id: "boutique", label: "Boutique" });
    expect(pluginModules[0]!.projects.map((p) => p.id)).toEqual(["boutique_shop"]);
    expect(pluginModules[0]!.entries.map((e) => e.kind)).toEqual(["screen"]);
  });

  it("keeps a plugin module that has a folder and nothing to configure", () => {
    const { pluginModules, contentModules } = buildModuleList(
      input([project("guild_menus", { ownerModule: "msguilds" })]),
    );
    expect(contentModules).toEqual([]);
    expect(pluginModules.map((m) => [m.id, m.projects.map((p) => p.id), m.entries])).toEqual([
      ["msguilds", ["guild_menus"], []],
    ]);
  });

  it("keeps a plugin module without a folder, and never lists its configuration root", () => {
    const { pluginModules } = buildModuleList(
      input(
        [project("dailyrewards", { ownerModule: "boutique", role: "config" })],
        [screen("boutique:rewards", "boutique", "dailyrewards")],
        ["quests"],
      ),
    );
    expect(pluginModules.map((m) => [m.label, m.projects.length])).toEqual([
      ["Boutique", 0],
      ["Quêtes", 0],
    ]);
  });
});
