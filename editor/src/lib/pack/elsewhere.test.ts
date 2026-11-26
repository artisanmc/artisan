// @vitest-environment node

import { parse } from "yaml";
import { describe, expect, it } from "vitest";
import {
  EXPORT_NOTE_SCHEMA,
  type ElsewhereWhere,
  type ExportNote,
  codepointsOf,
  commonCopy,
  commonHolders,
  embedNames,
  emptyNote,
  exportNoteYaml,
  fontNamesIn,
  fontRefsWritten,
  imageCopy,
  imageRefsWritten,
  isWrittenName,
  menuImageRefs,
  namedElsewhere,
  reachOf,
  readExportNote,
  renameImageRefs,
  settleCopies,
  themeOwnNames,
} from "./elsewhere";

const MENU = `
size: 27
title:
  - { kind: background, asset: frame }
  - { kind: glyph, asset: "artisan:blason", y: 4 }
elements:
  - id: close
    positions: 0
    image: { asset: close.1x1 }
  - id: crest
    positions: 1
    image: { asset: "guilds:crest" }
`;

const where = (over: Partial<ElsewhereWhere> = {}): ElsewhereWhere => ({
  folder: "shop",
  own: (name) => name === "logo",
  base: (name) => name === "close.1x1",
  common: (name) => name === "blason" || name === "frame",
  modules: [
    { folder: "guilds", own: (name) => name === "crest" || name === "banner" },
    { folder: "warps", own: (name) => name === "banner" },
  ],
  ...over,
});

describe("imageRefsWritten", () => {
  it("reads what the pack reads: title layers, image buttons, what kinds ask for, composed layers", () => {
    const refs = imageRefsWritten(
      {
        files: [
          { path: "menus/main.yml", content: MENU },
          { path: "lang/fr.yml", content: "title: frame\n" },
          {
            path: "assets/textures/panel.yml",
            content:
              "width: 32\nheight: 16\ncompose:\n  - { use: kit:ribbon }\n  - { image: logo }\n",
          },
        ],
        binaries: [{ path: "assets/textures/logo.png", hash: "h", size: 1 }],
      },
      [{ asset: "portrait" }],
    );
    expect(refs.sort()).toEqual(
      [
        "artisan:blason",
        "close.1x1",
        "frame",
        "guilds:crest",
        "kit:ribbon",
        "logo",
        "portrait",
      ].sort(),
    );
  });
});

describe("namedElsewhere", () => {
  it("tells the base, the server's common images and the other modules apart", () => {
    expect(
      namedElsewhere(
        ["logo", "close.1x1", "frame", "artisan:blason", "guilds:crest", "shop:logo", "nothing"],
        where(),
      ),
    ).toEqual({
      base: ["close.1x1"],
      common: ["frame"],
      asCommon: ["blason"],
      modules: { guilds: ["crest"] },
      themes: {},
    });
  });

  it("reads a name alone as the module's own first, then the common image, then the first module holding it", () => {
    // The module's own image hides the common one of that name.
    expect(namedElsewhere(["frame"], where({ own: (name) => name === "frame" }))).toEqual({
      base: [],
      common: [],
      asCommon: [],
      modules: {},
      themes: {},
    });
    expect(namedElsewhere(["banner"], where()).modules).toEqual({ guilds: ["banner"] });
  });

  it("falls on the name alone when the module named does not hold the image", () => {
    expect(namedElsewhere(["guilds:frame", "gone:close.1x1"], where())).toEqual({
      base: ["close.1x1"],
      common: ["frame"],
      asCommon: [],
      modules: {},
      themes: {},
    });
  });

  it("keeps the server's version of a base image as the base: the look is the server's", () => {
    const named = namedElsewhere(
      ["close.1x1", "kit:close.1x1"],
      where({ common: (name) => name === "close.1x1" }),
    );
    expect(named).toEqual({
      base: ["close.1x1"],
      common: [],
      asCommon: [],
      modules: {},
      themes: {},
    });
  });
});

