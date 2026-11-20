import type { Project } from "@/domain/types";
import { mockOpenProjects } from "@/mock/fixtures";
import { afterEach, expect, it, vi } from "vitest";
import * as zip from "./buildZip";
import { normalizeProjectFiles } from "./projectZip";
import { runExportZip } from "./runExportZip";

const read = vi.fn();
const binary = vi.fn(async (path: string) => new TextEncoder().encode(`bytes:${path}`));
vi.mock("@/lib/projectClient", () => ({ projectClient: () => ({ read, binary }) }));

afterEach(() => vi.restoreAllMocks());

it("exports an add-on's module from its own root, never under plugins/Artisan/", async () => {
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

  expect(await runExportZip(project, true)).toEqual({ ok: true });
  expect(Object.keys(files).sort()).toEqual([
    "daily/artisan-module.yml",
    "daily/data/rewards.yml",
    "daily/textures/day.png",
  ]);

  // The import of another server finds the same module back by its folder name.
  const imported = normalizeProjectFiles(files);
  expect(imported.projectId).toBe("daily");
  expect(Object.keys(imported.files)).toHaveLength(3);
});
