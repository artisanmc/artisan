import type { ImageUse } from "@/lib/pack/kit";
import { describe, expect, it } from "vitest";
import { newThemeProblem, saveAsEffect, saveAsNameProblem, saveAsPlaces } from "./saveAsPlaces";

const read = (projectId: string, ...paths: string[]) => ({
  projectId,
  files: {},
  binaries: paths.map((path) => ({ path, hash: "h" })),
});
const kit = {
  read: read("kit", "assets/glyphs/close.1x1.png"),
  own: {
    noel: read("t-noel", "assets/textures/button.3x1.png"),
    ete: read("t-ete"),
    vieux: read("t-vieux"),
  },
  modules: [{ ...read("shop", "assets/textures/banner.png"), folder: "boutique" }],
  // The lowest first.
  themes: ["ete", "noel"],
};
const use = (projectId: string, menuId: string): ImageUse => ({
  projectId,
  projectName: projectId,
  menuId,
});

describe("saveAsPlaces", () => {
  it("lists the places in the order they are looked in, then the themes put away and the modules", () => {
    const places = saveAsPlaces(kit);
    expect(places.map((p) => `${p.kind}:${p.name}:${p.inPlace}`)).toEqual([
      "theme:noel:true",
      "theme:ete:true",
      "server::true",
      "theme:vieux:false",
      "module:boutique:true",
    ]);
    expect([...(places[0]?.holds ?? [])]).toEqual(["button.3x1"]);
  });
});

describe("saveAsNameProblem", () => {
  it("lets a theme hold a name of the base, a module a plain name only", () => {
    expect(saveAsNameProblem("banner", "module")).toBeNull();
    expect(saveAsNameProblem("button.3x1", "theme")).toBeNull();
    expect(saveAsNameProblem("button.3x1", "new")).toBeNull();
    expect(saveAsNameProblem("button.3x1", "module")).toBe("base_name_in_module");
    expect(saveAsNameProblem("Big Banner", "theme")).toBe("invalid_name");
  });
});

describe("newThemeProblem", () => {
  it("refuses a name that is no theme's, the common images' and one already taken", () => {
    expect(newThemeProblem("hiver", ["noel"])).toBeNull();
    expect(newThemeProblem("noel", ["noel"])).toBe("project_exists");
    expect(newThemeProblem("artisan", [])).toBe("invalid_name");
    expect(newThemeProblem("Hiver !", [])).toBe("invalid_name");
  });
});

describe("saveAsEffect", () => {
  const uses = new Map<string, ImageUse[]>([
    [
      "artisan:button.3x1",
      [
        use("shop", "main"),
        use("shop", "cart"),
        use("guilds", "home"),
        { ...use("shop", ""), by: { kind: "image", name: "composed" } },
      ],
    ],
  ]);
  const [noel, , , vieux, boutique] = saveAsPlaces(kit);

  it("counts the menus of every module that take the image saved in a theme", () => {
    expect(saveAsEffect("button.3x1", noel ?? null, uses)).toEqual({
      kind: "replaces",
      menus: 3,
      modules: 2,
      away: false,
      overwrites: true,
    });
  });

  it("says a theme put away or about to be created changes nothing yet", () => {
    expect(saveAsEffect("button.3x1", vieux ?? null, uses)).toMatchObject({
      menus: 3,
      away: true,
      overwrites: false,
    });
    expect(saveAsEffect("button.3x1", null, uses).away).toBe(true);
  });

  it("counts the module's own menus alone for an image saved in a module", () => {
    expect(saveAsEffect("button.3x1", boutique ?? null, uses)).toMatchObject({
      kind: "replaces",
      menus: 2,
      modules: 1,
    });
    expect(saveAsEffect("banner", boutique ?? null, uses)).toMatchObject({
      kind: "added",
      menus: 0,
      overwrites: true,
    });
  });
});
