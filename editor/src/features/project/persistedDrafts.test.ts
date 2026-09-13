import * as api from "@/lib/api/projectDrafts";
import { useAuthStore } from "@/state/authStore";
import { useProjectCacheStore } from "@/state/projectCacheStore";
import { useProjectDraftStore } from "@/state/projectDraftStore";
import { beforeEach, expect, it, vi } from "vitest";
import { onProjectRenamed } from "./onProjectRenamed";
import {
  copyPersistedDraft,
  discardPersistedDraft,
  loadPersistedDrafts,
  publishPersistedDraft,
  syncPersistedDraft,
  usePersistedDraftStore,
} from "./persistedDrafts";

vi.mock("@/lib/api/projectDrafts", async (original) => ({
  ...(await original<typeof api>()),
  listDrafts: vi.fn(),
  readDraft: vi.fn(),
  createDraft: vi.fn(),
  updateDraft: vi.fn(),
  publishDraft: vi.fn(),
  discardDraft: vi.fn(),
}));
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
  usePersistedDraftStore.setState({ sessions: {} });
});
it("restores a backend draft and its rename intentions on a fresh browser", async () => {
  vi.mocked(api.listDrafts).mockResolvedValue([
    {
      ...remote,
      snapshot: { ...snapshot, renames: [{ from: "menus/a.yaml", to: "menus/b.yaml" }] },
    },
  ]);
  await loadPersistedDrafts("p1", "u1");
  expect(useProjectDraftStore.getState().get("p1")?.tree).toEqual(snapshot.tree);
  expect(useProjectDraftStore.getState().pendingRenames.p1).toEqual([
    { from: "menus/a.yaml", to: "menus/b.yaml" },
  ]);
  await syncPersistedDraft("p1");
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
  await loadPersistedDrafts("p1", "u1");
  await syncPersistedDraft("p1");
  expect(api.createDraft).toHaveBeenCalledOnce();
  expect(api.updateDraft).not.toHaveBeenCalled();
  expect(useProjectDraftStore.getState().get("p1")?.remote?.id).not.toBe("d1");
});

it("retries the same operation and snapshot after a lost save ACK, then sends newer edits", async () => {
  vi.mocked(api.listDrafts).mockResolvedValue([remote]);
  await loadPersistedDrafts("p1", "u1");
  const edit = (text: string) =>
    useProjectDraftStore.getState().save("p1", {
      ...useProjectDraftStore.getState().get("p1")!,
      tree: { "manifest.yaml": text },
    });
  edit("first");
  vi.mocked(api.updateDraft)
    .mockRejectedValueOnce(new Error("network_error"))
    .mockImplementation(async (_p, _id, revision, _name, saved) => ({
      ...remote,
      revision: revision + 1,
      snapshot: saved,
    }));
  await syncPersistedDraft("p1");
  const first = vi.mocked(api.updateDraft).mock.calls[0]!;
  expect(first[5]).toEqual(expect.any(String));
  edit("second");
  await syncPersistedDraft("p1");
  expect(vi.mocked(api.updateDraft).mock.calls[1]).toEqual(first);
  expect(useProjectDraftStore.getState().get("p1")?.tree["manifest.yaml"]).toBe("second");
  expect(usePersistedDraftStore.getState().sessions.p1?.status).toBe("pending");
  await syncPersistedDraft("p1");
  expect(vi.mocked(api.updateDraft).mock.calls[2]?.[2]).toBe(2);
  expect(vi.mocked(api.updateDraft).mock.calls[2]?.[5]).not.toBe(first[5]);
  expect(usePersistedDraftStore.getState().sessions.p1?.status).toBe("saved");
});

