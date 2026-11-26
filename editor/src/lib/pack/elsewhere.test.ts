// @vitest-environment node

import { parse } from "yaml";
import { describe, expect, it } from "vitest";
import {
  EXPORT_NOTE_SCHEMA,
  type ElsewhereWhere,
  type ExportNote,
  codepointsOf,
  commonCopy,
  emptyNote,
  exportNoteYaml,
  imageRefsWritten,
  namedElsewhere,
  readExportNote,
  settleCopies,
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
    });
  });

  it("reads a name alone as the module's own first, then the common image, then the first module holding it", () => {
    // The module's own image hides the common one of that name.
    expect(namedElsewhere(["frame"], where({ own: (name) => name === "frame" }))).toEqual({
      base: [],
      common: [],
      asCommon: [],
      modules: {},
    });
    expect(namedElsewhere(["banner"], where()).modules).toEqual({ guilds: ["banner"] });
  });

  it("falls on the name alone when the module named does not hold the image", () => {
    expect(namedElsewhere(["guilds:frame", "gone:close.1x1"], where())).toEqual({
      base: ["close.1x1"],
      common: ["frame"],
      asCommon: [],
      modules: {},
    });
  });

  it("keeps the server's version of a base image as the base: the look is the server's", () => {
    const named = namedElsewhere(
      ["close.1x1", "kit:close.1x1"],
      where({ common: (name) => name === "close.1x1" }),
    );
    expect(named).toEqual({ base: ["close.1x1"], common: [], asCommon: [], modules: {} });
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
