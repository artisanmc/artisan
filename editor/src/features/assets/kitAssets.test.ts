import type { Asset } from "@/domain/asset";
import { KIT_SLOTS } from "@/lib/pack/kit";
import { type KitRead, type ModuleRead, useKitStore } from "@/state/kitStore";
import { renderHook } from "@testing-library/react";
import { beforeEach, describe, expect, test } from "vitest";
import { useAssetStore } from "./assetStore";
import {
  isKitBase,
  kitAssetsOf,
  kitMisfits,
  useAssetsWithKit,
  useCommonImageRef,
  useImageAsset,
  useImageReach,
} from "./kitAssets";

const read = (files: Record<string, string>, binaries: string[]): KitRead => ({
  projectId: "srv.ui-kit",
  files,
  binaries: binaries.map((path) => ({ path, hash: `h-${path}` })),
});

describe("kit images in the editor", () => {
  test("a server without a kit module has the base, each under what a menu writes", () => {
    const assets = kitAssetsOf(undefined);
    // The base's buttons keep their edges on a larger rectangle; a value box is drawn at its size.
    expect(assets.find((a) => a.id === "kit:button.3x1")?.slice).toEqual({
      left: 3,
      right: 3,
      top: 4,
      bottom: 4,
    });
    expect(assets.find((a) => a.id === "kit:value.3x1")?.slice).toBeUndefined();
    expect(assets.map((a) => a.id)).toEqual(KIT_SLOTS.map((s) => `kit:${s.id}`));
    expect(assets.every(isKitBase)).toBe(true);
    const button = assets.find((a) => a.id === "kit:button.3x1");
    expect(button).toMatchObject({ width: 54, height: 18, contentHash: "" });
    expect(button?.previewUrl).toBeTruthy();
  });

  test("the kit module's image replaces a slot at its size and at another, and adds its own", () => {
    const assets = kitAssetsOf(
      read(
        {
          "assets/textures/button.3x1.yml": "width: 54\nheight: 18\n",
          "assets/textures/close.1x1.yml": "width: 10\nheight: 10\n",
          "assets/textures/banner.yml": "width: 20\nheight: 12\n",
        },
        [
          "assets/textures/button.3x1.png",
          "assets/textures/close.1x1.png",
          "assets/textures/banner.png",
          "assets/textures/notes.txt",
          "originals/assets/textures/shipped.png",
        ],
      ),
    );
    const by = new Map(assets.map((a) => [a.id, a]));
    expect(by.get("kit:button.3x1")?.previewUrl).toContain(
      "/api/v1/projects/srv.ui-kit/binary?path=assets%2Ftextures%2Fbutton.3x1.png",
    );
    expect(by.get("kit:close.1x1")).toMatchObject({ width: 10, height: 10 });
    expect(by.get("kit:close.1x1")?.contentHash).not.toBe("");
    expect(by.get("kit:banner")).toMatchObject({ width: 20, height: 12 });
    expect(isKitBase(by.get("kit:banner")!)).toBe(false);
    expect(assets).toHaveLength(KIT_SLOTS.length + 1);
  });

  test("an image of a piece's name at another size is a misfit, with its size", () => {
    const held = read(
      {
        "assets/textures/button.3x1.yml": "width: 54\nheight: 18\n",
        "assets/textures/close.1x1.yml": "width: 10\nheight: 12\n",
        "assets/textures/banner.yml": "width: 20\nheight: 12\n",
      },
      [
        "assets/textures/button.3x1.png",
        "assets/textures/close.1x1.png",
        // No descriptor: nothing says its size, it is taken as the piece's.
        "assets/textures/cell.png",
        "assets/textures/banner.png",
      ],
    );
    expect([...kitMisfits(held)]).toEqual([["close.1x1", { width: 10, height: 12 }]]);
    expect(kitMisfits(undefined).size).toBe(0);
  });

  test("a menu names a common image by its name alone, artisan: when its module holds the name", () => {
    const common = kitAssetsOf(undefined);
    const button = common.find((a) => a.id === "kit:button.3x1") as Asset;
    const close = common.find((a) => a.id === "kit:close.1x1") as Asset;
    useAssetStore.getState().reset();
    // The module being edited holds a `close.1x1` of its own, not yet published; another
    // module's image of a name does not come before the common one.
    useAssetStore.getState().setAssets([
      { ...close, id: "close.1x1", projectId: "shop" },
      { ...button, id: "button.3x1", projectId: "guilds" },
    ]);
    useKitStore.setState({ read: { ...read({}, []), byName: true } });
    const { result, rerender } = renderHook(() => useCommonImageRef("shop"));
    expect(result.current(button)).toBe("button.3x1");
    expect(result.current(close)).toBe("artisan:close.1x1");
    // Not a common image: as it is.
    expect(result.current({ ...button, id: "gold" })).toBe("gold");
    // A server older than the theme reads `kit:<name>` only.
    useKitStore.setState({ read: read({}, []) });
    rerender();
    expect(result.current(button)).toBe("kit:button.3x1");
    useKitStore.setState({ read: undefined });
    useAssetStore.getState().reset();
  });
});

