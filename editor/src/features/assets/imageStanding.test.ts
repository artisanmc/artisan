import { describe, expect, it } from "vitest";
import { imageMarks, imageNotTaken } from "./imageStanding";

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

  it("marks nothing in a module that ships no image", () => {
    expect(imageMarks({}, { "assets/textures/mine.png": h("m") }).size).toBe(0);
  });
});
