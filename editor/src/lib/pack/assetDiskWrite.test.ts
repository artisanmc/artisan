// @vitest-environment node

import { describe, expect, test } from "vitest";
import { assetDiskPath, descriptorYaml, nextFreeCodepoint } from "./assetDiskWrite";
import { CODEPOINT_MAX, CODEPOINT_MIN } from "./codepoints";
import type { DiskAsset } from "./diskAssets";

/**
 * Writing an asset to the server's disk (ADR `assets-on-server-disk`).
 *
 * The plugin stays the only writer.
 */
describe("assetDiskWrite", () => {
  test("the type gives the folder, the name gives the file", () => {
    expect(assetDiskPath("glyph", "Icône Diamant")).toBe("assets/glyphs/ic-ne-diamant.png");
    expect(assetDiskPath("texture", "fond_boutique")).toBe("assets/textures/fond_boutique.png");
  });

  test("the descriptor carries only what is known", () => {
    expect(descriptorYaml({ ascent: 8, codepoint: 57344, width: 16, height: 16 })).toBe(
      "ascent: 8\ncodepoint: 57344\nwidth: 16\nheight: 16\n",
    );
    // No null keys: a file the admin opens must contain facts, not empty
    // boxes.
    expect(descriptorYaml({ ascent: null, codepoint: null })).toBe("{}\n");
  });

  const used = (cp: number): DiskAsset => ({
    path: `assets/glyphs/g${cp}.png`,
    hash: "h",
    row: { codepoint: cp } as DiskAsset["row"],
  });

  test("the proposed codepoint is the first free one", () => {
    expect(nextFreeCodepoint([])).toBe(0xe000);
    expect(nextFreeCodepoint([used(0xe000), used(0xe001)])).toBe(0xe002);
  });

  /**
   * U+F800..U+F8FF belongs to the `space` providers (cf. `spaceOffsets.ts`), and
   * U+F900+ to the CJK Compatibility block, where the default font has glyphs.
   * The old SQL allocator stopped at U+F7FF for that reason; its on-disk
   * successor went up to U+F8FF — it would eventually have given a glyph a
   * space's codepoint.
   */
  test("does not leave the range reserved for glyphs", () => {
    const all: DiskAsset[] = [];
    for (let cp = CODEPOINT_MIN; cp <= CODEPOINT_MAX; cp++) all.push(used(cp));
    expect(() => nextFreeCodepoint(all)).toThrow();
    expect(nextFreeCodepoint(all.slice(0, -1))).toBe(CODEPOINT_MAX);
  });
});