it("keeps edits and the same private draft when the folder is renamed while a save is in flight", async () => {
  vi.mocked(api.listDrafts).mockResolvedValue([remote]);
  await loadPersistedDrafts("p1", "u1");
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
  const pending = syncPersistedDraft("p1");
  await vi.waitFor(() => expect(api.updateDraft).toHaveBeenCalledOnce());
  edit("second edit");
  useProjectCacheStore.setState({
    entries: {
      cached: {
        identity: { project: { id: "p1" } },
        diskId: "old",
        serverKeyId: "server",
        tree: snapshot.baseline,
        fetchedAt: "today",
      },
    },
  });
  onProjectRenamed({
    projectId: "p1",
    serverKeyId: "server",
    previousDiskId: "old",
    diskId: "renamed",
  });
  finish({
    ...remote,
    snapshot: { ...snapshot, tree: { "manifest.yaml": "first edit" } },
    revision: 2,
  });
  await pending;
  await syncPersistedDraft("p1");
  expect(api.updateDraft).toHaveBeenLastCalledWith(
    "p1",
    "d1",
    2,
    "My work",
    expect.objectContaining({ tree: { "manifest.yaml": "second edit" } }),
    expect.any(String),
  );
  expect(useProjectDraftStore.getState().get("p1")?.tree["manifest.yaml"]).toBe("second edit");
  expect(useProjectDraftStore.getState().get("p1")?.remote?.ownerId).toBe("u1");
  expect(useProjectCacheStore.getState().entries.cached?.diskId).toBe("renamed");
});

it("keeps unsent work when another browser has advanced the draft", async () => {
  vi.mocked(api.listDrafts).mockResolvedValue([remote]);
  await loadPersistedDrafts("p1", "u1");
  useProjectDraftStore.getState().save("p1", {
    ...useProjectDraftStore.getState().get("p1")!,
    tree: { "manifest.yaml": "local unsent" },
  });
  vi.mocked(api.listDrafts).mockResolvedValue([{ ...remote, revision: 2 }]);
  vi.mocked(api.readDraft).mockResolvedValue({ ...remote, revision: 2 });
  await loadPersistedDrafts("p1", "u1");
  await syncPersistedDraft("p1");
  expect(usePersistedDraftStore.getState().sessions.p1?.status).toBe("conflict");
  expect(useProjectDraftStore.getState().get("p1")?.tree["manifest.yaml"]).toBe("local unsent");
  expect(api.updateDraft).not.toHaveBeenCalled();
});

it("ignores a stale draft listing when this session acknowledged a newer revision during loading", async () => {
  vi.mocked(api.listDrafts).mockResolvedValue([remote]);
  await loadPersistedDrafts("p1", "u1");
  useProjectDraftStore.getState().save("p1", {
    ...useProjectDraftStore.getState().get("p1")!,
    tree: { "manifest.yaml": "single session edit" },
  });
  let finishListing!: (drafts: (typeof remote)[]) => void;
  vi.mocked(api.listDrafts).mockImplementationOnce(
    () =>
      new Promise((resolve) => {
        finishListing = resolve;
      }),
  );
  const loading = loadPersistedDrafts("p1", "u1");
  vi.mocked(api.updateDraft).mockImplementation(async (_p, _id, revision, _name, saved) => ({
    ...remote,
    snapshot: saved,
    revision: revision + 1,
  }));
  await syncPersistedDraft("p1");
  finishListing([remote]);
  await loading;
  expect(usePersistedDraftStore.getState().sessions.p1?.status).toBe("saved");
  expect(useProjectDraftStore.getState().get("p1")?.remote?.revision).toBe(2);
  expect(useProjectDraftStore.getState().get("p1")?.tree["manifest.yaml"]).toBe(
    "single session edit",
  );
});

it("separates local backups between accounts and restores them on return", () => {
  useProjectDraftStore.getState().setOwner("u1");
  useProjectDraftStore.getState().save("p1", snapshot);
  useProjectDraftStore.getState().setOwner("u2");
  expect(useProjectDraftStore.getState().get("p1")).toBeUndefined();
  useProjectDraftStore.getState().setOwner("u1");
  expect(useProjectDraftStore.getState().get("p1")?.tree).toEqual(snapshot.tree);
});

it("recovers an already blocked draft when the backend has exactly the local snapshot", async () => {
  vi.mocked(api.listDrafts).mockResolvedValue([remote]);
  await loadPersistedDrafts("p1", "u1");
  usePersistedDraftStore.setState({
    sessions: { p1: { ownerId: "u1", drafts: [remote], status: "conflict" } },
  });
  vi.mocked(api.readDraft).mockResolvedValue({ ...remote, revision: 2 });
  await syncPersistedDraft("p1");
  expect(usePersistedDraftStore.getState().sessions.p1?.status).toBe("saved");
  expect(useProjectDraftStore.getState().get("p1")?.remote?.revision).toBe(2);
  expect(api.updateDraft).not.toHaveBeenCalled();
});

