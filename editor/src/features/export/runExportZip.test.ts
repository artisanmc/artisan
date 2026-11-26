import type { Project } from "@/domain/types";
import { themeArchiveFiles, themeNameFromArchive } from "@/lib/pack/themeArchive";
import { mockOpenProjects } from "@/mock/fixtures";
import { afterEach, expect, it, vi } from "vitest";
import * as zip from "./buildZip";
import { folderFromZipName, normalizeProjectFiles } from "./projectZip";
import { runExportThemeZip, runExportZip } from "./runExportZip";

const read = vi.fn();
const binary = vi.fn(async (path: string) => new TextEncoder().encode(`bytes:${path}`));
vi.mock("@/lib/projectClient", () => ({ projectClient: () => ({ read, binary }) }));

afterEach(() => vi.restoreAllMocks());

it("exports an add-on's module as its root, named after its folder", async () => {
  // ArtisanDailyRewards: folder `daily`, on disk in plugins/ArtisanDailyRewards/artisan_module/.
  const project: Project = { ...mockOpenProjects().projects[0]!, diskId: "daily" };
  read.mockResolvedValue({
    ok: true,
    unchanged: false,
    files: {
      "artisan-module.yml": "schema: module/v1\ndefault_lang: fr\nlanguages: [fr]\n",
      "data/rewards.yml": "days: []\n",
    },
    binaries: [{ path: "textures/day.png", hash: "h", size: 1 }],
  });
  const files: Record<string, string | Uint8Array> = {};
  vi.spyOn(zip, "buildZip").mockImplementation(async (entries) => {
    Object.assign(files, entries);
    return new Blob();
  });
  URL.createObjectURL = vi.fn(() => "blob:x");
  URL.revokeObjectURL = vi.fn();

  const names: string[] = [];
  vi.spyOn(HTMLAnchorElement.prototype, "click").mockImplementation(function (
    this: HTMLAnchorElement,
  ) {
    names.push(this.download);
  });

  expect(await runExportZip(project, true)).toEqual({ ok: true });
  // Unzipped into plugins/ArtisanDailyRewards/artisan_module/, it is the module again.
  expect(Object.keys(files).sort()).toEqual([
    "artisan-module.yml",
    "data/rewards.yml",
    "textures/day.png",
  ]);
  expect(names).toEqual(["daily.zip"]);

  // The import of another server finds the same module back by the archive's name.
  const imported = normalizeProjectFiles(files, undefined, folderFromZipName(names[0]!));
  expect(imported.projectId).toBe("daily");
  expect(Object.keys(imported.files)).toHaveLength(3);
});

it("exports a theme as its folder, named after the theme", async () => {
  read.mockResolvedValue({
    ok: true,
    unchanged: false,
    files: { "overrides/colors.yml": 'colors: {"#3c8527": "#b3261e"}\n' },
    binaries: [{ path: "overrides/artisan/close.1x1.png", hash: "h", size: 1 }],
  });
  const files: Record<string, string | Uint8Array> = {};
  vi.spyOn(zip, "buildZip").mockImplementation(async (entries) => {
    Object.assign(files, entries);
    return new Blob();
  });
  URL.createObjectURL = vi.fn(() => "blob:x");
  URL.revokeObjectURL = vi.fn();
  const names: string[] = [];
  vi.spyOn(HTMLAnchorElement.prototype, "click").mockImplementation(function (
    this: HTMLAnchorElement,
  ) {
    names.push(this.download);
  });

  expect(await runExportThemeZip("srv.noel", "noel")).toEqual({ ok: true });
  expect(names).toEqual(["noel.theme.zip"]);
  // The import of another server reads the same theme back.
  expect(themeNameFromArchive(names[0]!)).toBe("noel");
  const archive = themeArchiveFiles(files);
  expect(archive).toMatchObject({
    files: { "overrides/colors.yml": 'colors: {"#3c8527": "#b3261e"}\n' },
  });
  expect(Object.keys((archive as { binaries: object }).binaries)).toEqual([
    "overrides/artisan/close.1x1.png",
  ]);

  // A server that does not answer exports nothing.
  read.mockResolvedValue({ ok: false, error: "server_offline" });
  expect(await runExportThemeZip("srv.noel", "noel")).toEqual({
    ok: false,
    error: "server_offline",
  });
});
