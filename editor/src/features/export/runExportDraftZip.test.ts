import * as drafts from "@/lib/api/projectDrafts";
import { mockAccount } from "@/mock/fixtures";
import { useProjectBaselineStore } from "@/state/projectBaselineStore";
import { useProjectDraftStore } from "@/state/projectDraftStore";
import { afterEach, expect, it, vi } from "vitest";
import * as zip from "./buildZip";
import { runExportDraftZip } from "./runExportZip";

const binary = vi.fn(async (path: string) => new TextEncoder().encode(`published:${path}`));
vi.mock("@/lib/projectClient", () => ({ projectClient: () => ({ binary }) }));

afterEach(() => vi.restoreAllMocks());

it("exports the current draft: unchanged images from the server, changed ones from the draft", async () => {
  const project = mockAccount().projects[0]!;
  const files: Record<string, string | Uint8Array> = {};
  vi.spyOn(zip, "buildZip").mockImplementation(async (entries) => {
    Object.assign(files, entries);
    return new Blob();
  });
  vi.spyOn(drafts, "readDraftBlob").mockResolvedValue(new TextEncoder().encode("private"));
  URL.createObjectURL = vi.fn(() => "blob:x");
  URL.revokeObjectURL = vi.fn();
  useProjectBaselineStore.getState().setBinaries(project.id, {
    "assets/textures/kept.png": { hash: "k", size: 1 },
    "assets/textures/logo.png": { hash: "old", size: 1 },
  });
  useProjectDraftStore.getState().save(project.id, {
    baseline: {},
    tree: {},
    at: 1,
    binaryBaseline: {
      "assets/textures/kept.png": { hash: "k", size: 1 },
      "assets/textures/logo.png": { hash: "old", size: 1 },
    },
    binaryTree: {
      "assets/textures/kept.png": { hash: "k", size: 1 },
      "assets/textures/logo.png": { hash: "new", size: 1 },
    },
    remote: { id: "d1", name: "d", revision: 1, ownerId: "u", acknowledged: "" },
  });

  expect(await runExportDraftZip(project)).toEqual({ ok: true });
  const root = `plugins/Artisan/projects/${project.diskId ?? project.id}`;
  expect(new TextDecoder().decode(files[`${root}/assets/textures/kept.png`] as Uint8Array)).toBe(
    "published:assets/textures/kept.png",
  );
  expect(new TextDecoder().decode(files[`${root}/assets/textures/logo.png`] as Uint8Array)).toBe(
    "private",
  );
  expect(drafts.readDraftBlob).toHaveBeenCalledWith(project.id, "d1", "new");
  expect(files[`${root}/manifest.yaml`]).toBeTypeOf("string");
});
