import type { ServerDataSource } from "@/lib/api/dataSources";
import { describe, expect, it } from "vitest";
import { groupServerSources } from "./serverSourceGroups";

const src = (ref: string, moduleId: string | null): ServerDataSource => ({
  ref,
  moduleId,
  schema: [],
  schemaHint: null,
});

describe("groupServerSources", () => {
  it("groups by moduleId: core modules first (alpha), then others (alpha), null last", () => {
    const groups = groupServerSources([
      src("zoo:b", "zoo"),
      src("core:x", null),
      src("menus:nav", "menus"),
      src("boutique:items", "boutique"),
      src("commands:list", "commands"),
    ]);
    expect(groups.map((g) => g.moduleId)).toEqual(["commands", "menus", "boutique", "zoo", null]);
  });

  it("sorts sources alphabetically by ref inside a group", () => {
    const groups = groupServerSources([
      src("boutique:z", "boutique"),
      src("boutique:a", "boutique"),
    ]);
    expect(groups[0]!.sources.map((s) => s.ref)).toEqual(["boutique:a", "boutique:z"]);
  });

  it("returns [] for no sources", () => {
    expect(groupServerSources([])).toEqual([]);
  });
});
