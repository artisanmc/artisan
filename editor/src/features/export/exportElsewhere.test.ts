import type { Project } from "@/domain/types";
import { readExportNote } from "@/lib/pack/elsewhere";
import { mockOpenProjects } from "@/mock/fixtures";
import { beforeEach, expect, it, vi } from "vitest";
import { parse } from "yaml";
import { ExportGivenUp, exportElsewhere } from "./exportElsewhere";

const mocks = vi.hoisted(() => ({
  read: vi.fn(),
  binary: vi.fn(),
  listServerProjects: vi.fn(),
  listServers: vi.fn(),
}));
vi.mock("@/lib/projectClient", () => ({
  projectClient: (id: string) => ({
    read: () => mocks.read(id),
    binary: (path: string) => mocks.binary(id, path),
  }),
}));
vi.mock("@/lib/api/projectFiles", () => ({ listServerProjects: mocks.listServerProjects }));
vi.mock("@/lib/api/servers", () => ({ listServers: mocks.listServers }));

const project: Project = {
  ...mockOpenProjects().projects[0]!,
  id: "proj_shop" as Project["id"],
  diskId: "shop",
  serverKeyId: "sk1",
};

const menu = (assets: string[]) =>
  `size: 27\nelements:\n${assets
    .map((asset, i) => `  - id: b${i}\n    positions: ${i}\n    image: { asset: "${asset}" }\n`)
    .join("")}`;

const disk = (assets: string[]) => ({
  files: {
    "artisan-module.yml": "schema: module/v1\n",
    "menus/main.yml": menu(assets),
    "assets/glyphs/coin.yml": "codepoint: 57344\n",
  },
  binaries: [{ path: "assets/glyphs/coin.png", hash: "c", size: 1 }],
});

const trees: Record<string, { files: Record<string, string>; binaries: object[] }> = {
  proj_kit: {
    files: {
      "assets/textures/frame.yml": "ramps: true\n",
      "assets/glyphs/blason.yml": "ascent: 9\ncodepoint: 57344\n",
      "assets/textures/panel.yml": "compose:\n  - { use: kit:frame }\n",
    },
    binaries: [
      { path: "assets/textures/frame.png", hash: "f", size: 1 },
      { path: "assets/glyphs/blason.png", hash: "b", size: 1 },
      { path: "originals/assets/textures/medal.1x1.png", hash: "m", size: 1 },
    ],
  },
  proj_guilds: {
    files: {},
    binaries: [{ path: "assets/textures/crest.png", hash: "x", size: 1 }],
  },
};

beforeEach(() => {
  vi.clearAllMocks();
  mocks.read.mockImplementation(async (id: string) =>
    trees[id] ? { ok: true, unchanged: false, ...trees[id] } : { ok: false, error: "read_error" },
  );
  mocks.binary.mockImplementation(async (id: string, path: string) =>
    new TextEncoder().encode(`${id}:${path}`),
  );
  mocks.listServerProjects.mockResolvedValue({
    ok: true,
    projectIds: ["artisan", "guilds", "shop"],
    projects: [
      { id: "proj_kit", externalId: "artisan", name: "artisan", role: "theme" },
      { id: "proj_guilds", externalId: "guilds", name: "guilds" },
      { id: "proj_shop", externalId: "shop", name: "shop" },
    ],
  });
  mocks.listServers.mockResolvedValue([{ id: "sk1", pluginVersion: "1.4.0" }]);
});

it("asks the server nothing for a module that names its own images only", async () => {
  expect(await exportElsewhere(project, disk(["coin"]))).toBeNull();
  expect(mocks.listServerProjects).not.toHaveBeenCalled();
});