describe("a theme's own image", () => {
  const themed = where({
    themes: [
      { folder: "noel", own: (name) => name === "star" || name === "logo" },
      // A theme of a module's folder gives none: `guilds:<name>` is the module's.
      { folder: "guilds", own: (name) => name === "tinsel" },
    ],
  });

  it("is reached by `<theme>:<name>`, and never by its name alone", () => {
    expect(reachOf("noel:star", themed)).toEqual({ kind: "theme", folder: "noel", name: "star" });
    expect(reachOf("star", themed)).toEqual({ kind: "none" });
    // The module's own image of that name does not hide the theme's.
    expect(reachOf("noel:logo", themed)).toEqual({ kind: "theme", folder: "noel", name: "logo" });
    expect(reachOf("logo", themed)).toEqual({ kind: "own" });
  });

  it("falls on the name alone when the theme does not hold it, like a module's", () => {
    expect(reachOf("noel:ghost", themed)).toEqual({ kind: "none" });
    expect(reachOf("noel:frame", themed)).toEqual({ kind: "common", name: "frame" });
    expect(reachOf("guilds:tinsel", themed)).toEqual({ kind: "none" });
    expect(reachOf("guilds:crest", themed)).toEqual({
      kind: "module",
      folder: "guilds",
      name: "crest",
    });
    // Where the themes are not known, no name reaches one.
    expect(reachOf("noel:star", where())).toEqual({ kind: "none" });
  });

  it("is named by its theme in what the module names elsewhere", () => {
    expect(namedElsewhere(["noel:star", "noel:logo", "frame", "star"], themed)).toEqual({
      base: [],
      common: ["frame"],
      asCommon: [],
      modules: {},
      themes: { noel: ["logo", "star"] },
    });
  });

  it("is a PNG under assets/: neither a composed image, a font, nor an original", () => {
    const binary = (path: string) => ({ path, hash: path, size: 1 });
    const names = themeOwnNames({
      files: [
        { path: "overrides/colors.yml", content: "colors: {}\n" },
        { path: "assets/glyphs/garland.yml", content: "codepoint: 57344\nascent: 9\n" },
        { path: "assets/textures/wreath.yml", content: "compose:\n  layers:\n    - image: star\n" },
      ],
      binaries: [
        binary("assets/textures/star.png"),
        binary("assets/glyphs/garland.png"),
        binary("originals/assets/textures/shipped.png"),
        binary("overrides/artisan/panel.png"),
        binary("overrides/guilds/crest.png"),
      ],
    });
    expect([...names].sort()).toEqual(["garland", "star"]);
  });
});

describe("commonHolders", () => {
  it("tells the base (the editor's list and what the server ships) from what the server added", () => {
    const held = commonHolders([
      "originals/assets/textures/ornament.png",
      "assets/textures/ribbon.png",
      "assets/textures/window.yml",
      "assets/fonts/title/font.yml",
      "data/ui-kit.yml",
    ]);
    expect(["button.3x1", "ornament", "ribbon"].map(held.base)).toEqual([true, true, false]);
    expect(["ribbon", "window", "title", "ornament", "ui-kit"].map(held.common)).toEqual([
      true,
      true,
      true,
      false,
      false,
    ]);
  });
});

describe("isWrittenName", () => {
  it("is a name the pack can look up: a placeholder is filled in game", () => {
    expect(["gold", "guilds:gold", "button.3x1", "a-b_c"].every(isWrittenName)).toBe(true);
    expect(["", "{{row.icon}}", "%rank%", "<icon>", "a b"].some(isWrittenName)).toBe(false);
  });
});

describe("commonCopy", () => {
  const common = {
    files: [
      { path: "assets/textures/frame.yml", content: "usages: [title]\nramps: true\n" },
      { path: "assets/glyphs/blason.yml", content: "ascent: 9\ncodepoint: 57344\n" },
      { path: "assets/textures/panel.yml", content: "compose:\n  - { use: kit:frame }\n" },
    ],
    binaries: [
      { path: "assets/textures/frame.png", hash: "a", size: 1 },
      { path: "assets/glyphs/blason.png", hash: "b", size: 1 },
      { path: "originals/assets/textures/close.1x1.png", hash: "c", size: 1 },
    ],
  };

  it("takes the PNG and its descriptor as they are", () => {
    expect(commonCopy("frame", common, new Set())).toEqual({
      name: "frame",
      from: "assets/textures/frame.png",
      to: "assets/textures/frame.png",
      descriptor: {
        path: "assets/textures/frame.yml",
        content: "usages:\n  - title\nramps: true\n",
      },
    });
  });

  it("gives a glyph a codepoint free in the module and among the copies already made", () => {
    const used = codepointsOf({
      files: [{ path: "assets/glyphs/coin.yml", content: "codepoint: 57344\n" }],
      binaries: [{ path: "assets/glyphs/coin.png", hash: "x", size: 1 }],
    });
    const copy = commonCopy("blason", common, used);
    expect(parse(copy!.descriptor!.content)).toEqual({ ascent: 9, codepoint: 57345 });
    expect(used.has(57345)).toBe(true);
  });

  it("copies neither a composed image nor a base image the server did not redraw", () => {
    expect(commonCopy("panel", common, new Set())).toBeNull();
    expect(commonCopy("close.1x1", common, new Set())).toBeNull();
  });
});

