import { mutateDraftAssets, usePersistedDraftStore } from "@/features/project/persistedDrafts";
import * as drafts from "@/lib/api/projectDrafts";
import * as files from "@/lib/api/projectFiles";
import { useAuthStore } from "@/state/authStore";
import { draftedLibrary } from "@/state/libraryRead";
import { useProjectBaselineStore } from "@/state/projectBaselineStore";
import { useProjectDraftStore } from "@/state/projectDraftStore";
import { useProjectsStore } from "@/state/projectsStore";
import { beforeEach, expect, test, vi } from "vitest";
import { libraryDraftAssets } from "./kitAssets";
import { openLibraryDraft } from "./libraryDraft";

const LIBRARY = "srv.artisan";
const published = {
  ok: true as const,
  files: { "artisan.yml": "name: artisan\n" },
  binaries: [{ path: "assets/textures/cell.png", hash: "h1", size: 9 }],
  hash: "tree",
};

beforeEach(() => {
  vi.restoreAllMocks();
  useAuthStore.setState({ currentUser: { id: "owner" } } as never);
  // The module is open, the library is not.
  useProjectsStore.setState({ openProjects: { projects: [], projectOrder: [] } } as never);
  useProjectDraftStore.setState({ drafts: {}, ownerId: "owner", pendingRenames: {}, backups: {} });
  usePersistedDraftStore.setState({ sessions: {} });
  useProjectBaselineStore.getState().clear(LIBRARY);
});

test("a library that is not open takes an image in a draft made on its published files", async () => {
  vi.spyOn(files, "readProjectFiles").mockResolvedValue(published as never);
  vi.spyOn(drafts, "listDrafts").mockResolvedValue([]);
  const create = vi.spyOn(drafts, "createDraft").mockImplementation(
    async (projectId, id, name, fresh) =>
      ({
        id,
        projectId,
        ownerId: "owner",
        name,
        revision: 1,
        snapshot: fresh,
        status: "active",
        source: "editor",
        updatedAt: "now",
      }) as never,
  );

  await openLibraryDraft(LIBRARY);
  expect(usePersistedDraftStore.getState().sessions[LIBRARY]).toMatchObject({
    ownerId: "owner",
    status: "saved",
  });
  expect(useProjectDraftStore.getState().get(LIBRARY)).toBeUndefined();

  // The upload itself, as `uploadAsset` runs it, with the hub's answer stood in for.
  await mutateDraftAssets(
    LIBRARY,
    { suffix: "", method: "POST", fields: { type: "glyph", name: "crest" } },
    async (operation) => ({
      draft: {
        id: operation.id,
        projectId: LIBRARY,
        ownerId: "owner",
        name: operation.name,
        revision: 2,
        status: "active",
        source: "editor",
        updatedAt: "now",
        snapshot: {
          ...operation.snapshot!,
          tree: {
            ...operation.snapshot!.tree,
            "assets/glyphs/crest.yml": "width: 40\nheight: 12\n",
          },
          binaryTree: {
            ...operation.snapshot!.binaryTree,
            "assets/glyphs/crest.png": { hash: "h2", size: 20 },
          },
        },
      } as never,
    }),
  );
  expect(create).toHaveBeenCalledTimes(1);
  // The draft starts from the published library: nothing of it is lost on deploy.
  expect(create.mock.calls[0]?.[3]).toMatchObject({
    baseline: published.files,
    tree: published.files,
    binaryBaseline: { "assets/textures/cell.png": { hash: "h1", size: 9 } },
  });
  const draft = useProjectDraftStore.getState().get(LIBRARY);
  expect(draft?.remote?.revision).toBe(2);
  expect(Object.keys(draft?.binaryTree ?? {}).sort()).toEqual([
    "assets/glyphs/crest.png",
    "assets/textures/cell.png",
  ]);

  // What the menu's canvas and its names then see.
  const read = { projectId: LIBRARY, files: published.files, binaries: published.binaries };
  expect(libraryDraftAssets(read, draft).map((a) => a.id)).toEqual(["kit:crest"]);
  expect(draftedLibrary(read)?.binaries.map((b) => b.path)).toContain("assets/glyphs/crest.png");
});
