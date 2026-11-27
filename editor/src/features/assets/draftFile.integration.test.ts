import { usePersistedDraftStore } from "@/features/project/persistedDrafts";
import * as drafts from "@/lib/api/projectDrafts";
import * as files from "@/lib/api/projectFiles";
import { useAuthStore } from "@/state/authStore";
import { useProjectBaselineStore } from "@/state/projectBaselineStore";
import { useProjectDraftStore } from "@/state/projectDraftStore";
import { useProjectsStore } from "@/state/projectsStore";
import { beforeEach, expect, test, vi } from "vitest";
import { writeDraftFile } from "./draftFile";

const THEME = "srv.noel";
const published = {
  ok: true as const,
  files: { "theme.yml": "name: noel\n" },
  binaries: [{ path: "assets/textures/cell.png", hash: "h1", size: 9 }],
  hash: "tree",
};

beforeEach(() => {
  vi.restoreAllMocks();
  useAuthStore.setState({ currentUser: { id: "owner" } } as never);
  useProjectsStore.setState({ openProjects: { projects: [], projectOrder: [] } } as never);
  useProjectDraftStore.setState({ drafts: {}, ownerId: "owner", pendingRenames: {}, backups: {} });
  usePersistedDraftStore.setState({ sessions: {} });
  useProjectBaselineStore.getState().clear(THEME);
});

test("a theme that is not open takes a file in a draft made on its published files", async () => {
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

  await writeDraftFile(THEME, "palette.yml", 'primary: "#b3261e"\n');

  expect(create).toHaveBeenCalledTimes(1);
  // The hub receives the published theme plus the file: nothing of it is lost on deploy.
  expect(create.mock.calls[0]?.[3]).toMatchObject({
    baseline: published.files,
    tree: { ...published.files, "palette.yml": 'primary: "#b3261e"\n' },
    binaryBaseline: { "assets/textures/cell.png": { hash: "h1", size: 9 } },
  });
  const draft = useProjectDraftStore.getState().get(THEME);
  expect(draft?.remote?.revision).toBe(1);
  expect(draft?.tree["palette.yml"]).toBe('primary: "#b3261e"\n');
  expect(usePersistedDraftStore.getState().sessions[THEME]?.status).toBe("saved");
});