it("copies the server's common images a name alone reaches, and notes the rest", async () => {
  const out = await exportElsewhere(
    project,
    disk(["coin", "frame", "blason", "medal.1x1", "artisan:frame", "panel", "guilds:crest"]),
  );
  expect(out?.copied).toEqual(["blason", "frame"]);
  expect(Object.keys(out!.files).sort()).toEqual([
    "artisan-export.yml",
    "assets/glyphs/blason.png",
    "assets/glyphs/blason.yml",
    "assets/textures/frame.png",
    "assets/textures/frame.yml",
  ]);
  expect(new TextDecoder().decode(out!.files["assets/textures/frame.png"] as Uint8Array)).toBe(
    "proj_kit:assets/textures/frame.png",
  );
  // The copied glyph stays out of the module's own codepoints.
  expect(parse(out!.files["assets/glyphs/blason.yml"] as string)).toEqual({
    ascent: 9,
    codepoint: 57345,
  });
  expect(readExportNote(out!.files["artisan-export.yml"] as string)).toEqual({
    artisan: "1.4.0",
    base: ["medal.1x1"],
    common: ["blason", "frame"],
    // `artisan:frame` is answered by a common image only; a composed image is not one PNG.
    requires: { common: ["frame", "panel"], modules: { guilds: ["crest"] } },
  });
  // Only the module a name qualifies is read.
  expect(mocks.read.mock.calls.map(([id]) => id)).toEqual(["proj_kit", "proj_guilds"]);
});

it("notes a base image without copying anything", async () => {
  const out = await exportElsewhere(project, disk(["close.1x1"]));
  expect(out?.copied).toEqual([]);
  expect(Object.keys(out!.files)).toEqual(["artisan-export.yml"]);
  expect(parse(out!.files["artisan-export.yml"] as string)).toEqual({
    schema: "export/v1",
    artisan: "1.4.0",
    base: ["close.1x1"],
  });
});

it("finds the module a name alone reaches when the common images do not have it", async () => {
  const out = await exportElsewhere(project, disk(["crest"]));
  expect(readExportNote(out!.files["artisan-export.yml"] as string)?.requires.modules).toEqual({
    guilds: ["crest"],
  });
});

it("notes a theme's own image by its theme, and reads only the theme a name qualifies", async () => {
  trees.proj_noel = {
    files: { "assets/textures/wreath.yml": "compose:\n  layers:\n    - image: star\n" },
    binaries: [
      { path: "assets/textures/star.png", hash: "s", size: 1 },
      { path: "overrides/artisan/frame.png", hash: "o", size: 1 },
    ],
  };
  trees.proj_ete = {
    files: {},
    binaries: [{ path: "assets/textures/sun.png", hash: "u", size: 1 }],
  };
  mocks.listServerProjects.mockResolvedValue({
    ok: true,
    projectIds: ["artisan", "guilds", "shop", "noel", "ete"],
    projects: [
      { id: "proj_kit", externalId: "artisan", name: "artisan", role: "theme" },
      { id: "proj_guilds", externalId: "guilds", name: "guilds" },
      { id: "proj_shop", externalId: "shop", name: "shop" },
      { id: "proj_noel", externalId: "noel", name: "noel", role: "theme" },
      { id: "proj_ete", externalId: "ete", name: "ete", role: "theme" },
    ],
  });
  const ask = vi.fn();
  // `star` alone reaches nothing; a composed image of a theme is not its own image.
  const out = await exportElsewhere(project, disk(["noel:star", "star", "noel:wreath"]), ask);
  expect(out?.copied).toEqual([]);
  expect(out?.embedded).toEqual([]);
  expect(parse(out!.files["artisan-export.yml"] as string)).toEqual({
    schema: "export/v1",
    requires: { themes: { noel: ["star"] } },
  });
  // A theme's image is a dependency: nothing is asked, nothing embedded.
  expect(ask).not.toHaveBeenCalled();
  // The modules are read for `star` alone, which may be one's image; of the themes, only `noel`.
  expect(mocks.read.mock.calls.map(([id]) => id)).toEqual(["proj_kit", "proj_guilds", "proj_noel"]);
});

