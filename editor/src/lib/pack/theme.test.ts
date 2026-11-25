// @vitest-environment node

import { describe, expect, test } from "vitest";
import { type RgbaImage, createImage, decodePng, encodePng } from "./png";
import {
  configuredThemes,
  ownThemeDrawings,
  ownThemeModuleDrawings,
  readKitTheme,
  readKitThemes,
  readOwnTheme,
  themeChange,
  themeColors,
  themeColorsText,
  themeDrawings,
  themeFile,
  themeNames,
  themeScope,
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
    const out = await theme.shown("button.3x1", encodePng(image), true);
    expect(pixel(out, 0, 0)).toEqual([0xb3, 0x26, 0x1e, 255]);
    expect(pixel(out, 1, 0)).toEqual([0xb3, 0x26, 0x1e, 128]);
    expect(pixel(out, 2, 0)).toEqual([0x3c, 0x85, 0x27, 0]);
    // What was red becomes white; what became red stays red.
    expect(pixel(out, 3, 0)).toEqual([255, 255, 255, 255]);
    // No colour of the table: the very same file, not one encoded again.
    const other = encodePng(solid(2, 2, 1, 2, 3, 255));
    expect(await theme.shown("x", other, true)).toBe(other);
    const broken = new Uint8Array([1, 2, 3]);
    expect(await theme.shown("x", broken, true)).toBe(broken);
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
    expect(await theme.shown("close", base, true)).toBe(drawn);
    expect(await theme.drawing("close", base)).toBe(drawn);
    // Another size, or unreadable: left out, the image takes the theme's colours.
    expect(await theme.drawing("back", base)).toBeNull();
    expect(pixel(await theme.shown("back", base, true), 0, 0)).toEqual([0xb3, 0x26, 0x1e, 255]);
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
    expect(pixel(await stack("noel")!.shown("x", green, true), 0, 0)).toEqual([
      0xb3, 0x26, 0x1e, 255,
    ]);
    // `nuit` above `noel` repaints what `noel` shows; under it, it finds no red yet.
    expect(pixel(await stack("noel", "nuit")!.shown("x", green, true), 0, 0)).toEqual([
      0, 0, 0, 255,
    ]);
    expect(pixel(await stack("nuit", "noel")!.shown("x", green, true), 0, 0)).toEqual([
      0xb3, 0x26, 0x1e, 255,
    ]);
    // A theme the module does not hold is left out of the stack.
    expect(pixel(await stack("noel", "nowhere", "nuit")!.shown("x", green, true), 0, 0)).toEqual([
      0, 0, 0, 255,
    ]);
    // The highest theme that draws the image wins, as it is.
    expect(await stack("noel", "haut")!.shown("close", green, true)).toBe(top);
    expect(await stack("noel", "haut")!.drawing("close", green, true)).toBe(top);
    expect(await stack("haut", "noel")!.drawing("close", green, true)).toBe(drawn);
    // Colours above a drawing repaint it, in `shown` and in `drawing` alike.
    expect(pixel(await stack("noel", "nuit")!.shown("close", green, true), 0, 0)).toEqual([
      0, 0, 0, 255,
    ]);
    expect(pixel((await stack("noel", "nuit")!.drawing("close", green, true))!, 0, 0)).toEqual([
      0, 0, 0, 255,
    ]);
    // Colours are no drawing.
    expect(await stack("noel", "nuit")!.drawing("x", green, true)).toBeNull();
    expect(await stack("nuit")!.drawing("close", green, true)).toBeNull();
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
    expect(pixel(await theme.shown("x", green, true), 0, 0)).toEqual([0xb3, 0x26, 0x1e, 255]);
    expect(await theme.shown("close", green, true)).toBe(drawn);
    expect([...theme.drawings]).toEqual(["close"]);
    // `.yaml` alone is read; a folder that holds neither changes nothing.
    const yaml = readOwnTheme(kit({ "overrides/colors.yaml": table }));
    expect(pixel(await yaml.shown("x", green, true), 0, 0)).toEqual([0xb3, 0x26, 0x1e, 255]);
    expect(await readOwnTheme(kit({})).shown("x", green, true)).toBe(green);
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
    expect(pixel(await look.shown("x", green, true), 0, 0)).toEqual([0, 0, 0, 255]);
    // Without the common images' Project, the themes of their own folder are still read.
    expect(
      pixel(await readKitThemes(["noel", "nuit"], undefined, own)!.shown("x", green, true), 0, 0),
    ).toEqual([0xb3, 0x26, 0x1e, 255]);
    expect(readKitThemes(["nuit"], undefined, own)).toBeNull();
    expect(readKitThemes(["Bad Name"], common, new Map([["Bad Name", kit({})]]))).toBeNull();
  });

  test("a theme redraws a module's image at its size, and the highest in place wins as drawn", async () => {
    const image = encodePng(solid(2, 2, 0x3c, 0x85, 0x27, 255));
    const low = encodePng(solid(2, 2, 1, 1, 1, 255));
    const high = encodePng(solid(2, 2, 2, 2, 2, 255));
    const large = encodePng(solid(3, 2, 3, 3, 3, 255));
    const paths = [
      "overrides/guilds/banner.png",
      "overrides/Shop_2/coin.png",
      "overrides/artisan/close.png",
      "overrides/guilds/deep/banner.png",
      "overrides/guilds/.png",
      "overrides/guilds/notes.txt",
      "overrides/banner.png",
      "assets/textures/banner.png",
    ];
    expect([...ownThemeModuleDrawings(paths)]).toEqual([
      ["Shop_2:coin", "overrides/Shop_2/coin.png"],
      ["guilds:banner", "overrides/guilds/banner.png"],
    ]);
    const noel = kit(
      { "overrides/colors.yml": table },
      { "overrides/guilds/banner.png": low, "overrides/guilds/wide.png": large },
    );
    const theme = readOwnTheme(noel);
    expect([...theme.moduleDrawings]).toEqual(["guilds:banner", "guilds:wide"]);
    expect(await theme.moduleDrawing("guilds", "banner", image)).toBe(low);
    // Another module's image of that name, an image it does not redraw, and a drawing of another size are left.
    expect(await theme.moduleDrawing("shop", "banner", image)).toBeNull();
    expect(await theme.moduleDrawing("guilds", "coin", image)).toBeNull();
    expect(await theme.moduleDrawing("guilds", "wide", image)).toBeNull();
    expect(await theme.moduleDrawing("guilds", "x", image)).toBeNull();
    // In a stack the highest that redraws it wins; one that does not gives way to the one below.
    // The image does not follow the ramps: no colour touches it, drawn or not.
    const own = new Map([
      ["noel", noel],
      ["hiver", kit({}, { "overrides/guilds/banner.png": high })],
      ["nuit", kit({ "overrides/colors.yml": 'colors:\n  "#010101": "#ffffff"\n' })],
    ]);
    const stack = (names: string[]) => readKitThemes(names, undefined, own)!;
    expect(await stack(["noel", "hiver"]).moduleShown("guilds", "banner", image, false)).toBe(high);
    expect(await stack(["hiver", "noel"]).moduleShown("guilds", "banner", image, false)).toBe(low);
    expect(await stack(["noel", "nuit"]).moduleShown("guilds", "banner", image, false)).toBe(low);
    expect(await stack(["nuit", "hiver"]).moduleShown("shop", "banner", image, false)).toBe(image);
    expect(await stack(["noel"]).moduleShown("guilds", "x", image, false)).toBe(image);
    // A theme the common images keep redraws no module's image.
    const former = readKitThemes(
      ["old"],
      kit({ "themes/old/theme.yml": table }, { "themes/old/overrides/guilds/banner.png": low }),
    )!;
    expect(await former.moduleShown("guilds", "banner", image, false)).toBe(image);
  });

  test("colours repaint an image that follows the ramps, and no other", async () => {
    const green = encodePng(solid(2, 2, 0x3c, 0x85, 0x27, 255));
    const drawn = encodePng(solid(2, 2, 0xb3, 0x26, 0x1e, 255));
    const RED = [0xb3, 0x26, 0x1e, 255];
    const own = new Map([
      // `noel`: green to red, and its own `close` and `guilds:banner`, in red.
      [
        "noel",
        kit(
          { "overrides/colors.yml": table },
          { "overrides/artisan/close.png": drawn, "overrides/guilds/banner.png": drawn },
        ),
      ],
      // `nuit`: red to black, colours alone.
      ["nuit", kit({ "overrides/colors.yml": 'colors:\n  "#b3261e": "#000000"\n' })],
    ]);
    const stack = (...names: string[]) => readKitThemes(names, undefined, own)!;
    // A common image that does not follow the ramps keeps its colours; a theme's drawing of it is taken as drawn.
    expect(await stack("noel").shown("x", green, false)).toBe(green);
    expect(await stack("noel", "nuit").shown("x", green, false)).toBe(green);
    expect(await stack("noel", "nuit").shown("close", green, false)).toBe(drawn);
    expect(await stack("noel", "nuit").drawing("close", green, false)).toBe(drawn);
    expect(await stack("nuit").drawing("close", green, false)).toBeNull();
    // A module's image that follows the ramps takes each theme in turn, like a common one.
    expect(pixel(await stack("noel").moduleShown("shop", "coin", green, true), 0, 0)).toEqual(RED);
    expect(
      pixel(await stack("noel", "nuit").moduleShown("shop", "coin", green, true), 0, 0),
    ).toEqual([0, 0, 0, 255]);
    expect(await stack("noel").moduleShown("guilds", "banner", green, true)).toBe(drawn);
    expect(
      pixel(await stack("noel", "nuit").moduleShown("guilds", "banner", green, true), 0, 0),
    ).toEqual([0, 0, 0, 255]);
    // One that does not is drawn or left.
    expect(await stack("noel", "nuit").moduleShown("shop", "coin", green, false)).toBe(green);
    expect(await stack("noel", "nuit").moduleShown("guilds", "banner", green, false)).toBe(drawn);
  });

  test("a theme's scope keeps its colours to one module's images", async () => {
    const green = encodePng(solid(2, 2, 0x3c, 0x85, 0x27, 255));
    const RED = [0xb3, 0x26, 0x1e, 255];
    expect(themeScope("scope: guilds\n")).toBe("guilds");
    expect(themeScope(`scope: guilds\n${table}`)).toBe("guilds");
    expect(themeScope(table)).toBeNull();
    // Anything but a name is no scope: the colours reach every image that follows the ramps.
    expect(themeScope("scope: 3\n")).toBeNull();
    expect(themeScope('scope: ""\n')).toBeNull();
    expect(themeScope("scope: [guilds]\n")).toBeNull();
    expect(themeScope(": : :")).toBeNull();
    const scoped = (scope: string) =>
      readOwnTheme(kit({ "overrides/colors.yml": `scope: ${scope}\n${table}` }));
    const guilds = scoped("guilds");
    expect(guilds.scope).toBe("guilds");
    expect(pixel(await guilds.moduleShown("guilds", "banner", green, true), 0, 0)).toEqual(RED);
    expect(await guilds.moduleShown("shop", "coin", green, true)).toBe(green);
    expect(await guilds.shown("button.3x1", green, true)).toBe(green);
    // `artisan`: the common images alone.
    const common = scoped("artisan");
    expect(pixel(await common.shown("button.3x1", green, true), 0, 0)).toEqual(RED);
    expect(await common.moduleShown("guilds", "banner", green, true)).toBe(green);
    // In a stack, a theme of one module sits beside another: each paints what it reaches.
    const own = new Map([
      ["guilds-noel", kit({ "overrides/colors.yml": `scope: guilds\n${table}` })],
      ["nuit", kit({ "overrides/colors.yml": 'colors:\n  "#3c8527": "#000000"\n' })],
      // Draws `close`, which the scoped theme above it leaves as drawn.
      ["dessin", kit({}, { "overrides/artisan/close.png": green })],
    ]);
    const stack = (...names: string[]) => readKitThemes(names, undefined, own)!;
    expect(
      pixel(await stack("guilds-noel", "nuit").moduleShown("guilds", "banner", green, true), 0, 0),
    ).toEqual(RED);
    expect(
      pixel(await stack("guilds-noel", "nuit").moduleShown("shop", "coin", green, true), 0, 0),
    ).toEqual([0, 0, 0, 255]);
    expect(await stack("dessin", "guilds-noel").shown("close", green, true)).toBe(green);
    expect(await stack("dessin", "guilds-noel").drawing("close", green, true)).toBe(green);
    // A theme the common images keep reads its scope from its file too.
    const former = readKitTheme("old", kit({ "themes/old/theme.yml": `scope: guilds\n${table}` }))!;
    expect(await former.shown("button.3x1", green, true)).toBe(green);
  });
  test("a theme's file is written with another table, its other keys and comments kept", () => {
    const table = new Map([
      [0x3c8527, 0xb3261e],
      [0x1e5214, 0x000000],
    ]);
    const written = 'colors:\n  "#3c8527": "#b3261e"\n  "#1e5214": "#000000"\n';
    expect(themeColorsText(undefined, table)).toBe(written);
    expect(themeColors(written)).toEqual(table);
    expect(
      themeColorsText('# note\nscope: guilds # only\ncolors:\n  "#a02824": "#102030"\n', table),
    ).toBe(`# note\nscope: guilds # only\n${written}`);
    // No colour left: the key goes, and a file with nothing else has nothing to write.
    expect(themeColorsText('scope: guilds\ncolors: {"#a02824": "#102030"}\n', new Map())).toBe(
      "scope: guilds\n",
    );
    expect(themeColorsText('colors: {"#a02824": "#102030"}\n', new Map())).toBeNull();
    expect(themeColorsText(undefined, new Map())).toBeNull();
    // A file that cannot be read, or that is not a map, is written anew.
    expect(themeColorsText("colors: [", table)).toBe(written);
    expect(themeColorsText("- a\n", table)).toBe(written);
  });

  test("a theme is tried with another table: its drawings and its scope stay", async () => {
    const drawn = encodePng(solid(1, 1, 9, 9, 9, 255));
    const green = encodePng(solid(1, 1, 0x3c, 0x85, 0x27, 255));
    const theme = readOwnTheme({
      files: [
        {
          path: "overrides/colors.yml",
          content: 'scope: artisan\ncolors: {"#3c8527": "#b3261e"}\n',
        },
      ],
      binaries: [{ path: "overrides/artisan/close.png" }],
      binary: () => drawn,
    });
    const tried = theme.withColors(new Map([[0x3c8527, 0x010203]]));
    expect([...decodePng(await tried.shown("cell", green, true)).data.slice(0, 3)]).toEqual([
      1, 2, 3,
    ]);
    expect(await tried.shown("close", green, true)).toBe(drawn);
    expect(tried.scope).toBe("artisan");
    expect(await tried.moduleShown("guilds", "x", green, true)).toBe(green);
    // The theme itself keeps its table.
    expect(theme.colors.get(0x3c8527)).toBe(0xb3261e);
  });
});
