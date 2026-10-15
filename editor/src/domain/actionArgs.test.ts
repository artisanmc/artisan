import type { DeclaredAction } from "@/lib/api/declaredActions";
import { describe, expect, it } from "vitest";
import { canonicalActionValue, isLTextNode, normalizeActionArgs } from "./actionArgs";

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

describe("action wire ⇄ arguments", () => {
  it("binds the three wire forms like the server", () => {
    expect(normalizeActionArgs(start, null)).toEqual({});
    expect(normalizeActionArgs(start, "intro")).toEqual({ quest: "intro" });
    expect(normalizeActionArgs(start, { quest: "intro", silent: true })).toEqual({
      quest: "intro",
      silent: true,
    });
    // A map that is not an argument map is the primary's value.
    expect(normalizeActionArgs(start, { en: "x" })).toEqual({ quest: { en: "x" } });
    expect(normalizeActionArgs(refresh, { anything: 1 })).toEqual({ anything: 1 });
    // An adopted text at the primary is a value, never an argument map.
    expect(normalizeActionArgs(start, { key: "k1" })).toEqual({ quest: { key: "k1" } });
    expect(isLTextNode({ key: "k1" })).toBe(true);
    expect(isLTextNode({ key: "k1", en: "x" })).toBe(false);
  });

  it("writes the shortest canonical form back", () => {
    expect(canonicalActionValue(start, {})).toBeNull();
    expect(canonicalActionValue(start, { quest: "intro" })).toBe("intro");
    expect(canonicalActionValue(start, { quest: "intro", silent: true })).toEqual({
      quest: "intro",
      silent: true,
    });
    expect(canonicalActionValue(start, { silent: true })).toEqual({ silent: true });
    // An argument at its declared default is the server's own reading: dropped.
    expect(canonicalActionValue(start, { quest: "intro", silent: false })).toBe("intro");
  });
});
