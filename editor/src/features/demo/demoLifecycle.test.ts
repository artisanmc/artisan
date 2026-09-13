import { usePersistedDraftStore } from "@/features/project/persistedDrafts";
import type { PersistedDraft } from "@/lib/api/projectDrafts";
import { useAuthStore } from "@/state/authStore";
import { useDemoStore } from "@/state/demoStore";
import { useProjectDraftStore } from "@/state/projectDraftStore";
import { afterEach, beforeEach, expect, test, vi } from "vitest";
import { bootstrapDemo, finishDemoClaim, getPendingDemoClaim } from "./demoLifecycle";
vi.mock("@/state/accountStore", () => ({
  useAccountStore: { getState: () => ({ setAccount: vi.fn() }) },
}));
const session = {
  principal: { kind: "guest" as const, id: "guest" },
  projectId: "demo",
  expiresAt: "later",
  csrfToken: "csrf",
};
test("an explicit new demo can replace expired proof, but reading cannot", async () => {
  const fetcher = vi
    .fn()
    .mockResolvedValueOnce(
      new Response(JSON.stringify({ error: "demo_expired" }), { status: 410 }),
    );
  vi.stubGlobal("fetch", fetcher);
  await expect(bootstrapDemo(false)).rejects.toThrow("demo_expired");
  fetcher.mockResolvedValueOnce(
    new Response(JSON.stringify({ error: "demo_expired" }), { status: 410 }),
  );
  fetcher.mockResolvedValueOnce(new Response(JSON.stringify(session)));
  expect(await bootstrapDemo(true)).toEqual(session);
  expect(fetcher.mock.calls[2]![1].method).toBe("POST");
});
beforeEach(() => {
  sessionStorage.clear();
  useDemoStore.getState().setSession(session);
  useAuthStore.setState({ currentUser: { id: "owner" } } as never);
  useProjectDraftStore.setState({ ownerId: "guest", drafts: {}, backups: {}, pendingRenames: {} });
  usePersistedDraftStore.setState({
    sessions: { demo: { ownerId: "guest", drafts: [], status: "saved" } },
  });
});
afterEach(() => {
  vi.unstubAllGlobals();
  useDemoStore.getState().setSession(null);
});
test("claim after sign-up waits for the guest draft session to load and confirm its text and PNG", async () => {
  const snapshot = {
    baseline: {},
    initialTree: {},
    tree: { "lang/fr.yaml": "title: Deuxième titre" },
    binaryTree: { "assets/image.png": { hash: "image-hash", size: 70 } },
    at: 1,
  };
  const draft: PersistedDraft = {
    id: "private",
    projectId: "demo",
    ownerId: "guest",
    name: "Draft",
    revision: 3,
    status: "active",
    source: "editor",
    updatedAt: "",
    snapshot,
  };
  useProjectDraftStore.getState().save("demo", {
    ...snapshot,
    remote: { id: draft.id, name: draft.name, ownerId: "guest", revision: 3 },
  });
  useProjectDraftStore.getState().setOwner("owner");
  usePersistedDraftStore.setState({ sessions: {} });
  let releaseList!: (response: Response) => void;
  const fetcher = vi.fn((url: string, init: RequestInit) => {
    if (url.endsWith("/drafts") && init.method === "GET")
      return new Promise<Response>((resolve) => {
        releaseList = resolve;
      });
    if (init.method === "PUT")
      return Promise.resolve(
        new Response(
          JSON.stringify({
            draft: { ...draft, revision: 4, snapshot: JSON.parse(init.body as string).snapshot },
          }),
        ),
      );
    return Promise.resolve(
      new Response(JSON.stringify({ projectId: "demo", networkId: "network" })),
    );
  });
  vi.stubGlobal("fetch", fetcher);
  let outcome: unknown;
  const claiming = finishDemoClaim("network").then(
    (value) => {
      outcome = value;
    },
    (error) => {
      outcome = error.message;
    },
  );
  await vi.waitFor(() =>
    expect(fetcher).toHaveBeenCalledWith(
      expect.stringMatching(/\/drafts$/),
      expect.objectContaining({ method: "GET" }),
    ),
  );
  expect(outcome).toBeUndefined();
  expect(fetcher.mock.calls.some(([url]) => url.endsWith("/demo/claim"))).toBe(false);
  releaseList(new Response(JSON.stringify({ drafts: [draft] })));
  await claiming;
  expect(outcome).toEqual({ projectId: "demo", networkId: "network" });
  expect(
    fetcher.mock.calls.map(([url, init]) => [
      url.endsWith("/demo/claim") ? "claim" : "draft",
      init.method,
    ]),
  ).toEqual([
    ["draft", "GET"],
    ["draft", "PUT"],
    ["claim", "POST"],
  ]);
  expect(useProjectDraftStore.getState().get("demo")).toMatchObject({
    tree: snapshot.tree,
    binaryTree: snapshot.binaryTree,
    remote: { ownerId: "owner", revision: 4 },
  });
});
test("a direct reload cannot claim while loading its draft session is unavailable", async () => {
  usePersistedDraftStore.setState({ sessions: {} });
  const fetcher = vi
    .fn()
    .mockResolvedValue(new Response(JSON.stringify({ error: "network_error" }), { status: 503 }));
  vi.stubGlobal("fetch", fetcher);
  await expect(finishDemoClaim("network")).rejects.toThrow("draft_not_confirmed");
  expect(fetcher).toHaveBeenCalledOnce();
  expect(fetcher.mock.calls[0]![0]).toMatch(/\/drafts$/);
  expect(getPendingDemoClaim()).toBeNull();
});
test("a lost claim acknowledgement retries the same operation and target after refresh", async () => {
  const fetcher = vi.fn().mockRejectedValueOnce(new TypeError("offline"));
  vi.stubGlobal("fetch", fetcher);
  await expect(finishDemoClaim("network")).rejects.toThrow("offline");
  const first = JSON.parse(fetcher.mock.calls[0]![1].body);
  expect(first.projectId).toBe("demo");
  expect(getPendingDemoClaim()?.operationId).toBe(first.operationId);
  useDemoStore.getState().setSession(null);
  fetcher.mockResolvedValueOnce(
    new Response(JSON.stringify({ projectId: "demo", networkId: "network" })),
  );
  expect(await finishDemoClaim()).toEqual({ projectId: "demo", networkId: "network" });
  expect(JSON.parse(fetcher.mock.calls[1]![1].body)).toEqual(first);
  expect(getPendingDemoClaim()).toBeNull();
});
test("claim preserves text and binary edits arriving before its acknowledgement", async () => {
  let resolve!: (response: Response) => void;
  const fetcher = vi.fn(
    () =>
      new Promise<Response>((r) => {
        resolve = r;
      }),
  );
  vi.stubGlobal("fetch", fetcher);
  const claim = finishDemoClaim("network");
  await vi.waitFor(() => expect(fetcher).toHaveBeenCalledOnce());
  useProjectDraftStore.getState().save("demo", {
    baseline: {},
    tree: { "menus/menu.yaml": "late typing" },
    binaryTree: { "assets/image.png": { hash: "png", size: 10 } },
    at: 1,
    remote: {
      id: "draft",
      name: "Draft",
      revision: 2,
      ownerId: "guest",
      pendingMutation: {
        id: "draft",
        name: "Draft",
        revision: 2,
        operationId: "late-asset",
        kind: "asset",
        asset: {
          suffix: "",
          method: "POST",
          fields: {},
          file: { name: "image.png", type: "image/png", base64: "retained-bytes" },
        },
      },
    },
  });
  resolve(new Response(JSON.stringify({ projectId: "demo", networkId: "network" })));
  await claim;
  expect(useProjectDraftStore.getState().ownerId).toBe("owner");
  expect(useProjectDraftStore.getState().get("demo")).toMatchObject({
    tree: { "menus/menu.yaml": "late typing" },
    binaryTree: { "assets/image.png": { hash: "png" } },
    remote: {
      id: "draft",
      ownerId: "owner",
      revision: 2,
      pendingMutation: { operationId: "late-asset", asset: { file: { base64: "retained-bytes" } } },
    },
  });
});
test("logout and same-account login cannot repopulate private state from a stale claim", async () => {
  let resolve!: (response: Response) => void;
  const fetcher = vi.fn(
    () =>
      new Promise<Response>((r) => {
        resolve = r;
      }),
  );
  vi.stubGlobal("fetch", fetcher);
  const claim = finishDemoClaim("network");
  const rejection = expect(claim).rejects.toThrow("session_changed");
  await vi.waitFor(() => expect(fetcher).toHaveBeenCalledOnce());
  useAuthStore.setState({ currentUser: null });
  useAuthStore.setState({ currentUser: { id: "owner" } } as never);
  resolve(new Response(JSON.stringify({ projectId: "demo", networkId: "network" })));
  await rejection;
  expect(getPendingDemoClaim()).not.toBeNull();
  expect(useDemoStore.getState().session?.principal.id).toBe("guest");
});
test("revoked claim destination permits an explicit new operation on a different Network", async () => {
  const fetcher = vi
    .fn()
    .mockResolvedValueOnce(
      new Response(JSON.stringify({ error: "claim_target_unavailable" }), { status: 409 }),
    );
  vi.stubGlobal("fetch", fetcher);
  await expect(finishDemoClaim("revoked")).rejects.toThrow("claim_target_unavailable");
  const first = getPendingDemoClaim()!;
  expect(first.blocked).toBe(true);
  fetcher.mockResolvedValueOnce(
    new Response(JSON.stringify({ projectId: "demo", networkId: "allowed" })),
  );
  await finishDemoClaim("allowed");
  const second = JSON.parse(fetcher.mock.calls[1]![1].body);
  expect(second.operationId).not.toBe(first.operationId);
  expect(second.networkId).toBe("allowed");
});
