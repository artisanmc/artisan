import type { DeclaredAction } from "@/lib/api/declaredActions";
import { describe, expect, it } from "vitest";
import { canonicalModuleValue, normalizeModuleArgs } from "./moduleActions";

const start: DeclaredAction = {
  name: "quests:start",
  moduleId: "quests",
  primary: "quest",
  args: [
    { name: "quest", type: { kind: "document_ref", document: "quest" }, required: true },
    { name: "silent", type: { kind: "boolean" }, default: false },
  ],
};
const refresh: DeclaredAction = {
  name: "quests:refresh",
  moduleId: "quests",
  primary: null,
  args: [],
};

describe("module action wire ⇄ arguments", () => {
  it("binds the three wire forms like the server", () => {
    expect(normalizeModuleArgs(start, null)).toEqual({});
    expect(normalizeModuleArgs(start, "intro")).toEqual({ quest: "intro" });
    expect(normalizeModuleArgs(start, { quest: "intro", silent: true })).toEqual({
      quest: "intro",
      silent: true,
    });
    // A map that is not an argument map is the primary's value.
    expect(normalizeModuleArgs(start, { en: "x" })).toEqual({ quest: { en: "x" } });
    expect(normalizeModuleArgs(refresh, { anything: 1 })).toEqual({ anything: 1 });
  });

  it("writes the shortest canonical form back", () => {
    expect(canonicalModuleValue(start, {})).toBeNull();
    expect(canonicalModuleValue(start, { quest: "intro" })).toBe("intro");
    expect(canonicalModuleValue(start, { quest: "intro", silent: true })).toEqual({
      quest: "intro",
      silent: true,
    });
    expect(canonicalModuleValue(start, { silent: true })).toEqual({ silent: true });
  });
});