it("rejects when the server cannot be read, and says nothing for a name that reaches no image", async () => {
  expect(await exportElsewhere(project, disk(["nothing"]))).toBeNull();
  mocks.listServerProjects.mockResolvedValue({ ok: false, error: "server_offline" });
  await expect(exportElsewhere(project, disk(["frame"]))).rejects.toThrow("server_offline");
});

it("embeds the images of other modules on request, named as the module's own in the archive's menus", async () => {
  trees.proj_warps = {
    files: { "assets/glyphs/pin.yml": "ascent: 7\ncodepoint: 57344\n" },
    binaries: [
      { path: "assets/glyphs/pin.png", hash: "p", size: 1 },
      // The module holds an image named `coin`, as the one exported does.
      { path: "assets/textures/coin.png", hash: "k", size: 1 },
    ],
  };
  mocks.listServerProjects.mockResolvedValue({
    ok: true,
    projectIds: ["artisan", "daily", "guilds", "shop", "warps"],
    projects: [
      { id: "proj_kit", externalId: "artisan", name: "artisan", role: "theme" },
      // An add-on's module: installed with its add-on, never embedded.
      { id: "proj_guilds", externalId: "guilds", name: "guilds", ownerModule: "guilds" },
      { id: "proj_shop", externalId: "shop", name: "shop" },
      { id: "proj_warps", externalId: "warps", name: "warps" },
    ],
  });
  const module = disk(["coin", "guilds:crest", "warps:pin", "warps:coin", "pin"]);
  const ask = vi.fn(async () => true);

  const out = await exportElsewhere(project, module, ask);
  expect(ask).toHaveBeenCalledWith(["warps:coin", "warps:pin"]);
  expect(out?.embedded.sort()).toEqual(["warps:coin", "warps:pin"]);
  // `pin` keeps its name (a name alone reaches it); `coin` is the module's own already.
  expect(Object.keys(out!.files).sort()).toEqual([
    "artisan-export.yml",
    "assets/glyphs/pin.png",
    "assets/glyphs/pin.yml",
    "assets/textures/coin_2.png",
  ]);
  expect(parse(out!.files["assets/glyphs/pin.yml"] as string)).toEqual({
    ascent: 7,
    codepoint: 57345,
  });
  expect(out!.rewritten["menus/main.yml"]).toBe(
    menu(["coin", "guilds:crest", "pin", "coin_2", "pin"]),
  );
  // The add-on's image stays a dependency.
  expect(readExportNote(out!.files["artisan-export.yml"] as string)?.requires.modules).toEqual({
    guilds: ["crest"],
  });

  // Declined: nothing is copied, nothing rewritten, the archive notes them.
  const without = await exportElsewhere(project, module, async () => false);
  expect(without?.embedded).toEqual([]);
  expect(without?.rewritten).toEqual({});
  expect(readExportNote(without!.files["artisan-export.yml"] as string)?.requires.modules).toEqual({
    guilds: ["crest"],
    warps: ["coin", "pin"],
  });

  await expect(exportElsewhere(project, module, async () => null)).rejects.toBeInstanceOf(
    ExportGivenUp,
  );
  Reflect.deleteProperty(trees, "proj_warps");
});

it("gives an archive with no note when everything named elsewhere was embedded", async () => {
  mocks.listServerProjects.mockResolvedValue({
    ok: true,
    projectIds: ["guilds", "shop"],
    projects: [
      { id: "proj_guilds", externalId: "guilds", name: "guilds" },
      { id: "proj_shop", externalId: "shop", name: "shop" },
    ],
  });
  const out = await exportElsewhere(project, disk(["guilds:crest"]), async () => true);
  expect(Object.keys(out!.files)).toEqual(["assets/textures/crest.png"]);
  expect(out!.rewritten["menus/main.yml"]).toBe(menu(["crest"]));
});