describe("the images a menu names beyond its module", () => {
  const module = (folder: string, binaries: string[], files: Record<string, string> = {}) =>
    ({
      projectId: `srv.${folder}`,
      folder,
      files,
      binaries: binaries.map((path) => ({ path, hash: `h-${path}` })),
    }) satisfies ModuleRead;
  const own = (id: string) => ({ id, projectId: "srv.core", name: id, type: "texture" }) as Asset;
  const common: KitRead = {
    ...read({}, ["assets/textures/ribbon.png", "originals/assets/textures/ornament.png"]),
    projectId: "srv.artisan",
    byName: true,
  };
  const bank = module("bank", ["assets/textures/gold.png", "originals/assets/glyphs/vault.png"], {
    "originals/assets/glyphs/vault.yml": "ascent: 9\nheight: 12\ncodepoint: 57350\n",
    "assets/textures/statement.yml": "compose:\n  layers:\n    - image: gold\n",
  });
  const guilds = module("guilds", ["assets/textures/gold.png", "assets/textures/crest.png"]);
  const core = module("core", ["assets/textures/logo.png"]);
  const theme = (
    folder: string,
    binaries: string[],
    files: Record<string, string> = {},
  ): KitRead => ({
    ...read(files, binaries),
    projectId: `srv.${folder}`,
  });
  const noel = theme(
    "noel",
    [
      "assets/textures/star.png",
      "assets/glyphs/garland.png",
      "assets/textures/logo.png",
      "overrides/artisan/ribbon.png",
      "originals/assets/textures/shipped.png",
    ],
    {
      "assets/glyphs/garland.yml": "ascent: 9\nheight: 12\ncodepoint: 57344\n",
      "assets/textures/wreath.yml": "compose:\n  layers:\n    - image: star\n",
    },
  );

  beforeEach(() => {
    useAssetStore.setState({ assets: [own("logo"), own("crest")] });
    useKitStore.setState({
      read: common,
      modules: [bank, core, guilds],
      modulesUnread: false,
      own: {},
    });
  });

  const asset = (ref: string) => renderHook(() => useImageAsset("srv.core", ref)).result.current;
  const reach = (ref: string) => renderHook(() => useImageReach("srv.core")).result.current(ref);

  test("another module's image is drawn from its published file, its own or the one it ships", () => {
    const gold = asset("bank:gold");
    expect(gold).toMatchObject({ id: "bank:gold", projectId: "srv.bank", type: "texture" });
    expect(gold?.previewUrl).toContain(
      "/api/v1/projects/srv.bank/binary?path=assets%2Ftextures%2Fgold.png&h=h-assets/textures/gold.png",
    );
    const vault = asset("bank:vault");
    expect(vault).toMatchObject({ id: "bank:vault", type: "glyph", ascent: 9, height: 12 });
    expect(vault?.previewUrl).toContain("path=originals%2Fassets%2Fglyphs%2Fvault.png");
    expect(asset("guilds:gold")?.projectId).toBe("srv.guilds");
  });

  test("a name alone is the module's own, then the common image, then the first module holding it", () => {
    expect(asset("logo")).toMatchObject({ id: "logo", projectId: "srv.core" });
    // Its own `crest`, not the one of `guilds`.
    expect(asset("crest")?.projectId).toBe("srv.core");
    expect(asset("core:logo")?.id).toBe("logo");
    expect(asset("ribbon")?.id).toBe("kit:ribbon");
    expect(asset("artisan:ribbon")?.id).toBe("kit:ribbon");
    expect(asset("gold")?.id).toBe("bank:gold");
    expect(asset("ghost")).toBeUndefined();
    // A composed image of another module has a name and no picture here.
    expect(asset("bank:statement")).toBeUndefined();
    expect(reach("bank:statement")).toEqual({ kind: "module", folder: "bank", name: "statement" });
  });

  test("what a name reaches is told by the pack's rule, and left unsaid where it is not known", () => {
    expect(reach("logo")).toEqual({ kind: "own" });
    expect(reach("ribbon")).toEqual({ kind: "common", name: "ribbon" });
    expect(reach("ornament")).toEqual({ kind: "base", name: "ornament" });
    expect(reach("gold")).toEqual({ kind: "module", folder: "bank", name: "gold" });
    expect(reach("ghost")).toEqual({ kind: "none" });
    expect(reach("{{row.icon}}")).toBeNull();
    // A module could not be read: its images may answer a name.
    useKitStore.setState({ modulesUnread: true });
    expect(reach("ghost")).toBeNull();
    // An older server: its common images are a module, a name alone is not read by this rule.
    useKitStore.setState({ read: { ...common, byName: false }, modulesUnread: false });
    expect(reach("ghost")).toBeNull();
    // Its images are drawn all the same: the module's own, the common one, another module's.
    expect(asset("logo")?.projectId).toBe("srv.core");
    expect(asset("kit:ribbon")?.id).toBe("kit:ribbon");
    expect(asset("gold")?.id).toBe("bank:gold");
  });

  test("a theme's own image is drawn from its published file, by its whole name only", () => {
    // A theme of a module's folder gives none: `guilds:<name>` is the module's.
    useKitStore.setState({
      own: { noel, guilds: theme("guilds", ["assets/textures/tinsel.png"]) },
    });
    const star = asset("noel:star");
    expect(star).toMatchObject({
      id: "noel:star",
      projectId: "srv.noel",
      type: "texture",
      qualifiedOnly: true,
    });
    expect(star?.previewUrl).toContain(
      "/api/v1/projects/srv.noel/binary?path=assets%2Ftextures%2Fstar.png&h=h-assets/textures/star.png",
    );
    expect(asset("noel:garland")).toMatchObject({ type: "glyph", ascent: 9, codepoint: 57344 });
    expect(reach("noel:star")).toEqual({ kind: "theme", folder: "noel", name: "star" });
    // The module's own `logo` does not hide the theme's, and the name alone stays the module's.
    expect(asset("noel:logo")?.projectId).toBe("srv.noel");
    expect(asset("logo")?.projectId).toBe("srv.core");
    // Never by the name alone, nor what the theme redraws, ships or composes.
    expect(asset("star")).toBeUndefined();
    expect(reach("star")).toEqual({ kind: "none" });
    for (const ref of ["noel:ribbon", "noel:shipped", "noel:wreath", "guilds:tinsel"])
      expect(asset(ref)?.projectId, ref).not.toBe("srv.noel");
    expect(reach("noel:wreath")).toEqual({ kind: "none" });
    expect(asset("guilds:tinsel")).toBeUndefined();

    const ids = renderHook(() => useAssetsWithKit()).result.current.map((a) => a.id);
    expect(ids.filter((id) => id.startsWith("noel:")).sort()).toEqual([
      "noel:garland",
      "noel:logo",
      "noel:star",
    ]);
    expect(ids).not.toContain("guilds:tinsel");
    // An older server reads no name by this rule: a theme's own image is not drawn there.
    useKitStore.setState({ read: { ...common, byName: false } });
    expect(asset("noel:star")).toBeUndefined();
  });

  test("a title looks its images up among the module's, the common ones and the other modules'", () => {
    const ids = renderHook(() => useAssetsWithKit()).result.current.map((a) => a.id);
    expect(ids.slice(0, 2)).toEqual(["logo", "crest"]);
    expect(ids).toContain("kit:ribbon");
    // The open module's published images are not listed twice; the modules come in the pack's order.
    const others = ids.filter((id) => /^(bank|guilds|core):/.test(id));
    expect([...others].sort()).toEqual(["bank:gold", "bank:vault", "guilds:crest", "guilds:gold"]);
    expect(others.map((id) => id.split(":")[0])).toEqual(["bank", "bank", "guilds", "guilds"]);
  });
});
