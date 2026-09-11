import * as api from "@/lib/api/projectDrafts";
import { useAuthStore } from "@/state/authStore";
import { useProjectDraftStore } from "@/state/projectDraftStore";
import { beforeEach, expect, it, vi } from "vitest";
import { loadBackendDrafts, syncBackendDraft, useBackendDraftStore } from "./backendDrafts";

vi.mock("@/lib/api/projectDrafts");
const snapshot = {
  baseline: { "manifest.yaml": "base" },
  tree: { "manifest.yaml": "edited" },
  initialTree: { "manifest.yaml": "base" },
  at: 123,
};
const remote = {
  id: "d1",
  projectId: "p1",
  ownerId: "u1",
  name: "My work",
  revision: 1,
  status: "active",
  snapshot,
  source: "editor",
  updatedAt: "today",
};
beforeEach(() => {
  vi.resetAllMocks();
  useAuthStore.setState({ currentUser: { id: "u1" } as never });
  useProjectDraftStore.setState({ drafts: {}, pendingRenames: {} });
  useBackendDraftStore.setState({ sessions: {} });
});
it("restores a backend draft and its rename intentions on a fresh browser", async () => {
  vi.mocked(api.listDrafts).mockResolvedValue([
    {
      ...remote,
      snapshot: { ...snapshot, renames: [{ from: "menus/a.yaml", to: "menus/b.yaml" }] },
    },
  ]);
  await loadBackendDrafts("p1", "u1");
  expect(useProjectDraftStore.getState().get("p1")?.tree).toEqual(snapshot.tree);
  expect(useProjectDraftStore.getState().pendingRenames.p1).toEqual([
    { from: "menus/a.yaml", to: "menus/b.yaml" },
  ]);
  await syncBackendDraft("p1");
  expect(api.updateDraft).not.toHaveBeenCalled();
});

it("uploads a legacy local draft separately without overwriting existing backend work", async () => {
  useProjectDraftStore.getState().save("p1", snapshot);
  vi.mocked(api.listDrafts).mockResolvedValue([remote]);
  vi.mocked(api.createDraft).mockImplementation(async (projectId, id, name, saved) => ({
    ...remote,
    projectId,
    id,
    name,
    snapshot: saved,
  }));
  await loadBackendDrafts("p1", "u1");
  await syncBackendDraft("p1");
  expect(api.createDraft).toHaveBeenCalledOnce();
  expect(api.updateDraft).not.toHaveBeenCalled();
  expect(useProjectDraftStore.getState().get("p1")?.remote?.id).not.toBe("d1");
});

it("keeps edits made while a save is in flight and sends them with the acknowledged revision", async () => {
  vi.mocked(api.listDrafts).mockResolvedValue([remote]);
  await loadBackendDrafts("p1", "u1");
  const edit = (text: string) =>
    useProjectDraftStore.getState().save("p1", {
      ...useProjectDraftStore.getState().get("p1")!,
      tree: { "manifest.yaml": text },
    });
  edit("first edit");
  let finish!: (draft: typeof remote) => void;
  vi.mocked(api.updateDraft)
    .mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          finish = resolve;
        }),
    )
    .mockImplementation(async (_p, _id, revision, _name, saved) => ({
      ...remote,
      snapshot: saved,
      revision: revision + 1,
    }));
  const pending = syncBackendDraft("p1");
  await vi.waitFor(() => expect(api.updateDraft).toHaveBeenCalledOnce());
  edit("second edit");
  finish({
    ...remote,
    snapshot: { ...snapshot, tree: { "manifest.yaml": "first edit" } },
    revision: 2,
  });
  await pending;
  await syncBackendDraft("p1");
  expect(api.updateDraft).toHaveBeenLastCalledWith(
    "p1",
    "d1",
    2,
    "My work",
    expect.objectContaining({ tree: { "manifest.yaml": "second edit" } }),
  );
  expect(useProjectDraftStore.getState().get("p1")?.tree["manifest.yaml"]).toBe("second edit");
});

it("keeps unsent work when another browser has advanced the draft", async () => {
  vi.mocked(api.listDrafts).mockResolvedValue([remote]);
  await loadBackendDrafts("p1", "u1");
  useProjectDraftStore.getState().save("p1", {
    ...useProjectDraftStore.getState().get("p1")!,
    tree: { "manifest.yaml": "local unsent" },
  });
  vi.mocked(api.listDrafts).mockResolvedValue([{ ...remote, revision: 2 }]);
  await loadBackendDrafts("p1", "u1");
  await syncBackendDraft("p1");
  expect(useBackendDraftStore.getState().sessions.p1?.status).toBe("conflict");
  expect(useProjectDraftStore.getState().get("p1")?.tree["manifest.yaml"]).toBe("local unsent");
  expect(api.updateDraft).not.toHaveBeenCalled();
});

it("separates local backups between accounts and restores them on return", () => {
  useProjectDraftStore.getState().setOwner("u1");
  useProjectDraftStore.getState().save("p1", snapshot);
  useProjectDraftStore.getState().setOwner("u2");
  expect(useProjectDraftStore.getState().get("p1")).toBeUndefined();
  useProjectDraftStore.getState().setOwner("u1");
  expect(useProjectDraftStore.getState().get("p1")?.tree).toEqual(snapshot.tree);
});

it("does not resurrect a draft published by another browser when this copy has no unsent edits", async () => {
  vi.mocked(api.listDrafts).mockResolvedValue([remote]);
  await loadBackendDrafts("p1", "u1");
  vi.mocked(api.listDrafts).mockResolvedValue([]);
  vi.mocked(api.readDraft).mockResolvedValue({ ...remote, status: "published", revision: 2 });
  await loadBackendDrafts("p1", "u1");
  expect(useProjectDraftStore.getState().get("p1")).toBeUndefined();
  expect(useBackendDraftStore.getState().sessions.p1?.status).toBe("saved");
});
