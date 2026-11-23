// @vitest-environment node

import { readFileSync } from "node:fs";
import { strFromU8, unzipSync } from "fflate";
import { describe, expect, test } from "vitest";
import vectors from "../../../../testdata/resource-pack-conformance.json";
import {
  type ConformanceCase,
  KOTLIN_FONT_CHARS,
  KOTLIN_SYMBOL_GLYPHS,
  bedrockExpectedOf,
  buildCase,
  expectedOf,
  kotlinFontChars,
  kotlinSymbolGlyphs,
} from "../../../scripts/pack/cli";
import { readPngDimensions } from "./pngDimensions";

/**
 * The pack, byte for byte, from each case's inputs: what the hub's Kotlin builder must also
 * produce. `npm run pack -- vectors --write` regenerates the expected values after an intended
 * change to the zip.
 */
describe("resource pack — cross-stack vector", () => {
  for (const c of vectors.cases as unknown as ConformanceCase[]) {
    test(c.name, async () => {
      const result = await buildCase(c);
      const actual = expectedOf(result);
      expect(actual.entries).toEqual(c.entries);
      expect(actual.entryHashes).toEqual(c.entryHashes);
      expect(actual.textYFonts).toBe(c.textYFonts);
      expect(actual.textYSized).toEqual(c.textYSized);
      expect(actual.textUpFonts).toBe(c.textUpFonts);
      expect(actual.sha1).toBe(c.sha1);
      if (c.bedrock) {
        const bedrock = bedrockExpectedOf(result, c.bedrock.serverId);
        expect(bedrock?.entries).toEqual(c.bedrock.entries);
        expect(bedrock?.entryHashes).toEqual(c.bedrock.entryHashes);
        expect(bedrock?.sha1).toBe(c.bedrock.sha1);
      }
    });
  }
});

test("the Kotlin builder's vanilla font tables match vanillaFontChars.ts (npm run pack -- kotlin-data)", () => {
  expect(readFileSync(KOTLIN_FONT_CHARS, "utf-8")).toBe(kotlinFontChars());
});

test("the Kotlin builder's symbol glyphs match symbolGlyphs.ts (npm run pack -- kotlin-data)", () => {
  expect(readFileSync(KOTLIN_SYMBOL_GLYPHS, "utf-8")).toBe(kotlinSymbolGlyphs());
});

/**
 * Nexo replaces a font texture it judges too large with a placeholder, so the glyphs vanish in
 * game. Nexo 1.20 checks a one-row bitmap provider: no side above 256 px. Nexo 1.29 checks each
 * cell: at most 256 × 256. Every texture of the `artisan:font/` fonts must pass both (the HD
 * chest's `artisan:gui/` sheets keep the scale of the image the user drew).
 */
function nexoRejected(zip: Record<string, Uint8Array>): string[] {
  const problems: string[] = [];
  for (const [path, bytes] of Object.entries(zip)) {
    if (!/^assets\/[^/]+\/font\/[^/]+\.json$/.test(path)) continue;
    const font = JSON.parse(strFromU8(bytes)) as {
      providers: { type: string; file?: string; chars?: string[] }[];
    };
    for (const p of font.providers) {
      if (p.type !== "bitmap" || !p.file || !p.chars) continue;
      const [ns, value] = p.file.split(":");
      const texture = zip[`assets/${ns}/textures/${value}`];
      if (!texture || !value!.startsWith("font/")) continue;
      const { width, height } = readPngDimensions(texture);
      const cols = Math.max(...p.chars.map((row) => [...row].length));
      const [cellW, cellH] = [width / cols, height / p.chars.length];
      if (cellW > 256 || cellH > 256) problems.push(`${p.file}: ${cellW}x${cellH} cells`);
      if (p.chars.length <= 1 && Math.max(width, height) > 256)
        problems.push(`${p.file}: one row, ${width}x${height}`);
    }
  }
  return [...new Set(problems)];
}

describe("resource pack — font textures Nexo keeps", () => {
  for (const c of vectors.cases as unknown as ConformanceCase[]) {
    test(c.name, async () => {
      expect(nexoRejected(unzipSync((await buildCase(c)).zipBytes))).toEqual([]);
    });
  }
});
