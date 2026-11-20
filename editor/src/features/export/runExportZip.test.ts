import type { Project } from "@/domain/types";
import { mockOpenProjects } from "@/mock/fixtures";
import { afterEach, expect, it, vi } from "vitest";
import * as zip from "./buildZip";
import { folderFromZipName, normalizeProjectFiles } from "./projectZip";
import { runExportZip } from "./runExportZip";

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
