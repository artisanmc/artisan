// @vitest-environment node

import { describe, expect, test } from "vitest";
import { diskAssetsFromTree } from "./diskAssets";
import { FONT_DESCRIPTOR, fontFilesFor, fontFromDisk } from "./fontOnDisk";

/**
 * A font **unpacked** on the server's disk (ADR `assets-on-server-disk`).
 *
 * The deciding measure: vanilla ASCII is 95 PNGs + a descriptor, 26 KB in
 * total. Keeping the zip would have put a black box in the middle of a folder
 * where everything else is hand-editable — to save 96 entries.
 *
 * Chosen shape:
 *
 *     assets/fonts/<name>/font.yaml     ← which character, which image, ascent
 *     assets/fonts/<name>/<texture>.png ← one file per glyph
 */
describe("unfolded font", () => {
  const png = new Uint8Array([0x89, 0x50, 0x4e, 0x47]);
  const parsed = {
    glyphMap: [
      { char: "a", texture: "glyphs/a.png", ascent: 7, height: 8, width: 5 },
      { char: "b", texture: "glyphs/b.png", ascent: 7, height: 8, width: 6 },
    ],
    glyphPngs: new Map([
      ["glyphs/a.png", png],
      ["glyphs/b.png", png],
    ]),
    warnings: [],
  };

  test("one file per glyph, plus the descriptor", () => {
    const { binaries, descriptor } = fontFilesFor("pixelmix", parsed);
    expect(binaries.map((b) => b.path)).toEqual([
      "assets/fonts/pixelmix/glyphs/a.png",
      "assets/fonts/pixelmix/glyphs/b.png",
    ]);
    expect(descriptor.path).toBe(`assets/fonts/pixelmix/${FONT_DESCRIPTOR}`);
    // The descriptor says what the PNGs cannot: which character shows which
    // image, at which height.
    expect(descriptor.content).toContain("char: a");
    expect(descriptor.content).toContain("texture: glyphs/a.png");
    expect(descriptor.content).toContain("ascent: 7");
  });

  test("read back from disk, it yields its glyph map again", () => {
    const { binaries, descriptor } = fontFilesFor("pixelmix", parsed);
    const meta = fontFromDisk(descriptor.content);
    expect(meta?.namespace).toBe("artisan:pixelmix");
    expect(meta?.glyphMap.map((g) => g.char)).toEqual(["a", "b"]);
    expect(binaries).toHaveLength(2);
  });

  test("a font's PNGs are not assets in their own right", () => {
    // Otherwise the library would show 95 "glyphs" named a, b, c… next to the
    // font: the font is the asset, not each of its images.
    const found = diskAssetsFromTree(
      "p1",
      [
        {
          path: `assets/fonts/pixelmix/${FONT_DESCRIPTOR}`,
          content: fontFilesFor("pixelmix", parsed).descriptor.content,
        },
      ],
      [
        { path: "assets/fonts/pixelmix/glyphs/a.png", hash: "h1", size: 4 },
        { path: "assets/fonts/pixelmix/glyphs/b.png", hash: "h2", size: 4 },
        { path: "assets/glyphs/diamant.png", hash: "h3", size: 4 },
      ],
    );
    // Sorted by path: `assets/fonts/…` comes before `assets/glyphs/…`.
    expect(found.map((a) => [a.row.id, a.row.type])).toEqual([
      ["pixelmix", "font"],
      ["diamant", "glyph"],
    ]);
    const font = found.find((a) => a.row.type === "font")!;
    expect((font.row.fontMeta as { glyphMap: unknown[] }).glyphMap).toHaveLength(2);
  });
});
