import { beforeEach, describe, expect, it, vi } from "vitest";

const registered = new Map<string, unknown>();
vi.mock("@artisan/editor-sdk", () => ({
  getModule: (id: string) => registered.get(id),
}));

import { selectModuleNavEntries } from "./moduleNav";

beforeEach(() => registered.clear());

describe("selectModuleNavEntries", () => {
  it("returns registered modules that have a route, in id order", () => {
    registered.set("quests", {
      id: "quests",
      sidebar: { icon: () => null, label: "Quests", to: "/m/quests" },
      routes: [{ path: "/", component: () => null }],
    });
    const entries = selectModuleNavEntries(["quests"]);
    expect(entries.map((m) => m.id)).toEqual(["quests"]);
  });

  it("skips ids that are not registered", () => {
    expect(selectModuleNavEntries(["ghost"])).toEqual([]);
  });

  it("skips registered modules with no routes (e.g. core menus/commands)", () => {
    registered.set("menus", {
      id: "menus",
      sidebar: { icon: () => null, label: "Menus", to: "/servers" },
      routes: [],
    });
    expect(selectModuleNavEntries(["menus"])).toEqual([]);
  });
});
