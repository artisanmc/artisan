import * as api from "@/lib/api/projectDrafts";
import { useAccountStore } from "@/state/accountStore";
import { useAuthStore } from "@/state/authStore";
import { useDemoStore } from "@/state/demoStore";
import { useProjectBaselineStore } from "@/state/projectBaselineStore";
import { useProjectDraftStore } from "@/state/projectDraftStore";
import { beforeEach, expect, test, vi } from "vitest";
import {
  mutateDraftAssets,
  syncPersistedDraft,
  usePersistedDraftStore,
  waitForDraftWrites,
} from "./persistedDrafts";

const snapshot = { baseline: {}, tree: { "menus/a.yaml": "before" }, at: 1 };
const draft = {
  id: "draft",
  projectId: "project",
  ownerId: "owner",
  name: "Work",
  revision: 1,
  snapshot,
  status: "active",
  source: "editor",
  updatedAt: "now",
};
const input = {
  suffix: "",
  method: "POST",
  fields: { type: "texture", name: "Image" },
  file: { name: "a.png", type: "image/png", base64: "AP8=" },
};
beforeEach(() => {
  vi.restoreAllMocks();
  useAuthStore.setState({ currentUser: { id: "owner" } } as never);
  useAccountStore.setState({ account: { id: "network", projects: [], projectOrder: [] } } as never);
  useProjectDraftStore.setState({ drafts: {}, ownerId: "owner", pendingRenames: {}, backups: {} });
  useProjectDraftStore.getState().save("project", {
    ...snapshot,
    remote: { id: "draft", ownerId: "owner", name: "Work", revision: 1 },
  });
  usePersistedDraftStore.setState({
    sessions: { project: { ownerId: "owner", drafts: [draft], active: draft, status: "saved" } },
  });
  vi.spyOn(api, "updateDraft").mockResolvedValue(draft);
});
test("a late guest rejection cannot clear an asset intent remapped to the account", async () => {
  useDemoStore.getState().setSession({
    principal: { kind: "guest", id: "owner" },
    projectId: "project",
    csrfToken: "csrf",
    expiresAt: "2099-01-01",
  });
  let reject!: (error: Error) => void;
  const perform = vi.fn(
    () =>
      new Promise<{ draft: typeof draft }>((_, fail) => {
        reject = fail;
      }),
  );
  const saving = mutateDraftAssets("project", input, perform);
  const rejected = expect(saving).rejects.toThrow("claim_pending");
  await vi.waitFor(() => expect(perform).toHaveBeenCalledOnce());
  const local = useProjectDraftStore.getState().get("project")!;
  useDemoStore.getState().setSession(null);
  useAuthStore.setState({ currentUser: { id: "account" } } as never);
  useProjectDraftStore.setState({
    ownerId: "account",
    drafts: { project: { ...local, remote: { ...local.remote!, ownerId: "account" } } },
  });
  usePersistedDraftStore.setState({
    sessions: { project: { ownerId: "account", drafts: [], status: "pending" } },
  });
  reject(new api.DraftApiError("claim_pending", 409));
  await rejected;
  expect(
    useProjectDraftStore.getState().get("project")?.remote?.pendingMutation?.asset?.file?.base64,
  ).toBe("AP8=");
  expect(usePersistedDraftStore.getState().sessions.project?.ownerId).toBe("account");
});
test.each([{}, { "manifest.yaml": "name: Demo" }])(
  "first asset action materializes a clean private draft: %j",
  async (tree) => {
    useProjectDraftStore.setState({ drafts: {} });
    useProjectBaselineStore.getState().set("project", tree);
    usePersistedDraftStore.setState({
      sessions: { project: { ownerId: "owner", drafts: [], status: "saved" } },
    });
    const create = vi
      .spyOn(api, "createDraft")
      .mockImplementation(async (_project, id, name, fresh) => ({
        ...draft,
        id,
        name,
        snapshot: fresh,
      }));
    const perform = vi.fn(async (operation) => ({
      draft: {
        ...draft,
        id: operation.id,
        revision: 2,
        snapshot: { ...operation.snapshot, tree: { ...tree, "assets/a.yaml": "image" } },
      },
    }));
    await mutateDraftAssets("project", input, perform);
    expect(create).toHaveBeenCalledTimes(1);
    expect(perform).toHaveBeenCalledTimes(1);
    expect(useProjectDraftStore.getState().get("project")?.tree["assets/a.yaml"]).toBe("image");
    expect(useProjectBaselineStore.getState().get("project")).toEqual(tree);
  },
);

test("private upload blocks autosave and preserves text typed while its ACK is pending", async () => {
  let finish!: (result: { draft: typeof draft }) => void;
  let started!: () => void;
  const ready = new Promise<void>((resolve) => {
    started = resolve;
  });
  const saving = mutateDraftAssets("project", input, async () => {
    started();
    return new Promise((resolve) => {
      finish = resolve;
    });
  });
  await ready;
  let writesFinished = false;
  const idle = waitForDraftWrites("project").then(() => {
    writesFinished = true;
  });
  await Promise.resolve();
  expect(writesFinished).toBe(false);
  const beforeCalls = vi.mocked(api.updateDraft).mock.calls.length;
  const local = useProjectDraftStore.getState().get("project")!;
  useProjectDraftStore.getState().save("project", { ...local, tree: { "menus/a.yaml": "later" } });
  await syncPersistedDraft("project");
  expect(api.updateDraft).toHaveBeenCalledTimes(beforeCalls);
  finish({
    draft: {
      ...draft,
      revision: 2,
      snapshot: { ...snapshot, tree: { ...snapshot.tree, "assets/image.yaml": "name: Image" } },
    },
  });
  await saving;
  await idle;
  expect(writesFinished).toBe(true);
  expect(useProjectDraftStore.getState().get("project")).toMatchObject({
    tree: { "menus/a.yaml": "later", "assets/image.yaml": "name: Image" },
    remote: { revision: 2 },
  });
});
test("uncertain upload ACK retains the same operation, snapshot and bytes on retry", async () => {
  const operations: unknown[] = [];
  await expect(
    mutateDraftAssets("project", input, async (operation) => {
      operations.push(operation);
      throw new TypeError("offline");
    }),
  ).rejects.toThrow("offline");
  await mutateDraftAssets("project", input, async (operation) => {
    operations.push(operation);
    return { draft: { ...draft, revision: 2 } };
  });
  expect(operations[1]).toEqual(operations[0]);
  expect(useProjectDraftStore.getState().get("project")?.remote?.pendingMutation).toBeUndefined();
});
test("another tab's revision conflict preserves local edits and exposes reconciliation", async () => {
  const current = {
    ...draft,
    revision: 3,
    snapshot: { ...snapshot, tree: { "menus/a.yaml": "other tab" } },
  };
  await expect(
    mutateDraftAssets("project", input, async () => {
      throw new api.DraftApiError("draft_conflict", 409, current);
    }),
  ).rejects.toThrow();
  expect(useProjectDraftStore.getState().get("project")?.tree).toEqual(snapshot.tree);
  expect(useProjectDraftStore.getState().get("project")?.remote?.pendingMutation).toBeUndefined();
  expect(usePersistedDraftStore.getState().sessions.project?.status).toBe("conflict");
});
