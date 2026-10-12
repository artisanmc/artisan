import { createHash } from "node:crypto";
import { describe, expect, it } from "vitest";
import { sha1Hex } from "./sha1";

describe("sha1Hex", () => {
  it("matches node for empty, short and multi-block inputs", () => {
    for (const size of [0, 1, 55, 56, 63, 64, 65, 1000, 100_000]) {
      const bytes = new Uint8Array(size).map((_, i) => (i * 31 + 7) & 0xff);
      expect(sha1Hex(bytes)).toBe(createHash("sha1").update(bytes).digest("hex"));
    }
  });
});
