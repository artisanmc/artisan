import * as api from "@/lib/api/projectDrafts";
import { useAuthStore } from "@/state/authStore";
import { useProjectCacheStore } from "@/state/projectCacheStore";
import { useProjectDraftStore } from "@/state/projectDraftStore";
import { beforeEach, expect, it, vi } from "vitest";
import { rebaseDraft } from "./draftRebase";
import { onProjectRenamed } from "./onProjectRenamed";
import {
  consumeOpenConflicts,
  copyPersistedDraft,
  discardPersistedDraft,
  loadPersistedDrafts,
  markDraftPending,
  publishPersistedDraft,
  resolveDraftConflict,
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

it("hands the conflicts found at open to the session, once", async () => {
  const conflicts = [{ path: "menus/shop.yaml", disk: "server version" }];
  vi.mocked(api.listDrafts).mockResolvedValue([{ ...remote, conflicts }]);
  await loadPersistedDrafts("p1", "u1");
  expect(usePersistedDraftStore.getState().sessions.p1?.openConflicts).toEqual(conflicts);
  expect(usePersistedDraftStore.getState().sessions.p1?.status).toBe("saved");
  consumeOpenConflicts("p1");
  expect(usePersistedDraftStore.getState().sessions.p1?.openConflicts).toBeUndefined();
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

it("separates local backups between players and restores them on return", () => {
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

it("discards against the server revision when another device saved the draft since", async () => {
  vi.mocked(api.listDrafts).mockResolvedValue([remote]);
  await loadPersistedDrafts("p1", "u1");
  vi.mocked(api.discardDraft)
    .mockRejectedValueOnce(
      new api.DraftApiError("draft_conflict", 409, { ...remote, revision: 14 }),
    )
    .mockResolvedValueOnce(undefined as never);
  await discardPersistedDraft("p1");
  expect(vi.mocked(api.discardDraft).mock.calls[1]?.[2]).toBe(14);
  expect(useProjectDraftStore.getState().get("p1")).toBeUndefined();
});

it("treats a discard conflict on an already closed draft as done", async () => {
  vi.mocked(api.listDrafts).mockResolvedValue([remote]);
  await loadPersistedDrafts("p1", "u1");
  vi.mocked(api.discardDraft).mockRejectedValueOnce(
    new api.DraftApiError("draft_conflict", 409, { ...remote, revision: 5, status: "discarded" }),
  );
  await discardPersistedDraft("p1");
  expect(api.discardDraft).toHaveBeenCalledTimes(1);
  expect(useProjectDraftStore.getState().get("p1")).toBeUndefined();
});

/** Loads the draft, edits manifest.yaml, then simulates another session that wrote the same file. */
async function setupSameFileConflict(): Promise<void> {
  vi.mocked(api.listDrafts).mockResolvedValue([remote]);
  await loadPersistedDrafts("p1", "u1");
  const mine = useProjectDraftStore.getState().get("p1")!;
  useProjectDraftStore.getState().save("p1", { ...mine, tree: { "manifest.yaml": "mine" } });
  const theirs = {
    ...remote,
    revision: 2,
    snapshot: { ...snapshot, tree: { "manifest.yaml": "theirs" } },
  };
  vi.mocked(api.updateDraft).mockRejectedValue(
    new api.DraftApiError("draft_conflict", 409, theirs),
  );
  await syncPersistedDraft("p1");
}

it("rebases another session and silently adopts the files only it touched", async () => {
  vi.mocked(api.listDrafts).mockResolvedValue([remote]);
  await loadPersistedDrafts("p1", "u1");
  const mine = useProjectDraftStore.getState().get("p1")!;
  useProjectDraftStore.getState().save("p1", {
    ...mine,
    tree: { ...mine.tree, "menus/mine.yaml": "mine" },
  });
  const theirs = {
    ...remote,
    revision: 2,
    snapshot: {
      baseline: { "manifest.yaml": "base" },
      tree: { "manifest.yaml": "edited", "menus/theirs.yaml": "theirs" },
      initialTree: { "manifest.yaml": "base" },
      at: 200,
    },
  };
  vi.mocked(api.updateDraft).mockRejectedValue(
    new api.DraftApiError("draft_conflict", 409, theirs),
  );
  await syncPersistedDraft("p1");
  expect(api.updateDraft).toHaveBeenCalledOnce();
  const session = usePersistedDraftStore.getState().sessions.p1;
  expect(session?.status).toBe("conflict");
  expect(session?.draftConflict?.conflicts).toEqual([]);
  const local = useProjectDraftStore.getState().get("p1")!;
  expect(local.tree["menus/theirs.yaml"]).toBe("theirs");
  expect(local.tree["menus/mine.yaml"]).toBe("mine");
  expect(local.tree["manifest.yaml"]).toBe("edited");
  expect(local.remote?.revision).toBe(2);
});

it("flags a file edited on both sides and stops writing until it is settled", async () => {
  await setupSameFileConflict();
  const session = usePersistedDraftStore.getState().sessions.p1;
  expect(session?.draftConflict?.conflicts).toEqual([{ path: "manifest.yaml", disk: "theirs" }]);
  expect(useProjectDraftStore.getState().get("p1")?.tree["manifest.yaml"]).toBe("mine");
  expect(useProjectDraftStore.getState().get("p1")?.remote?.revision).toBe(2);
  expect(api.updateDraft).toHaveBeenCalledOnce();
  await syncPersistedDraft("p1");
  expect(api.updateDraft).toHaveBeenCalledOnce();
});

it("settles a conflict: keeping my version writes at the remote revision", async () => {
  await setupSameFileConflict();
  vi.mocked(api.updateDraft).mockImplementation(async (_p, _id, revision, _name, saved) => ({
    ...remote,
    revision: revision + 1,
    snapshot: saved,
  }));
  await resolveDraftConflict("p1", { "manifest.yaml": "mine" });
  expect(vi.mocked(api.updateDraft).mock.calls[1]?.[2]).toBe(2);
  expect(vi.mocked(api.updateDraft).mock.calls[1]?.[4].tree["manifest.yaml"]).toBe("mine");
  expect(usePersistedDraftStore.getState().sessions.p1?.status).toBe("saved");
  expect(usePersistedDraftStore.getState().sessions.p1?.draftConflict).toBeUndefined();
  expect(useProjectDraftStore.getState().get("p1")?.remote?.revision).toBe(3);
});

it("settles a conflict: taking the other session rewrites nothing", async () => {
  await setupSameFileConflict();
  vi.mocked(api.updateDraft).mockClear();
  await resolveDraftConflict("p1", { "manifest.yaml": "disk" });
  expect(api.updateDraft).not.toHaveBeenCalled();
  expect(useProjectDraftStore.getState().get("p1")?.tree["manifest.yaml"]).toBe("theirs");
  // The other session's version is not published: the base stays the disk.
  expect(useProjectDraftStore.getState().get("p1")?.baseline["manifest.yaml"]).toBe("base");
  expect(usePersistedDraftStore.getState().sessions.p1?.status).toBe("saved");
  expect(usePersistedDraftStore.getState().sessions.p1?.draftConflict).toBeUndefined();
});

const disk = { "g.yaml": "base", "m.yaml": "base" };
const revisionOf = (revision: number, tree: Record<string, string>) => ({
  ...remote,
  revision,
  snapshot: { baseline: disk, tree, initialTree: disk, at: 1 },
});

it("keeps the base on disk when it takes over another session's work", async () => {
  vi.mocked(api.listDrafts).mockResolvedValue([revisionOf(1, disk)]);
  await loadPersistedDrafts("p1", "u1");
  const mine = useProjectDraftStore.getState().get("p1")!;
  useProjectDraftStore.getState().save("p1", { ...mine, tree: { ...mine.tree, "g.yaml": "A" } });
  vi.mocked(api.updateDraft).mockRejectedValueOnce(
    new api.DraftApiError("draft_conflict", 409, revisionOf(2, { ...disk, "m.yaml": "B" })),
  );
  await syncPersistedDraft("p1");
  expect(usePersistedDraftStore.getState().sessions.p1?.draftConflict?.conflicts).toEqual([]);
  vi.mocked(api.updateDraft).mockImplementation(async (_p, _id, revision, _name, saved) => ({
    ...remote,
    revision: revision + 1,
    snapshot: saved,
  }));
  await resolveDraftConflict("p1", {});
  const saved = vi.mocked(api.updateDraft).mock.calls.at(-1)![4];
  expect(saved.tree).toEqual({ "g.yaml": "A", "m.yaml": "B" });
  expect(saved.baseline).toEqual(disk);
  // Re-read by the hub (rebase against the disk), B's work survives.
  expect(rebaseDraft(saved, { files: disk, binaries: {} }).snapshot.tree["m.yaml"]).toBe("B");
});

it("does not flag a conflict on a file changed since the last common revision", async () => {
  const shared = { ...disk, "m.yaml": "S" };
  vi.mocked(api.listDrafts).mockResolvedValue([revisionOf(1, shared)]);
  await loadPersistedDrafts("p1", "u1");
  const mine = useProjectDraftStore.getState().get("p1")!;
  useProjectDraftStore.getState().save("p1", { ...mine, tree: { ...mine.tree, "g.yaml": "A" } });
  vi.mocked(api.updateDraft).mockRejectedValueOnce(
    new api.DraftApiError("draft_conflict", 409, revisionOf(2, { ...shared, "m.yaml": "B" })),
  );
  await syncPersistedDraft("p1");
  expect(usePersistedDraftStore.getState().sessions.p1?.draftConflict?.conflicts).toEqual([]);
  expect(useProjectDraftStore.getState().get("p1")?.tree).toEqual({ "g.yaml": "A", "m.yaml": "B" });
});

it("does not empty the local image base when the remote draft carries none", async () => {
  vi.mocked(api.listDrafts).mockResolvedValue([remote]);
  await loadPersistedDrafts("p1", "u1");
  const mine = useProjectDraftStore.getState().get("p1")!;
  const binaries = { "assets/icon.png": { hash: "old", size: 3 } };
  useProjectDraftStore.getState().save("p1", {
    ...mine,
    tree: { "manifest.yaml": "mine" },
    binaryBaseline: binaries,
    binaryTree: binaries,
  });
  const theirs = {
    ...remote,
    revision: 2,
    snapshot: { ...snapshot, tree: { "manifest.yaml": "theirs" } },
  };
  vi.mocked(api.updateDraft).mockRejectedValue(
    new api.DraftApiError("draft_conflict", 409, theirs),
  );
  await syncPersistedDraft("p1");
  const local = useProjectDraftStore.getState().get("p1")!;
  expect(local.binaryBaseline).toEqual(binaries);
  expect(local.binaryTree).toEqual(binaries);
});

it("detects a revision conflict on open when another session advanced the draft", async () => {
  vi.mocked(api.listDrafts).mockResolvedValue([remote]);
  await loadPersistedDrafts("p1", "u1");
  const mine = useProjectDraftStore.getState().get("p1")!;
  useProjectDraftStore.getState().save("p1", { ...mine, tree: { "manifest.yaml": "mine" } });
  const theirs = {
    ...remote,
    revision: 2,
    snapshot: { ...snapshot, tree: { "manifest.yaml": "theirs" } },
  };
  vi.mocked(api.listDrafts).mockResolvedValue([theirs]);
  await loadPersistedDrafts("p1", "u1");
  const session = usePersistedDraftStore.getState().sessions.p1;
  expect(session?.status).toBe("conflict");
  expect(session?.draftConflict?.conflicts).toEqual([{ path: "manifest.yaml", disk: "theirs" }]);
});

it("keeps local work as a new draft when its hub draft no longer exists", async () => {
  useProjectDraftStore.getState().save("p1", {
    ...snapshot,
    remote: { id: "old-disk-draft", name: "My work", revision: 3, ownerId: "u1" },
  });
  vi.mocked(api.listDrafts).mockResolvedValue([]);
  vi.mocked(api.readDraft).mockRejectedValue(new api.DraftApiError("draft_not_found", 404));
  await loadPersistedDrafts("p1", "u1");
  expect(useProjectDraftStore.getState().get("p1")?.remote).toBeUndefined();
  expect(usePersistedDraftStore.getState().sessions.p1?.status).toBe("pending");

  vi.mocked(api.createDraft).mockImplementation(async (_p, id, name, saved) => ({
    ...remote,
    id,
    name,
    snapshot: saved,
  }));
  await syncPersistedDraft("p1");
  expect(vi.mocked(api.createDraft).mock.calls[0]?.[3].tree).toEqual(snapshot.tree);
  expect(usePersistedDraftStore.getState().sessions.p1?.status).toBe("saved");
});

it("creates the draft again when an update finds it gone", async () => {
  vi.mocked(api.listDrafts).mockResolvedValue([remote]);
  await loadPersistedDrafts("p1", "u1");
  useProjectDraftStore.getState().save("p1", {
    ...useProjectDraftStore.getState().get("p1")!,
    tree: { "manifest.yaml": "newer" },
  });
  vi.mocked(api.updateDraft).mockRejectedValue(new api.DraftApiError("draft_not_found", 404));
  vi.mocked(api.createDraft).mockImplementation(async (_p, id, name, saved) => ({
    ...remote,
    id,
    name,
    snapshot: saved,
  }));
  await syncPersistedDraft("p1");
  expect(vi.mocked(api.createDraft).mock.calls[0]?.[1]).toBe("d1");
  expect(usePersistedDraftStore.getState().sessions.p1?.status).toBe("saved");
});

it("discards a draft the hub no longer holds without failing", async () => {
  vi.mocked(api.listDrafts).mockResolvedValue([remote]);
  await loadPersistedDrafts("p1", "u1");
  vi.mocked(api.discardDraft).mockRejectedValue(new api.DraftApiError("draft_not_found", 404));
  await discardPersistedDraft("p1");
  expect(useProjectDraftStore.getState().get("p1")).toBeUndefined();
});

it("recovers a draft stuck on a pending save the hub no longer knows, and can discard it", async () => {
  const stuck = {
    ...snapshot,
    remote: {
      id: "old-disk-draft",
      name: "My work",
      revision: 3,
      ownerId: "u1",
      pendingMutation: {
        operationId: "op-old",
        kind: "save" as const,
        id: "old-disk-draft",
        name: "My work",
        revision: 3,
        snapshot,
      },
    },
  };
  useProjectDraftStore.getState().save("p1", stuck);
  vi.mocked(api.listDrafts).mockResolvedValue([]);
  vi.mocked(api.readDraft).mockRejectedValue(new api.DraftApiError("draft_not_found", 404));
  await loadPersistedDrafts("p1", "u1");
  expect(useProjectDraftStore.getState().get("p1")?.remote).toBeUndefined();
  expect(usePersistedDraftStore.getState().sessions.p1?.status).toBe("pending");

  useProjectDraftStore.getState().save("p1", stuck);
  await discardPersistedDraft("p1");
  expect(useProjectDraftStore.getState().get("p1")).toBeUndefined();
});

it("starts a new draft when the one it points at was discarded or published, keeping newer local work", async () => {
  useProjectDraftStore.getState().save("p1", {
    ...snapshot,
    tree: { "manifest.yaml": "edited after discard" },
    remote: { id: "d1", name: "My work", revision: 2, ownerId: "u1", acknowledged: "older" },
  });
  vi.mocked(api.listDrafts).mockResolvedValue([]);
  vi.mocked(api.readDraft).mockResolvedValue({ ...remote, revision: 2, status: "discarded" });
  await loadPersistedDrafts("p1", "u1");
  expect(useProjectDraftStore.getState().get("p1")?.remote).toBeUndefined();
  expect(useProjectDraftStore.getState().get("p1")?.tree["manifest.yaml"]).toBe(
    "edited after discard",
  );
  expect(usePersistedDraftStore.getState().sessions.p1?.status).toBe("pending");
});

it("never sends server metadata the editor must not see in a draft", async () => {
  useProjectDraftStore.getState().save("p1", {
    baseline: {
      "manifest.yaml": "base",
      ".artisan/project-id": "uuid\n",
      ".artisan/editor.yaml": "schema: x",
    },
    tree: {
      "manifest.yaml": "edited",
      ".artisan/project-id": "uuid\n",
      ".artisan/editor.yaml": "schema: x",
    },
    initialTree: { "manifest.yaml": "base", ".artisan/project-id": "uuid\n" },
    at: 1,
  });
  vi.mocked(api.listDrafts).mockResolvedValue([]);
  await loadPersistedDrafts("p1", "u1");
  vi.mocked(api.createDraft).mockImplementation(async (_p, id, name, saved) => ({
    ...remote,
    id,
    name,
    snapshot: saved,
  }));
  await syncPersistedDraft("p1");
  const sent = vi.mocked(api.createDraft).mock.calls[0]![3];
  expect(Object.keys(sent.baseline).sort()).toEqual([".artisan/editor.yaml", "manifest.yaml"]);
  expect(Object.keys(sent.tree).sort()).toEqual([".artisan/editor.yaml", "manifest.yaml"]);
  expect(Object.keys(sent.initialTree ?? {})).toEqual(["manifest.yaml"]);
  expect(usePersistedDraftStore.getState().sessions.p1?.status).toBe("saved");
});

it("creates a draft whose creation never landed instead of calling it a conflict", async () => {
  useProjectDraftStore.getState().save("p1", {
    ...snapshot,
    remote: { id: "never-created", name: "Brouillon", revision: 0, ownerId: "u1" },
  });
  vi.mocked(api.listDrafts).mockResolvedValue([]);
  await loadPersistedDrafts("p1", "u1");
  expect(usePersistedDraftStore.getState().sessions.p1?.status).toBe("pending");
  vi.mocked(api.createDraft).mockImplementation(async (_p, id, name, saved) => ({
    ...remote,
    id,
    name,
    snapshot: saved,
  }));
  await syncPersistedDraft("p1");
  expect(vi.mocked(api.createDraft).mock.calls[0]?.[1]).toBe("never-created");
  expect(usePersistedDraftStore.getState().sessions.p1?.status).toBe("saved");
});

it("leaves the conflict state when the conflicting draft is gone from the hub", async () => {
  useProjectDraftStore
    .getState()
    .save("p1", { ...snapshot, remote: { id: "d1", name: "My work", revision: 2, ownerId: "u1" } });
  usePersistedDraftStore.setState({
    sessions: { p1: { ownerId: "u1", drafts: [], status: "conflict" } as never },
  });
  vi.mocked(api.readDraft).mockRejectedValue(new api.DraftApiError("draft_not_found", 404));
  await syncPersistedDraft("p1");
  expect(useProjectDraftStore.getState().get("p1")?.remote).toBeUndefined();
  expect(usePersistedDraftStore.getState().sessions.p1?.status).toBe("pending");
});

it("keeps a draft whose 404 is not the draft's: the hub has no such Project", async () => {
  useProjectDraftStore
    .getState()
    .save("p1", { ...snapshot, remote: { id: "d1", name: "My work", revision: 2, ownerId: "u1" } });
  vi.mocked(api.listDrafts).mockRejectedValue(new api.DraftApiError("unknown_project", 404));
  await loadPersistedDrafts("p1", "u1");
  expect(useProjectDraftStore.getState().get("p1")?.remote?.id).toBe("d1");
  expect(usePersistedDraftStore.getState().sessions.p1?.status).toBe("rejected");
  expect(usePersistedDraftStore.getState().sessions.p1?.error).toBe("unknown_project");
});

it("does not send a refused draft again until it changes, and clears its pending mutation", async () => {
  vi.mocked(api.listDrafts).mockResolvedValue([remote]);
  await loadPersistedDrafts("p1", "u1");
  useProjectDraftStore.getState().save("p1", {
    ...useProjectDraftStore.getState().get("p1")!,
    tree: { "manifest.yaml": "my edit" },
  });
  vi.mocked(api.updateDraft).mockRejectedValue(new api.DraftApiError("forbidden", 403));
  await syncPersistedDraft("p1");
  expect(usePersistedDraftStore.getState().sessions.p1?.status).toBe("rejected");
  expect(useProjectDraftStore.getState().get("p1")?.remote?.pendingMutation).toBeUndefined();
  // The interval: nothing goes out for the same snapshot.
  await syncPersistedDraft("p1");
  expect(api.updateDraft).toHaveBeenCalledTimes(1);
  // The Save button sends it as it is.
  await syncPersistedDraft("p1", true);
  expect(api.updateDraft).toHaveBeenCalledTimes(2);
  // An edit sends it again on its own.
  vi.mocked(api.updateDraft).mockImplementation(async (_p, id, revision, name, saved) => ({
    ...remote,
    id,
    name,
    revision: revision + 1,
    snapshot: saved,
  }));
  useProjectDraftStore.getState().save("p1", {
    ...useProjectDraftStore.getState().get("p1")!,
    tree: { "manifest.yaml": "fixed" },
  });
  markDraftPending("p1");
  expect(usePersistedDraftStore.getState().sessions.p1?.status).toBe("pending");
  await syncPersistedDraft("p1");
  expect(api.updateDraft).toHaveBeenCalledTimes(3);
  expect(usePersistedDraftStore.getState().sessions.p1?.status).toBe("saved");
});

it("keeps the pending mutation and retries when the hub did not answer", async () => {
  vi.mocked(api.listDrafts).mockResolvedValue([remote]);
  await loadPersistedDrafts("p1", "u1");
  useProjectDraftStore.getState().save("p1", {
    ...useProjectDraftStore.getState().get("p1")!,
    tree: { "manifest.yaml": "my edit" },
  });
  vi.mocked(api.updateDraft).mockRejectedValue(new api.DraftApiError("storage_error", 503));
  await syncPersistedDraft("p1");
  expect(usePersistedDraftStore.getState().sessions.p1?.status).toBe("offline");
  expect(useProjectDraftStore.getState().get("p1")?.remote?.pendingMutation?.kind).toBe("save");
  await syncPersistedDraft("p1");
  expect(api.updateDraft).toHaveBeenCalledTimes(2);
});

it("starts over from the listing when a save finds the draft closed elsewhere", async () => {
  vi.mocked(api.listDrafts).mockResolvedValue([remote]);
  await loadPersistedDrafts("p1", "u1");
  useProjectDraftStore.getState().save("p1", {
    ...useProjectDraftStore.getState().get("p1")!,
    tree: { "manifest.yaml": "newer work" },
  });
  vi.mocked(api.updateDraft).mockRejectedValue(new api.DraftApiError("draft_closed", 409));
  vi.mocked(api.listDrafts).mockResolvedValue([]);
  vi.mocked(api.readDraft).mockResolvedValue({ ...remote, status: "published" });
  await syncPersistedDraft("p1");
  const session = usePersistedDraftStore.getState().sessions.p1;
  expect(session?.status).toBe("pending");
  expect(session?.draftConflict).toBeUndefined();
  // The newer work stays, as a draft to create.
  expect(useProjectDraftStore.getState().get("p1")?.remote).toBeUndefined();
  expect(useProjectDraftStore.getState().get("p1")?.tree["manifest.yaml"]).toBe("newer work");
});