describe("the archive's note", () => {
  const note: ExportNote = {
    artisan: "1.4.0",
    base: ["close.1x1"],
    common: ["frame"],
    requires: { common: ["blason"], modules: { guilds: ["crest"] } },
  };

  it("is read back as it was written", () => {
    const text = exportNoteYaml(note);
    expect(parse(text).schema).toBe(EXPORT_NOTE_SCHEMA);
    expect(readExportNote(text)).toEqual(note);
  });

  it("says the fonts the module does not hold, and nothing of fonts when it names none", () => {
    const written: ExportNote = {
      artisan: null,
      base: [],
      common: [],
      requires: { common: [], modules: {}, fonts: ["pixel", "runes"] },
    };
    expect(emptyNote(written)).toBe(false);
    const text = exportNoteYaml(written);
    expect(parse(text)).toEqual({
      schema: EXPORT_NOTE_SCHEMA,
      requires: { fonts: ["pixel", "runes"] },
    });
    expect(readExportNote(text)).toEqual(written);
    expect(readExportNote(exportNoteYaml(note))?.requires).not.toHaveProperty("fonts");
    // Text from elsewhere: a name that is no font's name is left out.
    expect(
      readExportNote(`schema: ${EXPORT_NOTE_SCHEMA}\nrequires:\n  fonts: ["../x", pixel, 3]\n`)
        ?.requires.fonts,
    ).toEqual(["pixel"]);
  });

  it("reads the fonts a module's titles write in, and the fonts a Project holds", () => {
    const files = [
      { path: "artisan-module.yml", content: "schema: module/v1\n" },
      {
        path: "menus/a.yml",
        content:
          "size: 27\ntitle:\n  - { kind: text, value: A, font: pixel }\n  - { kind: textarea, value: B, font_asset_id: runes }\n  - { kind: text, value: C }\n  - { kind: glyph, asset: coin, font: nope }\n  - { kind: text, value: D, font: '{font}' }\n",
      },
    ];
    expect(fontRefsWritten(files)).toEqual(["pixel", "runes"]);
    expect([
      ...fontNamesIn([
        "assets/fonts/pixel/font.yml",
        "assets/fonts/pixel/glyph_0.png",
        "originals/assets/fonts/runes.yml",
        "assets/textures/fonts.png",
      ]),
    ]).toEqual(["pixel", "runes"]);
  });

  it("says the themes' own images by theme, and nothing of themes when it names none", () => {
    const themed: ExportNote = {
      artisan: null,
      base: [],
      common: [],
      requires: { common: [], modules: {}, themes: { noel: ["garland", "star"] } },
    };
    expect(emptyNote(themed)).toBe(false);
    const text = exportNoteYaml(themed);
    expect(parse(text)).toEqual({
      schema: EXPORT_NOTE_SCHEMA,
      requires: { themes: { noel: ["garland", "star"] } },
    });
    expect(readExportNote(text)).toEqual(themed);
    // A note written before them, or with none, has no `themes`.
    expect(readExportNote(exportNoteYaml(note))?.requires).not.toHaveProperty("themes");
    expect(
      readExportNote(
        `schema: ${EXPORT_NOTE_SCHEMA}\nrequires:\n  themes:\n    "../x": [a]\n    noel: ["a/b", star]\n    empty: []\n`,
      )?.requires.themes,
    ).toEqual({ noel: ["star"] });
  });

  it("writes only what it has to say", () => {
    const text = exportNoteYaml({
      artisan: "1.4.0",
      base: [],
      common: ["frame"],
      requires: { common: [], modules: {} },
    });
    expect(parse(text)).toEqual({ schema: EXPORT_NOTE_SCHEMA, common: ["frame"] });
    expect(emptyNote(note)).toBe(false);
    expect(
      emptyNote({ artisan: "1.4.0", base: [], common: [], requires: { common: [], modules: {} } }),
    ).toBe(true);
  });

  it("is text from elsewhere: a name that is no image's name is left out", () => {
    expect(readExportNote("schema: other/v1\n")).toBeNull();
    expect(readExportNote(": : :")).toBeNull();
    expect(
      readExportNote(
        `schema: ${EXPORT_NOTE_SCHEMA}\ncommon: ["../../config", frame, 3]\nrequires:\n  modules:\n    "../x": [a]\n    guilds: ["a/b", crest]\n`,
      ),
    ).toEqual({
      artisan: null,
      base: [],
      common: ["frame"],
      requires: { common: [], modules: { guilds: ["crest"] } },
    });
  });
});

