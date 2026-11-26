import { reachOf } from "@/lib/pack/elsewhere";
import { useKitStore } from "@/state/kitStore";
import { beforeEach, describe, expect, test } from "vitest";
import { imageHolders } from "./imageHolders";
import type { ServerProjectsResult } from "./serverIndexLoader";
import { useServerIndexStore } from "./serverIndexStore";

type Read = NonNullable<ServerProjectsResult["reads"]>[number];

const read = (
  folder: string,
  paths: string[],
  summary: Record<string, unknown> = {},
  files: Record<string, string> = {},
): Read =>
  ({
    summary: { id: `srv.${folder}`, externalId: folder, name: folder, ...summary },
    files,
    binaries: paths.map((path) => ({ path, hash: path, size: 1 })),
  }) as unknown as Read;

function serverHolds(reads: Read[]) {
  useServerIndexStore.getState().begin("srv");
  useServerIndexStore.getState().finish("srv", {
    status: "ready",
    projects: [],
    failed: [],
    reads,
  } as unknown as ServerProjectsResult);
}

const common = read(
  "artisan",
  ["assets/textures/ribbon.png", "originals/assets/textures/panel.png"],
  { role: "theme" },
);
const edited = { id: "srv.core", diskId: "core" };

describe("imageHolders", () => {
  beforeEach(() => {
    useServerIndexStore.getState().reset();
    useKitStore.setState({ read: undefined, own: {} });
  });

  test("the module's own images are its draft's: one it adds is held, one it deletes is not", () => {
    serverHolds([common, read("core", ["assets/textures/old.png", "assets/glyphs/kept.png"])]);
    const where = imageHolders(edited, {
      files: ["menus/main.yml", "assets/textures/composed.yml"],
      binaries: ["assets/glyphs/kept.png", "assets/textures/added.png"],
    })!;
    expect(where.folder).toBe("core");
    expect(["kept", "added", "composed", "old"].map(where.own)).toEqual([true, true, true, false]);
  });

  test("a draft that changed no image holds the published ones", () => {
    serverHolds([common, read("core", ["assets/textures/old.png"])]);
    const where = imageHolders(edited, { files: ["menus/main.yml"] })!;
    expect(where.own("old")).toBe(true);
    // A module never deployed holds what its draft does, and nothing else.
    expect(imageHolders({ id: "srv.new" }, { files: [] })!.own("old")).toBe(false);
  });

  test("the base is the editor's and what the server ships, the common images the ones it added", () => {
    serverHolds([common]);
    const where = imageHolders(edited, { files: [] })!;
    expect(where.base("panel")).toBe(true);
    expect(where.base("ribbon")).toBe(false);
    expect(where.common("ribbon")).toBe(true);
    expect(where.common("panel")).toBe(false);
    expect(reachOf("artisan:ribbon", where)).toEqual({ kind: "asCommon", name: "ribbon" });
  });

  test("the other modules, in the pack's order, without the themes nor the module itself", () => {
    serverHolds([
      read("warps", ["assets/textures/shared.png"]),
      common,
      read("noel", ["assets/textures/shared.png"], { role: "theme" }),
      read("jobs", ["assets/textures/shared.png", "originals/assets/glyphs/anvil.png"]),
      read("core", ["assets/textures/shared_core.png"]),
    ]);
    const where = imageHolders(edited, { files: [] })!;
    expect(where.modules.map((m) => m.folder)).toEqual(["jobs", "warps"]);
    expect(reachOf("shared", where)).toEqual({ kind: "module", folder: "jobs", name: "shared" });
    expect(reachOf("anvil", where)).toEqual({ kind: "module", folder: "jobs", name: "anvil" });
    expect(reachOf("ghost", where)).toEqual({ kind: "none" });
  });

  test("a theme's own images are its PNGs under assets/, reached by `<theme>:<name>`", () => {
    serverHolds([
      common,
      read(
        "noel",
        ["assets/textures/star.png", "overrides/artisan/panel.png"],
        { role: "theme" },
        { "assets/textures/wreath.yml": "compose:\n  layers:\n    - image: star\n" },
      ),
      // A theme of a module's folder gives none.
      read("jobs", ["assets/textures/anvil.png"]),
      read("jobs-theme", ["assets/textures/tinsel.png"], { role: "theme", externalId: "jobs" }),
    ]);
    const where = imageHolders(edited, { files: [] })!;
    expect(where.themes?.map((t) => t.folder).sort()).toEqual(["jobs", "noel"]);
    expect(reachOf("noel:star", where)).toEqual({ kind: "theme", folder: "noel", name: "star" });
    expect(reachOf("star", where)).toEqual({ kind: "none" });
    expect(reachOf("noel:panel", where)).toEqual({ kind: "base", name: "panel" });
    expect(reachOf("noel:wreath", where)).toEqual({ kind: "none" });
    expect(reachOf("jobs:tinsel", where)).toEqual({ kind: "none" });
  });

  test("no answer on a server whose common images are not the theme artisan, or not read yet", () => {
    expect(imageHolders(edited, { files: [] })).toBeNull();
    // An older server: its common images are the module `ui-kit`, read as `kit:<name>` only.
    serverHolds([read("ui-kit", ["assets/textures/ribbon.png"])]);
    expect(imageHolders(edited, { files: [] })).toBeNull();
    // One with no common images at all.
    serverHolds([read("jobs", ["assets/textures/anvil.png"])]);
    expect(imageHolders(edited, { files: [] })).toBeNull();
  });
});