it("keeps edits made while checking whether a conflict is false", async () => {
  vi.mocked(api.listDrafts).mockResolvedValue([remote]);
  await loadPersistedDrafts("p1", "u1");
  usePersistedDraftStore.setState({
    sessions: { p1: { ownerId: "u1", drafts: [remote], status: "conflict" } },
  });
  let finish!: (draft: typeof remote) => void;
  vi.mocked(api.readDraft).mockImplementationOnce(
    () =>
      new Promise((resolve) => {
        finish = resolve;
      }),
  );
  const checking = syncPersistedDraft("p1");
  useProjectDraftStore.getState().save("p1", {
    ...useProjectDraftStore.getState().get("p1")!,
    tree: { "manifest.yaml": "new edit" },
  });
  finish({ ...remote, revision: 2 });
  await checking;
  expect(useProjectDraftStore.getState().get("p1")?.tree["manifest.yaml"]).toBe("new edit");
  expect(usePersistedDraftStore.getState().sessions.p1?.status).toBe("conflict");
  expect(api.updateDraft).not.toHaveBeenCalled();
});

it("does not resurrect a draft published by another browser when this copy has no unsent edits", async () => {
  vi.mocked(api.listDrafts).mockResolvedValue([remote]);
  await loadPersistedDrafts("p1", "u1");
  vi.mocked(api.listDrafts).mockResolvedValue([]);
  vi.mocked(api.readDraft).mockResolvedValue({ ...remote, status: "published", revision: 2 });
  await loadPersistedDrafts("p1", "u1");
  expect(useProjectDraftStore.getState().get("p1")).toBeUndefined();
  expect(usePersistedDraftStore.getState().sessions.p1?.status).toBe("saved");
});

it("preserves binary references when saving a text edit", async () => {
  const binaryTree = { "assets/icon.png": { hash: "hash", size: 8 } };
  vi.mocked(api.listDrafts).mockResolvedValue([
    { ...remote, snapshot: { ...snapshot, binaryTree } },
  ]);
  await loadPersistedDrafts("p1", "u1");
  useProjectDraftStore.getState().save("p1", {
    ...useProjectDraftStore.getState().get("p1")!,
    tree: { "manifest.yaml": "text edit" },
  });
  vi.mocked(api.updateDraft).mockImplementation(async (_p, _id, revision, _name, saved) => ({
    ...remote,
    revision: revision + 1,
    snapshot: saved,
  }));
  await syncPersistedDraft("p1");
  expect(vi.mocked(api.updateDraft).mock.calls[0]?.[4].binaryTree).toEqual(binaryTree);
});

it("persists a local binary-only edit after publication cleared its remote identity", async () => {
  const tree = snapshot.baseline;
  const binaryTree = { "assets/icon.png": { hash: "new", size: 3 } };
  useProjectDraftStore
    .getState()
    .save("p1", { baseline: tree, initialTree: tree, tree, at: 1, binaryTree });
  vi.mocked(api.listDrafts).mockResolvedValue([]);
  vi.mocked(api.createDraft).mockImplementation(async (_p, id, name, saved) => ({
    ...remote,
    id,
    name,
    snapshot: saved,
  }));
  await loadPersistedDrafts("p1", "u1");
  await syncPersistedDraft("p1");
  expect(vi.mocked(api.createDraft).mock.calls[0]?.[3].binaryTree).toEqual(binaryTree);
});

it("can copy local edits after another browser rejects a save revision", async () => {
  vi.mocked(api.listDrafts).mockResolvedValue([remote]);
  await loadPersistedDrafts("p1", "u1");
  useProjectDraftStore.getState().save("p1", {
    ...useProjectDraftStore.getState().get("p1")!,
    tree: { "manifest.yaml": "my edit" },
  });
  vi.mocked(api.updateDraft).mockRejectedValue(new api.DraftApiError("draft_conflict", 409));
  await syncPersistedDraft("p1");
  expect(useProjectDraftStore.getState().get("p1")?.remote?.pendingMutation).toBeUndefined();
  vi.mocked(api.createDraft).mockImplementation(async (_p, id, name, saved) => ({
    ...remote,
    id,
    name,
    snapshot: saved,
  }));
  await copyPersistedDraft("p1", "Recovered work");
  expect(useProjectDraftStore.getState().get("p1")?.remote?.id).not.toBe("d1");
  expect(useProjectDraftStore.getState().get("p1")?.tree["manifest.yaml"]).toBe("my edit");
});

