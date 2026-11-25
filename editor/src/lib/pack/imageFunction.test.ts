import { describe, expect, test } from "vitest";
import { diskAssetsFromTree } from "./diskAssets";
import { imageFunctionOf, measuredPaths, refusedImages } from "./imageFunction";

const files = (entries: Record<string, string>) =>
  Object.entries(entries).map(([path, content]) => ({ path, content }));
const binaries = (paths: string[]) => paths.map((path) => ({ path, hash: path, size: 1 }));

describe("an image's function", () => {
  test("is one of menu, glyph and hud; anything else is none", () => {
    expect(imageFunctionOf({ function: "menu" })).toBe("menu");
    expect(imageFunctionOf({ function: "glyph" })).toBe("glyph");
    expect(imageFunctionOf({ function: "hud" })).toBe("hud");
    expect(imageFunctionOf({ function: "button" })).toBeNull();
    expect(imageFunctionOf({ function: 3 })).toBeNull();
    expect(imageFunctionOf({})).toBeNull();
    expect(imageFunctionOf(["function"])).toBeNull();
    expect(imageFunctionOf(undefined)).toBeNull();
  });

  const tree = {
    files: files({
      "originals/assets/textures/panel.yml": "function: menu\n",
      "originals/assets/textures/badge.yaml": "function: hud\n",
      "originals/assets/textures/free.yml": "width: 8\n",
      "originals/assets/glyphs/coin.yml":
        "function: glyph\nheight: 8\nascent: 7\ncodepoint: 57344\n",
      "originals/assets/glyphs/gem.yml": "function: glyph\nheight: 8\nascent: 7\n",
      "originals/assets/glyphs/star.yml": "function: glyph\nheight: 8\nascent: 7\n",
      // The owner's descriptor says another ascent; `star` has none and reads the original's.
      "assets/glyphs/gem.yml": "height: 8\nascent: 9\n",
      "assets/glyphs/coin.yaml": "height: 8\nascent: 7\ncodepoint: 57344\n",
      // No original under this name: nothing to measure against.
      "assets/textures/mine.yml": "function: menu\n",
    }),
    binaries: binaries([
      "originals/assets/textures/panel.png",
      "originals/assets/textures/badge.png",
      "originals/assets/textures/free.png",
      "originals/assets/glyphs/coin.png",
      "originals/assets/glyphs/gem.png",
      "originals/assets/glyphs/star.png",
      "assets/textures/panel.png",
      "assets/textures/badge.png",
      "assets/textures/free.png",
      "assets/textures/mine.png",
      "assets/glyphs/coin.png",
      "assets/glyphs/gem.png",
      "assets/glyphs/star.png",
    ]),
  };
  const sizes: Record<string, { width: number; height: number } | null> = {
    "originals/assets/textures/panel.png": { width: 20, height: 10 },
    "assets/textures/panel.png": { width: 20, height: 10 },
    "originals/assets/textures/badge.png": { width: 12, height: 12 },
    "assets/textures/badge.png": { width: 16, height: 12 },
  };
  const sizeOf = (path: string) => sizes[path] ?? null;

  test("asks for the pixels of both sides of a menu or HUD image, never of a glyph", () => {
    expect(measuredPaths(tree.files, tree.binaries)).toEqual([
      "assets/textures/panel.png",
      "originals/assets/textures/panel.png",
      "assets/textures/badge.png",
      "originals/assets/textures/badge.png",
    ]);
  });

  test("the owner's image at other measures than its original's is not taken", () => {
    expect(refusedImages(tree.files, tree.binaries, sizeOf).map((i) => i.path)).toEqual([
      "assets/textures/badge.png",
      "assets/glyphs/gem.png",
    ]);
    // Without the pixels, a menu or HUD image is taken; a glyph is still measured.
    expect(refusedImages(tree.files, tree.binaries).map((i) => i.path)).toEqual([
      "assets/glyphs/gem.png",
    ]);
    // An owner's file that is no image is not taken; an original that is none measures nothing.
    const broken = (path: string) =>
      path === "assets/textures/panel.png" || path === "originals/assets/textures/badge.png"
        ? null
        : sizeOf(path);
    expect(refusedImages(tree.files, tree.binaries, broken).map((i) => i.path)).toEqual([
      "assets/textures/panel.png",
      "assets/glyphs/gem.png",
    ]);
  });

  test("the pack's read shows the original, descriptor included, in place of an image not taken", () => {
    const read = diskAssetsFromTree("p", tree.files, tree.binaries, { originals: true, sizeOf });
    const at = Object.fromEntries(read.map((a) => [`${a.row.type}/${a.row.id}`, a]));
    expect(at["texture/panel"]?.path).toBe("assets/textures/panel.png");
    expect(at["texture/badge"]?.path).toBe("originals/assets/textures/badge.png");
    expect(at["texture/free"]?.path).toBe("assets/textures/free.png");
    expect(at["texture/mine"]?.path).toBe("assets/textures/mine.png");
    expect(at["glyph/coin"]?.path).toBe("assets/glyphs/coin.png");
    expect(at["glyph/gem"]?.path).toBe("originals/assets/glyphs/gem.png");
    expect(at["glyph/gem"]?.row.ascent).toBe(7);
    expect(at["glyph/star"]?.path).toBe("assets/glyphs/star.png");
    expect(read).toHaveLength(7);
    // The editor's own read (no pixels) and a read without originals leave the owner's files.
    expect(
      diskAssetsFromTree("p", tree.files, tree.binaries).find((a) => a.row.id === "gem")?.row
        .ascent,
    ).toBe(9);
  });
});