describe("settleCopies", () => {
  const note: ExportNote = {
    artisan: null,
    base: [],
    common: ["blason", "frame", "ribbon", "gone"],
    requires: { common: [], modules: {} },
  };
  const binaries = {
    "assets/textures/frame.png": { hash: "same" },
    "assets/glyphs/blason.png": { hash: "origin" },
    "assets/textures/ribbon.png": { hash: "r" },
    "assets/textures/logo.png": { hash: "l" },
  };
  const files = ["assets/textures/frame.yml", "assets/glyphs/blason.yml", "menus/main.yml"];

  it("drops a copy the server has the same image for, and keeps the others in the module", () => {
    const hashes: Record<string, string> = { frame: "same", blason: "another" };
    expect(settleCopies(note, binaries, files, (name) => hashes[name] ?? null)).toEqual({
      dropped: [
        { name: "frame", paths: ["assets/textures/frame.png", "assets/textures/frame.yml"] },
      ],
      kept: ["blason", "ribbon"],
    });
  });
});

describe("embedding another module's images", () => {
  it("reads the names the module's own menus write, not what it ships", () => {
    expect(
      menuImageRefs([
        { path: "menus/main.yml", content: MENU },
        {
          path: "originals/menus/top.yml",
          content: "size: 9\ntitle: { kind: background, asset: shipped }\n",
        },
      ]).sort(),
    ).toEqual(["artisan:blason", "close.1x1", "frame", "guilds:crest"]);
  });

  it("copies a module's image under the name it takes, what the module ships included", () => {
    const source = {
      files: [{ path: "originals/assets/textures/crest.yml", content: "ramps: true\n" }],
      binaries: [{ path: "originals/assets/textures/crest.png", hash: "c", size: 1 }],
    };
    expect(imageCopy("crest", source, new Set(), { shipped: true, as: "crest_2" })).toEqual({
      name: "crest_2",
      from: "originals/assets/textures/crest.png",
      to: "assets/textures/crest_2.png",
      descriptor: { path: "assets/textures/crest_2.yml", content: "ramps: true\n" },
    });
    expect(imageCopy("crest", source, new Set())).toBeNull();
  });

  it("keeps the name of an image a name alone reaches, and finds a free one for the others", () => {
    const free = (name: string) => name !== "logo" && name !== "frame";
    expect(
      embedNames(
        [
          { folder: "guilds", name: "logo", refs: ["guilds:logo"] },
          { folder: "warps", name: "pin", refs: ["warps:pin"] },
          { folder: "guilds", name: "pin", refs: ["pin", "guilds:pin"] },
          { folder: "guilds", name: "crest", refs: ["guilds:crest"] },
        ],
        free,
      ).map((image) => `${image.folder}:${image.name}=${image.as}`),
    ).toEqual(["guilds:pin=pin", "guilds:logo=logo_2", "warps:pin=pin_2", "guilds:crest=crest"]);
  });

  it("rewrites the names where a menu names an image, and nothing else", () => {
    const renames = new Map([
      ["guilds:crest", "crest"],
      ["warps:pin", "pin_2"],
    ]);
    const text = [
      "title:",
      '  - { kind: glyph, asset: "guilds:crest", y: 4 }',
      "  - kind: background",
      "    asset_id: warps:pin # the map",
      "elements:",
      "  - image: { asset: guilds:crest }",
      "    source: guilds:crest",
      "    name: 'warps:pin'",
      "    image_asset: warps:pin",
      "  - image: { asset: guilds:crest_big, fit: native }",
      "  - image:",
      "      asset: 'warps:pin'",
      "",
    ].join("\n");
    expect(renameImageRefs(text, renames)).toBe(
      [
        "title:",
        '  - { kind: glyph, asset: "crest", y: 4 }',
        "  - kind: background",
        "    asset_id: pin_2 # the map",
        "elements:",
        "  - image: { asset: crest }",
        "    source: guilds:crest",
        "    name: 'warps:pin'",
        "    image_asset: warps:pin",
        "  - image: { asset: guilds:crest_big, fit: native }",
        "  - image:",
        "      asset: 'pin_2'",
        "",
      ].join("\n"),
    );
  });
});
