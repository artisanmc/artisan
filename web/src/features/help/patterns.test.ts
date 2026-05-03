import { describe, expect, it } from "vitest";
import { PATTERNS } from "./patterns";

describe("PATTERNS", () => {
  it("ships 15 entries", () => {
    expect(PATTERNS).toHaveLength(15);
  });

  it("each entry has unique id", () => {
    const ids = PATTERNS.map((p) => p.id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it("each entry has a non-empty snippet", () => {
    for (const p of PATTERNS) {
      expect(p.snippet.length).toBeGreaterThan(0);
    }
  });

  it("each kind is one of lore | condition | action", () => {
    for (const p of PATTERNS) {
      expect(["lore", "condition", "action"]).toContain(p.kind);
    }
  });
});
