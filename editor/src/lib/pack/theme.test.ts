// @vitest-environment node

import { describe, expect, test } from "vitest";
import { type RgbaImage, createImage, decodePng, encodePng } from "./png";
import {
  configuredThemes,
  ownThemeDrawings,
  readKitTheme,
  readKitThemes,
  readOwnTheme,
  themeChange,
  themeColors,
  themeDrawings,
  themeFile,
  themeNames,
} from "./theme";

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

  test("the themes in place are the list, the lowest first, else the former single theme", () => {
    expect(configuredThemes(null)).toEqual([]);
    expect(configuredThemes({})).toEqual([]);
    expect(configuredThemes({ "resource-pack.theme": "noel" })).toEqual(["noel"]);
    expect(configuredThemes({ "resource-pack.theme": "" })).toEqual([]);
    expect(configuredThemes({ "resource-pack.theme": "Bad Name" })).toEqual([]);
    // The list wins; a name that is not one, or said twice, is left out.
    expect(
      configuredThemes({
        "resource-pack.themes": ["noel", "Bad Name", 3, "nuit", "noel"],
        "resource-pack.theme": "paques",
      }),
    ).toEqual(["noel", "nuit"]);
    // An empty list leaves the former key its say: a config that was never rewritten.
    expect(
      configuredThemes({ "resource-pack.themes": [], "resource-pack.theme": "paques" }),
    ).toEqual(["paques"]);
    expect(configuredThemes({ "resource-pack.themes": "noel" })).toEqual([]);
  });

  test("a theme is put on top of the ones in place, or taken off", () => {
    expect(themeChange(["a", "b"], true, "c", true)).toEqual({
      "resource-pack.themes": ["a", "b", "c"],
    });
    // Put again: it goes to the top.
    expect(themeChange(["a", "b"], true, "a", true)).toEqual({
      "resource-pack.themes": ["b", "a"],
    });
    expect(themeChange(["a", "b"], true, "a", false)).toEqual({ "resource-pack.themes": ["b"] });
    // A server older than the list holds one theme.
    expect(themeChange(["a"], false, "b", true)).toEqual({ "resource-pack.theme": "b" });
    expect(themeChange(["a"], false, "a", false)).toEqual({ "resource-pack.theme": "" });
  });

  test("themes in place stack: each changes what the ones below show", async () => {
    const green = encodePng(solid(2, 2, 0x3c, 0x85, 0x27, 255));
    const drawn = encodePng(solid(2, 2, 0xb3, 0x26, 0x1e, 255));
    const top = encodePng(solid(2, 2, 7, 7, 7, 255));
    const files = {
      // `noel`: green to red, and its own `close`, in red.
      "themes/noel/theme.yml": 'colors:\n  "#3c8527": "#b3261e"\n',
      // `nuit`: red to black, colours alone.
      "themes/nuit/theme.yml": 'colors:\n  "#b3261e": "#000000"\n',
    };
    const binaries = {
      "themes/noel/assets/textures/close.png": drawn,
      "themes/haut/assets/textures/close.png": top,
    };
    const stack = (...names: string[]) => readKitThemes(names, kit(files, binaries));
    expect(stack()).toBeNull();
    expect(stack("nowhere")).toBeNull();
    // One theme: the theme itself.
    expect(pixel(await stack("noel")!.shown("x", green), 0, 0)).toEqual([0xb3, 0x26, 0x1e, 255]);
    // `nuit` above `noel` repaints what `noel` shows; under it, it finds no red yet.
    expect(pixel(await stack("noel", "nuit")!.shown("x", green), 0, 0)).toEqual([0, 0, 0, 255]);
    expect(pixel(await stack("nuit", "noel")!.shown("x", green), 0, 0)).toEqual([
      0xb3, 0x26, 0x1e, 255,
    ]);
    // A theme the module does not hold is left out of the stack.
    expect(pixel(await stack("noel", "nowhere", "nuit")!.shown("x", green), 0, 0)).toEqual([
      0, 0, 0, 255,
    ]);
    // The highest theme that draws the image wins, as it is.
    expect(await stack("noel", "haut")!.shown("close", green)).toBe(top);
    expect(await stack("noel", "haut")!.drawing("close", green)).toBe(top);
    expect(await stack("haut", "noel")!.drawing("close", green)).toBe(drawn);
    // Colours above a drawing repaint it, in `shown` and in `drawing` alike.
    expect(pixel(await stack("noel", "nuit")!.shown("close", green), 0, 0)).toEqual([0, 0, 0, 255]);
    expect(pixel((await stack("noel", "nuit")!.drawing("close", green))!, 0, 0)).toEqual([
      0, 0, 0, 255,
    ]);
    // Colours are no drawing.
    expect(await stack("noel", "nuit")!.drawing("x", green)).toBeNull();
    expect(await stack("nuit")!.drawing("close", green)).toBeNull();
  });

  test("a theme of its own folder holds its table and its redraws of the common images", async () => {
    const green = encodePng(solid(2, 2, 0x3c, 0x85, 0x27, 255));
    const drawn = encodePng(solid(2, 2, 9, 9, 9, 255));
    const binaries = {
      "overrides/artisan/close.png": drawn,
      "overrides/artisan/deep/close.png": drawn,
      "overrides/artisan/.png": drawn,
      "overrides/artisan/notes.txt": drawn,
      "overrides/guilds/banner.png": drawn,
      "overrides/close.png": drawn,
      "assets/textures/close.png": drawn,
    };
    expect([...ownThemeDrawings(Object.keys(binaries))]).toEqual([
      ["close", "overrides/artisan/close.png"],
    ]);
    const theme = readOwnTheme(
      kit(
        {
          "overrides/colors.yml": table,
          // `.yml` before `.yaml`; a file elsewhere is not the table.
          "overrides/colors.yaml": 'colors:\n  "#3c8527": "#0000ff"\n',
          "colors.yml": 'colors:\n  "#3c8527": "#00ff00"\n',
        },
        binaries,
      ),
    );
    expect(pixel(await theme.shown("x", green), 0, 0)).toEqual([0xb3, 0x26, 0x1e, 255]);
    expect(await theme.shown("close", green)).toBe(drawn);
    expect([...theme.drawings]).toEqual(["close"]);
    // `.yaml` alone is read; a folder that holds neither changes nothing.
    const yaml = readOwnTheme(kit({ "overrides/colors.yaml": table }));
    expect(pixel(await yaml.shown("x", green), 0, 0)).toEqual([0xb3, 0x26, 0x1e, 255]);
    expect(await readOwnTheme(kit({})).shown("x", green)).toBe(green);
  });

  test("a theme in place is the Project of its name, else the folder the common images keep", async () => {
    const green = encodePng(solid(2, 2, 0x3c, 0x85, 0x27, 255));
    const common = kit({
      "themes/noel/theme.yml": 'colors:\n  "#3c8527": "#00ffff"\n',
      "themes/nuit/theme.yml": 'colors:\n  "#b3261e": "#000000"\n',
    });
    const own = new Map([["noel", kit({ "overrides/colors.yml": table })]]);
    // `noel` is read from its own folder, `nuit` where the common images keep it.
    const look = readKitThemes(["noel", "nuit", "nowhere"], common, own)!;
    expect(pixel(await look.shown("x", green), 0, 0)).toEqual([0, 0, 0, 255]);
    // Without the common images' Project, the themes of their own folder are still read.
    expect(
      pixel(await readKitThemes(["noel", "nuit"], undefined, own)!.shown("x", green), 0, 0),
    ).toEqual([0xb3, 0x26, 0x1e, 255]);
    expect(readKitThemes(["nuit"], undefined, own)).toBeNull();
    expect(readKitThemes(["Bad Name"], common, new Map([["Bad Name", kit({})]]))).toBeNull();
  });
});
