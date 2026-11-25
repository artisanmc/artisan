// @vitest-environment node

import { describe, expect, test } from "vitest";
import { type RgbaImage, createImage, decodePng, encodePng } from "./png";
import { readKitTheme, themeColors, themeDrawings, themeFile, themeNames } from "./theme";

const solid = (width: number, height: number, ...rgba: number[]): RgbaImage => {
  const image = createImage(width, height);
  for (let i = 0; i < image.data.length; i++) image.data[i] = rgba[i % 4] as number;
  return image;
};

const pixel = (png: Uint8Array, x: number, y: number) => {
  const image = decodePng(png);
  return [...image.data.subarray((y * image.width + x) * 4, (y * image.width + x) * 4 + 4)];
};

const kit = (files: Record<string, string>, binaries: Record<string, Uint8Array> = {}) => ({
  files: Object.entries(files).map(([path, content]) => ({ path, content })),
  binaries: Object.keys(binaries).map((path) => ({ path })),
  binary: async (path: string) => binaries[path],
});

const table = 'colors:\n  "#3c8527": "#b3261e"\n  "#B3261E": "#ffffff"\n';

const read = (
  name: string,
  files: Record<string, string>,
  binaries?: Record<string, Uint8Array>,
) => {
  const theme = readKitTheme(name, kit(files, binaries));
  if (!theme) throw new Error("no theme");
  return theme;
};

// The same cases as the hub's `ThemeTest`: the two builders read and apply a theme alike.
describe("kit themes", () => {
  test("the table keeps the pairs of colours, quoted, that change something", () => {
    const colors = themeColors(
      [
        "colors:",
        '  "#3c8527": "#b3261e"',
        "  \"#B0C88C\": '#2E7D32'",
        '  "#123456": "#123456"',
        '  nope: "#000000"',
        '  "#000001": red',
        '  "#0000020": "#000000"',
        '  "#abc": "#000000"',
        '  #f4c842: "#000000"',
        '  "#000003": 7',
        "",
      ].join("\n"),
    );
    expect([...colors]).toEqual([
      [0x3c8527, 0xb3261e],
      [0xb0c88c, 0x2e7d32],
    ]);
    expect(themeColors("colors: [a, b]\n").size).toBe(0);
    expect(themeColors("name: Noël\n").size).toBe(0);
    expect(themeColors("colors: {unclosed\n").size).toBe(0);
    // The same colour twice is a file the editor does not read either.
    expect(themeColors('colors:\n  "#000000": "#111111"\n  "#000000": "#222222"\n').size).toBe(0);
  });

  test("a theme is a folder of the kit module with a file or a redrawn image", () => {
    const files = [
      "themes/noel/theme.yml",
      "themes/noel/theme.yaml",
      "themes/empty/notes.txt",
      "themes/Bad Name/theme.yml",
      "themes/theme.yml",
      "data/ui-kit.yml",
    ];
    const binaries = [
      "themes/halloween/assets/textures/button.3x1.png",
      "themes/noel/assets/glyphs/banner.png",
      "themes/noel/assets/textures/banner.png",
      "themes/noel/assets/glyphs/star.png",
      "themes/noel/assets/textures/deep/button.3x1.png",
      "themes/noel/assets/other/button.3x1.png",
      "themes/noel/assets/textures/.png",
      "themes/noel/button.3x1.png",
      "themes/elsewhere/button.3x1.png",
    ];
    expect(themeNames(files, binaries)).toEqual(["halloween", "noel"]);
    expect(themeFile("noel", files)).toBe("themes/noel/theme.yml");
    expect(
      themeFile(
        "noel",
        files.filter((f) => f !== "themes/noel/theme.yml"),
      ),
    ).toBe("themes/noel/theme.yaml");
    expect(themeFile("halloween", files)).toBeUndefined();
    // A texture wins over a glyph of the same name; what is not right under the two folders is no image.
    expect([...themeDrawings("noel", binaries)]).toEqual([
      ["banner", "themes/noel/assets/textures/banner.png"],
      ["star", "themes/noel/assets/glyphs/star.png"],
    ]);
    expect(readKitTheme("nowhere", kit({ "themes/noel/theme.yml": table }))).toBeNull();
    expect(readKitTheme("Bad Name", kit({ "themes/Bad Name/theme.yml": table }))).toBeNull();
    expect(
      readKitTheme(
        "halloween",
        kit({}, { "themes/halloween/assets/textures/a.png": new Uint8Array([1]) }),
      ),
    ).not.toBeNull();
  });

  test("colours are replaced once, whatever the alpha above zero", async () => {
    const theme = read("noel", { "themes/noel/theme.yml": table });
    const image = createImage(4, 1);
    image.data.set([
      0x3c, 0x85, 0x27, 255, 0x3c, 0x85, 0x27, 128, 0x3c, 0x85, 0x27, 0, 0xb3, 0x26, 0x1e, 255,
    ]);
    const out = await theme.shown("button.3x1", encodePng(image));
    expect(pixel(out, 0, 0)).toEqual([0xb3, 0x26, 0x1e, 255]);
    expect(pixel(out, 1, 0)).toEqual([0xb3, 0x26, 0x1e, 128]);
    expect(pixel(out, 2, 0)).toEqual([0x3c, 0x85, 0x27, 0]);
    // What was red becomes white; what became red stays red.
    expect(pixel(out, 3, 0)).toEqual([255, 255, 255, 255]);
    // No colour of the table: the very same file, not one encoded again.
    const other = encodePng(solid(2, 2, 1, 2, 3, 255));
    expect(await theme.shown("x", other)).toBe(other);
    const broken = new Uint8Array([1, 2, 3]);
    expect(await theme.shown("x", broken)).toBe(broken);
  });

  test("an image the theme redraws at its size is taken as it is", async () => {
    const drawn = encodePng(solid(2, 2, 0x3c, 0x85, 0x27, 255));
    const small = encodePng(solid(1, 1, 9, 9, 9, 255));
    const theme = read(
      "noel",
      { "themes/noel/theme.yml": table },
      {
        "themes/noel/assets/textures/close.png": drawn,
        "themes/noel/assets/textures/back.png": small,
        "themes/noel/assets/textures/broken.png": new Uint8Array([1, 2, 3]),
      },
    );
    expect([...theme.drawings].sort()).toEqual(["back", "broken", "close"]);
    const base = encodePng(solid(2, 2, 0x3c, 0x85, 0x27, 255));
    // Its own colours are not replaced: it is drawn in the theme already.
    expect(await theme.shown("close", base)).toBe(drawn);
    expect(await theme.drawing("close", base)).toBe(drawn);
    // Another size, or unreadable: left out, the image takes the theme's colours.
    expect(await theme.drawing("back", base)).toBeNull();
    expect(pixel(await theme.shown("back", base), 0, 0)).toEqual([0xb3, 0x26, 0x1e, 255]);
    expect(await theme.drawing("broken", base)).toBeNull();
    expect(await theme.drawing("other", base)).toBeNull();
  });
});
