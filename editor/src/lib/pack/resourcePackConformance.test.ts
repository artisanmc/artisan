// @vitest-environment node

import { readFileSync } from "node:fs";
import { describe, expect, test } from "vitest";
import vectors from "../../../../testdata/resource-pack-conformance.json";
import {
  type ConformanceCase,
  KOTLIN_FONT_CHARS,
  buildCase,
  expectedOf,
  kotlinFontChars,
} from "../../../scripts/pack/cli";

/**
 * The pack, byte for byte, from each case's inputs: what the hub's Kotlin builder must also
 * produce. `npm run pack -- vectors --write` regenerates the expected values after an intended
 * change to the zip.
 */
describe("resource pack — cross-stack vector", () => {
  for (const c of vectors.cases as unknown as ConformanceCase[]) {
    test(c.name, async () => {
      const actual = expectedOf(await buildCase(c));
      expect(actual.entries).toEqual(c.entries);
      expect(actual.entryHashes).toEqual(c.entryHashes);
      expect(actual.textYFonts).toBe(c.textYFonts);
      expect(actual.textUpFonts).toBe(c.textUpFonts);
      expect(actual.sha1).toBe(c.sha1);
    });
  }
});

test("the Kotlin builder's vanilla font tables match vanillaFontChars.ts (npm run pack -- kotlin-data)", () => {
  expect(readFileSync(KOTLIN_FONT_CHARS, "utf-8")).toBe(kotlinFontChars());
});
