import { describe, expect, it } from "vitest";
import vector from "../../../testdata/lore-wrap-conformance.json";
import { loreWrapPoints, mcLineWidth, wrapLore } from "./loreWrap";

/** Editor half of `testdata/lore-wrap-conformance.json` — the plugin asserts the same vector. */
describe("wrapLore conformance", () => {
  for (const c of vector.cases) {
    it(c.name, () => {
      expect(wrapLore(c.line, c.width)).toEqual(c.expected);
    });
  }
});

/** The marks of the rich editor sit where `wrapLore` really starts each new line. */
describe("loreWrapPoints", () => {
  for (const c of vector.cases) {
    it(c.name, () => {
      const breaks = loreWrapPoints(c.line, c.width);
      expect(breaks).toHaveLength(c.expected.length - 1);
      breaks.forEach((at, k) => {
        const chunk = c.line.slice(at, breaks[k + 1] ?? c.line.length).trimEnd();
        expect(c.expected[k + 1]!.endsWith(chunk)).toBe(true);
      });
    });
  }
});

describe("mcLineWidth", () => {
  it("counts the font's advances, tags none, +1 per bold char", () => {
    expect(mcLineWidth("ab")).toBe(12);
    expect(mcLineWidth("<red>ab</red>")).toBe(12);
    expect(mcLineWidth("<bold>ab</bold>c")).toBe(20);
    expect(mcLineWidth("i l")).toBe(2 + 4 + 3);
  });
});
