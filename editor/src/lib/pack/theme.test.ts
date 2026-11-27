// @vitest-environment node

import { describe, expect, test } from "vitest";
import { type RgbaImage, createImage, encodePng } from "./png";
import {
  configuredThemes,
  kitThemeStack,
  ownThemeDrawings,
  readKitTheme,
  readKitThemes,
  readOwnTheme,
  themeChange,
  themeDrawings,
  themeNames,
  themeModuleDrawingPath,
  themeModuleDrawings,
  themeUnread,
  themesMoved,
  themesRenamed,
} from "./theme";

const solid = (width: number, height: number, ...rgba: number[]): RgbaImage => {
  const image = createImage(width, height);
  for (let i = 0; i < image.data.length; i++) image.data[i] = rgba[i % 4] as number;
  return image;
};

const kit = (files: Record<string, string>, binaries: Record<string, Uint8Array> = {}) => ({
  files: Object.entries(files).map(([path, content]) => ({ path, content })),
  binaries: Object.keys(binaries).map((path) => ({ path })),
  binary: async (path: string) => binaries[path],
});

const table = 'colors:\n  "#3c8527": "#b3261e"\n';

// The same cases as the hub's `ThemeTest`: the two builders read and apply a theme alike.
describe("kit themes", () => {
  test("a theme is a folder of the kit module with a redrawn image", () => {
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
      "themes/Bad Name/assets/textures/a.png",
    ];
    expect(themeNames(binaries)).toEqual(["halloween", "noel"]);
    // A texture wins over a glyph of the same name; what is not right under the two folders is no image.
    expect([...themeDrawings("noel", binaries)]).toEqual([
      ["banner", "themes/noel/assets/textures/banner.png"],
      ["star", "themes/noel/assets/glyphs/star.png"],
    ]);
    // A table of colours is no theme: a theme changes an image by holding an image.
    expect(readKitTheme("noel", kit({ "themes/noel/theme.yml": table }))).toBeNull();
    expect(
      readKitTheme(
        "Bad Name",
        kit({}, { "themes/Bad Name/assets/textures/a.png": new Uint8Array([1]) }),
      ),
    ).toBeNull();
    expect(
      readKitTheme(
        "halloween",
        kit({}, { "themes/halloween/assets/textures/a.png": new Uint8Array([1]) }),
      ),
    ).not.toBeNull();
  });

  test("an image the theme redraws at its size is taken as it is", async () => {
    const drawn = encodePng(solid(2, 2, 0x3c, 0x85, 0x27, 255));
    const small = encodePng(solid(1, 1, 9, 9, 9, 255));
    const theme = readKitTheme(
      "noel",
      kit(
        {},
        {
          "themes/noel/assets/textures/close.png": drawn,
          "themes/noel/assets/textures/back.png": small,
          "themes/noel/assets/textures/broken.png": new Uint8Array([1, 2, 3]),
        },
      ),
    );
    if (!theme) throw new Error("no theme");
    expect([...theme.drawings].sort()).toEqual(["back", "broken", "close"]);
    const base = encodePng(solid(2, 2, 0x3c, 0x85, 0x27, 255));
    expect(await theme.shown("close", base)).toBe(drawn);
    expect(await theme.drawing("close")).toBe(drawn);
    // Another size is taken as it is; an unreadable file is left out, the image stays the very same file.
    expect(await theme.drawing("back")).toBe(small);
    expect(await theme.shown("back", base)).toBe(small);
    expect(await theme.drawing("broken")).toBeNull();
    expect(await theme.shown("broken", base)).toBe(base);
    expect(await theme.drawing("other")).toBeNull();
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

  test("themes in place stack: the highest that draws an image wins", async () => {
    const green = encodePng(solid(2, 2, 0x3c, 0x85, 0x27, 255));
    const drawn = encodePng(solid(2, 2, 0xb3, 0x26, 0x1e, 255));
    const top = encodePng(solid(2, 2, 7, 7, 7, 255));
    const binaries = {
      "themes/noel/assets/textures/close.png": drawn,
      "themes/haut/assets/textures/close.png": top,
    };
    const stack = (...names: string[]) => readKitThemes(names, kit({}, binaries));
    expect(stack()).toBeNull();
    expect(stack("nowhere")).toBeNull();
    expect(await stack("noel")!.shown("x", green)).toBe(green);
    expect(await stack("noel")!.drawing("x")).toBeNull();
    expect(await stack("noel", "haut")!.shown("close", green)).toBe(top);
    expect(await stack("noel", "haut")!.drawing("close")).toBe(top);
    expect(await stack("haut", "noel")!.drawing("close")).toBe(drawn);
    // A theme the module does not hold is left out of the stack.
    expect(await stack("noel", "nowhere")!.shown("close", green)).toBe(drawn);
  });

  test("a theme of its own folder holds images under names, in assets/ or the former overrides/artisan/", async () => {
    const green = encodePng(solid(2, 2, 0x3c, 0x85, 0x27, 255));
    const drawn = encodePng(solid(2, 2, 9, 9, 9, 255));
    const paths = [
      "overrides/artisan/close.png",
      "overrides/artisan/deep/close.png",
      "overrides/artisan/.png",
      "overrides/artisan/notes.txt",
      "overrides/guilds/banner.png",
      "overrides/close.png",
      "assets/glyphs/star.png",
      "assets/textures/star.png",
      "assets/textures/deep/star.png",
    ];
    const binaries = Object.fromEntries(paths.map((path) => [path, drawn]));
    // An image under `assets/` is the theme's image of that name, a texture before a glyph.
    expect([...ownThemeDrawings(paths)]).toEqual([
      ["close", "overrides/artisan/close.png"],
      ["star", "assets/textures/star.png"],
    ]);
    // It wins over the former place of a redraw.
    expect([
      ...ownThemeDrawings(["overrides/artisan/close.png", "assets/glyphs/close.png"]),
    ]).toEqual([["close", "assets/glyphs/close.png"]]);
    // The table of colours a theme once held repaints nothing.
    const theme = readOwnTheme(kit({ "overrides/colors.yml": table }, binaries));
    expect(await theme.shown("x", green)).toBe(green);
    expect(await theme.shown("close", green)).toBe(drawn);
    // Its redraw aimed at a module is no drawing of the common image of that name.
    expect(await theme.shown("banner", green)).toBe(green);
    expect(theme.drawings).toEqual(["close", "star"]);
    expect(await readOwnTheme(kit({})).shown("x", green)).toBe(green);
    // What it holds that is no longer read is named, for the editor to say.
    expect(
      themeUnread(["overrides/colors.yml", "overrides/guilds/deep/banner.png", ...paths]),
    ).toEqual(["overrides/close.png", "overrides/colors.yml", "overrides/guilds/deep/banner.png"]);
    // Its image filed under a module replaces that module's image of the name, and no other's.
    expect([...themeModuleDrawings(paths)].map(([m, images]) => [m, [...images]])).toEqual([
      ["guilds", [["banner", "overrides/guilds/banner.png"]]],
    ]);
    expect(themeModuleDrawingPath("guilds", "banner")).toBe("overrides/guilds/banner.png");
    expect(await theme.shownIn("guilds", "banner", green)).toBe(drawn);
    expect(await theme.shownIn("shop", "banner", green)).toBe(green);
    expect(await theme.shownIn("guilds", "close", green)).toBe(green);
    const stack = kitThemeStack([readOwnTheme(kit({})), theme, readOwnTheme(kit({}))]);
    expect(await stack?.shownIn("guilds", "banner", green)).toBe(drawn);
    expect(await stack?.shownIn("shop", "banner", green)).toBe(green);
  });

  test("a theme in place is the Project of its name, else the folder the common images keep", async () => {
    const green = encodePng(solid(2, 2, 0x3c, 0x85, 0x27, 255));
    const former = encodePng(solid(2, 2, 1, 1, 1, 255));
    const own = encodePng(solid(2, 2, 2, 2, 2, 255));
    const night = encodePng(solid(2, 2, 3, 3, 3, 255));
    const common = kit(
      {},
      {
        "themes/noel/assets/textures/close.png": former,
        "themes/nuit/assets/textures/back.png": night,
      },
    );
    const themes = new Map([["noel", kit({}, { "overrides/artisan/close.png": own })]]);
    // `noel` is read from its own folder, `nuit` where the common images keep it.
    const stack = readKitThemes(["noel", "nuit", "nowhere"], common, themes)!;
    expect(await stack.shown("close", green)).toBe(own);
    expect(await stack.shown("back", green)).toBe(night);
    // Without the common images' Project, the themes of their own folder are still read.
    expect(await readKitThemes(["noel", "nuit"], undefined, themes)!.shown("close", green)).toBe(
      own,
    );
    expect(readKitThemes(["nuit"], undefined, themes)).toBeNull();
    expect(readKitThemes(["Bad Name"], common, new Map([["Bad Name", kit({})]]))).toBeNull();
  });

  test("a theme moved on the screen, the highest first, gives the server's order, the lowest first", () => {
    const inPlace = ["hiver", "noel", "nuit"];
    // Shown as nuit, noel, hiver: the last one dragged to the top is now the highest.
    expect(themesMoved(inPlace, 2, 0)).toEqual(["noel", "nuit", "hiver"]);
    expect(themesMoved(inPlace, 0, 1)).toEqual(["hiver", "nuit", "noel"]);
    expect(themesMoved(inPlace, 1, 1)).toEqual(inPlace);
    expect(themesMoved(inPlace, 0, 5)).toEqual(inPlace);
    expect(themesMoved([], 0, 0)).toEqual([]);
  });

  test("a theme renamed keeps its place among the themes in place", () => {
    expect(themesRenamed(["hiver", "noel", "nuit"], "noel", "fetes")).toEqual([
      "hiver",
      "fetes",
      "nuit",
    ]);
    // Not in place: nothing is to write.
    expect(themesRenamed(["hiver"], "noel", "fetes")).toBeNull();
  });
});
