import { describe, expect, it } from "vitest";
import {
  imageMarks,
  imageNotTaken,
  imageStanding,
  ownerHolds,
  shippedUntouched,
} from "./imageStanding";

const h = (hash: string) => ({ hash });

describe("imageMarks", () => {
  it("marks the owner's version of an image the module ships, and the one the pack leaves out", () => {
    const files = {
      "originals/assets/textures/crest.yml": "function: menu\nwidth: 54\nheight: 18\n",
      "assets/textures/crest.yml": "width: 20\nheight: 20\n",
      "originals/assets/textures/banner.yml": "function: menu\nwidth: 54\nheight: 18\n",
      "assets/textures/banner.yml": "width: 54\nheight: 18\n",
      "originals/assets/glyphs/coin.yml": "function: glyph\nheight: 8\nascent: 7\n",
      "assets/glyphs/coin.yml": "height: 9\nascent: 7\n",
    };
    const binaries = {
      "originals/assets/textures/crest.png": h("o1"),
      "assets/textures/crest.png": h("m1"),
      "originals/assets/textures/banner.png": h("o2"),
      "assets/textures/banner.png": h("m2"),
      "originals/assets/glyphs/coin.png": h("o3"),
      "assets/glyphs/coin.png": h("m3"),
      // Shipped and left as it is, drawn by the owner alone, and an original with no function.
      "originals/assets/textures/frame.png": h("o4"),
      "assets/textures/mine.png": h("m5"),
      "originals/assets/textures/plain.png": h("o6"),
      "assets/textures/plain.png": h("m6"),
    };
    expect(Object.fromEntries(imageMarks(files, binaries))).toEqual({
      "assets/textures/crest": "not_taken",
      "assets/textures/banner": "own_version",
      "assets/glyphs/coin": "not_taken",
      "assets/textures/plain": "own_version",
    });
    // The list and the panel agree on what is not taken.
    expect(imageNotTaken(files, binaries, { id: "crest", type: "texture" })).not.toBeNull();
    expect(imageNotTaken(files, binaries, { id: "banner", type: "texture" })).toBeNull();
  });

  it("takes the owner's composed image of a shipped PNG's name as the owner's version", () => {
    const recipe = "compose:\n  - image: window_layer\n";
    const files = {
      "originals/assets/glyphs/window.yml": "ascent: 13\n",
      "assets/glyphs/window.yml": `ascent: 13\n${recipe}`,
      // A descriptor without a recipe says something of the shipped image, which stays the one shown.
      "assets/glyphs/icon.yml": "ascent: 9\n",
    };
    const binaries = {
      "originals/assets/glyphs/window.png": h("o1"),
      "assets/glyphs/window_layer.png": h("m1"),
      "originals/assets/glyphs/icon.png": h("o2"),
    };
    expect(Object.fromEntries(imageMarks(files, binaries))).toEqual({
      "assets/glyphs/window": "own_version",
    });
    const composed = { width: null, height: null, layers: [] };
    const paths = Object.keys(files);
    expect(
      imageStanding(binaries, { id: "window", type: "glyph", compose: composed }, paths),
    ).toEqual({
      own: "assets/glyphs/window.yml",
      original: { path: "originals/assets/glyphs/window.png", hash: "o1" },
    });
    expect(imageStanding(binaries, { id: "icon", type: "glyph" }, paths)).toEqual({
      original: { path: "originals/assets/glyphs/icon.png", hash: "o2" },
    });
  });

  it("says that an original changed since the owner's version, from the origins the server recorded", () => {
    const origin = (hash: string) => ({ module: "guilds", template: "base", version: 1, hash });
    const files = {
      "originals/assets/textures/crest.yml": "function: menu\nwidth: 54\nheight: 18\n",
      "assets/textures/crest.yml": "width: 20\nheight: 20\n",
    };
    const binaries = {
      "originals/assets/textures/crest.png": h("o1b"),
      "assets/textures/crest.png": h("m1"),
      "originals/assets/textures/banner.png": h("o2b"),
      "assets/textures/banner.png": h("m2"),
      "originals/assets/textures/seal.png": h("o3"),
      "assets/textures/seal.png": h("m3"),
      "originals/assets/textures/flag.png": h("o4"),
      "assets/textures/flag.png": h("m4"),
    };
    const origins = {
      "assets/textures/crest.png": origin("o1"),
      "originals/assets/textures/crest.png": origin("o1b"),
      "assets/textures/banner.png": origin("o2"),
      "originals/assets/textures/banner.png": origin("o2b"),
      "assets/textures/seal.png": origin("o3"),
      "originals/assets/textures/seal.png": origin("o3"),
      // Written by hand since the last sync: no origin yet, nothing to compare.
      "originals/assets/textures/flag.png": origin("o4"),
    };
    expect(Object.fromEntries(imageMarks(files, binaries, origins))).toEqual({
      // Left out of the pack: said before its original's change.
      "assets/textures/crest": "not_taken",
      "assets/textures/banner": "original_changed",
      "assets/textures/seal": "own_version",
      "assets/textures/flag": "own_version",
    });
  });

  it("measures a menu image by its pixels when they are read, whatever its descriptor states", () => {
    const files = {
      "originals/assets/textures/crest.yml": "function: menu\nwidth: 54\nheight: 18\n",
      // Written without its size: the descriptors alone would call it taken.
      "assets/textures/crest.yml": "ramps: true\n",
      "originals/assets/textures/banner.yml": "function: menu\nwidth: 54\nheight: 18\n",
      // States another size than its pixels: the descriptors alone would call it not taken.
      "assets/textures/banner.yml": "width: 20\nheight: 20\n",
      "originals/assets/textures/seal.yml": "function: menu\nwidth: 54\nheight: 18\n",
      "assets/textures/seal.yml": "width: 20\nheight: 20\n",
    };
    const binaries = {
      "originals/assets/textures/crest.png": h("o1"),
      "assets/textures/crest.png": h("m1"),
      "originals/assets/textures/banner.png": h("o2"),
      "assets/textures/banner.png": h("m2"),
      "originals/assets/textures/seal.png": h("o3"),
      "assets/textures/seal.png": h("m3"),
    };
    expect(Object.fromEntries(imageMarks(files, binaries))).toEqual({
      "assets/textures/crest": "own_version",
      "assets/textures/banner": "not_taken",
      "assets/textures/seal": "not_taken",
    });
    const pixels: Record<string, { width: number; height: number }> = {
      "originals/assets/textures/crest.png": { width: 54, height: 18 },
      "assets/textures/crest.png": { width: 60, height: 18 },
      "originals/assets/textures/banner.png": { width: 54, height: 18 },
      "assets/textures/banner.png": { width: 54, height: 18 },
    };
    // The seal is not measured yet: its descriptors still speak for it.
    const measured = (path: string) => pixels[path];
    expect(Object.fromEntries(imageMarks(files, binaries, undefined, measured))).toEqual({
      "assets/textures/crest": "not_taken",
      "assets/textures/banner": "own_version",
      "assets/textures/seal": "not_taken",
    });
    // The panel reports the pixels it was refused at.
    expect(imageNotTaken(files, binaries, { id: "crest", type: "texture" }, measured)).toEqual({
      function: "menu",
      mine: { width: 60, height: 18, ascent: null },
      original: { width: 54, height: 18, ascent: null },
    });
    expect(imageNotTaken(files, binaries, { id: "banner", type: "texture" }, measured)).toBeNull();
    // A file that is no image is not taken, as in the pack.
    expect(
      imageMarks(files, binaries, undefined, (path) =>
        path === "assets/textures/banner.png" ? null : pixels[path],
      ).get("assets/textures/banner"),
    ).toBe("not_taken");
  });

  it("marks nothing in a module that ships no image", () => {
    expect(imageMarks({}, { "assets/textures/mine.png": h("m") }).size).toBe(0);
  });
});

