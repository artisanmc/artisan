import { describe, expect, it } from "vitest";
import { stringifyWithHints } from "./yamlHints";

describe("stringifyWithHints — numbered keys", () => {
  it("writes a mapping keyed by numbers with plain keys", () => {
    const out = stringifyWithHints({ levels: { "0": { xp: 0 }, "10": { xp: 10 } } }, [], {
      lineWidth: 0,
    });
    expect(out).toBe("levels:\n  0:\n    xp: 0\n  10:\n    xp: 10\n");
  });

  it("keeps a mixed mapping and a padded number as strings", () => {
    const out = stringifyWithHints({ a: { "404": 1, other: 2 }, b: { "007": 1 } }, [], {
      lineWidth: 0,
    });
    expect(out).toContain('"404": 1');
    expect(out).toContain('"007": 1');
  });
});