it("reports migration suspension without losing the local recovery copy", async () => {
  useProjectDraftStore.getState().save("p1", snapshot);
  vi.mocked(api.listDrafts).mockRejectedValue(
    new api.DraftApiError("draft_migration_pending", 503),
  );
  await loadPersistedDrafts("p1", "u1");
  expect(usePersistedDraftStore.getState().sessions.p1?.status).toBe("migration_pending");
  expect(useProjectDraftStore.getState().get("p1")?.tree).toEqual(snapshot.tree);
  await syncPersistedDraft("p1");
  expect(usePersistedDraftStore.getState().sessions.p1?.status).toBe("migration_pending");
  expect(api.createDraft).not.toHaveBeenCalled();
});

it("retries uncertain publication with the same operation after further typing", async () => {
  vi.mocked(api.listDrafts).mockResolvedValue([remote]);
  await loadPersistedDrafts("p1", "u1");
  vi.mocked(api.publishDraft)
    .mockRejectedValueOnce(new Error("network_error"))
    .mockResolvedValue({ draft: { ...remote, status: "published" }, wrote: 1 });
  await expect(publishPersistedDraft("p1")).rejects.toThrow("network_error");
  const operation = vi.mocked(api.publishDraft).mock.calls[0];
  useProjectDraftStore.getState().save("p1", {
    ...useProjectDraftStore.getState().get("p1")!,
    tree: { "manifest.yaml": "later edit" },
  });
  await loadPersistedDrafts("p1", "u1");
  expect(await publishPersistedDraft("p1")).toEqual({ wrote: 1, tree: snapshot.tree });
  expect(vi.mocked(api.publishDraft).mock.calls[1]).toEqual(operation);
  expect(useProjectDraftStore.getState().get("p1")?.tree["manifest.yaml"]).toBe("later edit");
});

it("releases a rejected publication so resolved edits can be saved and published", async () => {
  vi.mocked(api.listDrafts).mockResolvedValue([remote]);
  await loadPersistedDrafts("p1", "u1");
  vi.mocked(api.publishDraft)
    .mockRejectedValueOnce(new api.DraftApiError("conflict", 409))
    .mockResolvedValue({ draft: remote, wrote: 1 });
  await expect(publishPersistedDraft("p1")).rejects.toThrow("conflict");
  expect(useProjectDraftStore.getState().get("p1")?.remote?.pendingMutation).toBeUndefined();
  useProjectDraftStore.getState().save("p1", {
    ...useProjectDraftStore.getState().get("p1")!,
    tree: { "manifest.yaml": "resolved" },
  });
  vi.mocked(api.updateDraft).mockImplementation(async (_p, _id, revision, _name, saved) => ({
    ...remote,
    revision: revision + 1,
    snapshot: saved,
  }));
  await publishPersistedDraft("p1");
  expect(api.updateDraft).toHaveBeenCalledOnce();
  expect(vi.mocked(api.publishDraft).mock.calls[1]?.[3]).not.toBe(
    vi.mocked(api.publishDraft).mock.calls[0]?.[3],
  );
});

it("retries discard after a lost ACK without deleting edits made during the request", async () => {
  vi.mocked(api.listDrafts).mockResolvedValue([remote]);
  await loadPersistedDrafts("p1", "u1");
  vi.mocked(api.discardDraft).mockRejectedValueOnce(new Error("network_error"));
  await expect(discardPersistedDraft("p1")).rejects.toThrow("network_error");
  const operation = vi.mocked(api.discardDraft).mock.calls[0];
  vi.mocked(api.discardDraft).mockImplementationOnce(async () => {
    useProjectDraftStore.getState().save("p1", {
      ...useProjectDraftStore.getState().get("p1")!,
      tree: { "manifest.yaml": "later" },
    });
  });
  await expect(discardPersistedDraft("p1")).rejects.toThrow("draft_changed");
  expect(vi.mocked(api.discardDraft).mock.calls[1]).toEqual(operation);
  expect(useProjectDraftStore.getState().get("p1")?.tree["manifest.yaml"]).toBe("later");
});