describe("ownerHolds", () => {
  it("tells the owner's own file from what the module ships alone", () => {
    const paths = [
      "assets/textures/crest.png",
      "originals/assets/textures/crest.png",
      "originals/assets/textures/frame.png",
      "assets/fonts/title/font.yaml",
      "originals/assets/fonts/body/font.yaml",
    ];
    expect(ownerHolds(paths, { id: "crest", type: "texture" })).toBe(true);
    expect(ownerHolds(paths, { id: "frame", type: "texture" })).toBe(false);
    expect(ownerHolds(paths, { id: "crest", type: "glyph" })).toBe(false);
    expect(ownerHolds(paths, { id: "title", type: "font" })).toBe(true);
    expect(ownerHolds(paths, { id: "body", type: "font" })).toBe(false);
  });
});

describe("shippedUntouched", () => {
  it("names what the module ships and the owner has no file of", () => {
    const shipped = shippedUntouched(
      [
        "originals/assets/textures/panel.yml",
        "originals/assets/fonts/pixel/font.yaml",
        "originals/assets/fonts/mine/font.yaml",
        "assets/fonts/mine/font.yaml",
        // The owner's composed image of a shipped PNG's name: theirs.
        "assets/textures/card.3x2.yml",
        "menus/shop.yml",
      ],
      [
        "originals/assets/textures/button.3x1.png",
        "originals/assets/textures/panel.png",
        "originals/assets/textures/card.3x2.png",
        "originals/assets/textures/close.1x1.png",
        "originals/assets/fonts/pixel/a.png",
        "assets/textures/close.1x1.png",
        "assets/textures/blason.png",
      ],
    );
    expect([...shipped].sort()).toEqual([
      "assets/fonts/pixel",
      "assets/textures/button.3x1",
      "assets/textures/panel",
    ]);
  });
});
