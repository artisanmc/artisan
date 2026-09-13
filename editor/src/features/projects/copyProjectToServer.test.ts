import * as save from "@/features/project/saveProjectToDisk";
import { clearCopyRecovery, copyRecovery } from "@/lib/copyRecovery";
import { useAccountStore } from "@/state/accountStore";
import { useAuthStore } from "@/state/authStore";
import { useProjectDraftStore } from "@/state/projectDraftStore";
import { beforeEach, expect, test, vi } from "vitest";
import {
  copyProjectToServer,
  getPendingProjectCopy,
  resumeProjectCopy,
} from "./copyProjectToServer";

const target = {
  serverKeyId: "server-id",
  networkId: "network-id",
  name: "Minecraft",
  slug: "minecraft",
  minecraftVersion: "1.21.4",
  compatible: true,
  reason: null,
  folderName: "demo_2",
};
const completed = {
  operationId: "operation",
  state: "completed",
  sourceRevision: "saved-revision",
  targetServerKeyId: "server-id",
  folderName: "demo_2",
  projectId: "new-immutable-id",
  error: null,
};
beforeEach(() => {
  vi.restoreAllMocks();
  localStorage.clear();
  clearCopyRecovery();
  useProjectDraftStore.setState({ drafts: {}, pendingRenames: {} });
  useAuthStore.setState({ currentUser: { id: "owner" } } as never);
});
test("apply then copy waits for publication and pins the resulting saved revision", async () => {
  useProjectDraftStore.getState().save("source-id", {
    baseline: {},
    tree: { "manifest.yaml": "name: Changed" },
    initialTree: {},
    at: 1,
  });
  const project = { id: "source-id", name: "Current typing" };
  useAccountStore.setState({
    account: { id: "network-id", projects: [project], projectOrder: [] },
  } as never);
  let release!: () => void;
  const publish = vi.spyOn(save, "saveProjectToDisk").mockImplementation(async () => {
    await new Promise<void>((resolve) => {
      release = resolve;
    });
    return { ok: true, wrote: 2 };
  });
  const fetcher = vi
    .fn()
    .mockResolvedValueOnce(
      new Response(JSON.stringify({ targets: [target], sourceRevision: "applied-revision" })),
    )
    .mockResolvedValueOnce(new Response(JSON.stringify(completed)));
  vi.stubGlobal("fetch", fetcher);
  const work = copyProjectToServer({
    projectId: "source-id",
    ownerId: "owner",
    target,
    folderName: "demo_2",
    sourceRevision: "saved-revision",
    choice: "apply",
  });
  await vi.waitFor(() => expect(publish).toHaveBeenCalledWith(project));
  expect(fetcher).not.toHaveBeenCalled();
  release();
  await work;
  expect(JSON.parse(fetcher.mock.calls[1]![1].body).sourceRevision).toBe("applied-revision");
});
test("retrying Apply after a confirmed application does not attempt to publish an empty draft", async () => {
  useAccountStore.setState({
    account: { id: "network-id", projects: [{ id: "source-id" }], projectOrder: [] },
  } as never);
  const publish = vi.spyOn(save, "saveProjectToDisk").mockRejectedValue(new Error("empty_draft"));
  vi.stubGlobal(
    "fetch",
    vi
      .fn()
      .mockResolvedValueOnce(
        new Response(JSON.stringify({ targets: [target], sourceRevision: "already-applied" })),
      )
      .mockResolvedValueOnce(new Response(JSON.stringify(completed))),
  );
  await copyProjectToServer({
    projectId: "source-id",
    ownerId: "owner",
    target,
    folderName: "demo_2",
    sourceRevision: "saved-revision",
    choice: "apply",
  });
  expect(publish).not.toHaveBeenCalled();
});
test("lost acknowledgement survives refresh and retries the frozen request without creating a second copy", async () => {
  const fetcher = vi.fn().mockRejectedValueOnce(new TypeError("offline"));
  vi.stubGlobal("fetch", fetcher);
  await expect(
    copyProjectToServer({
      projectId: "source-id",
      ownerId: "owner",
      target,
      folderName: "demo_2",
      sourceRevision: "saved-revision",
      choice: "saved",
    }),
  ).rejects.toThrow("offline");
  const first = JSON.parse(fetcher.mock.calls[0]![1].body);
  copyRecovery.clear(); // new page: restore persisted choices
  fetcher.mockResolvedValueOnce(
    new Response(JSON.stringify({ error: "copy_not_found" }), { status: 404 }),
  );
  fetcher.mockResolvedValueOnce(
    new Response(JSON.stringify({ ...completed, operationId: first.operationId })),
  );
  const result = await resumeProjectCopy("owner", "source-id");
  expect(JSON.parse(fetcher.mock.calls[2]![1].body)).toEqual(first);
  expect(result.operation.projectId).toBe("new-immutable-id");
});
test("copies the selected saved revision as one operation without publishing the source", async () => {
  const requests: { url: string; body: unknown }[] = [];
  vi.stubGlobal(
    "fetch",
    vi.fn(async (url, init) => {
      requests.push({ url: String(url), body: init?.body && JSON.parse(init.body) });
      return new Response(JSON.stringify(completed));
    }),
  );
  const result = await copyProjectToServer({
    projectId: "source-id",
    ownerId: "owner",
    target,
    folderName: "demo_2",
    sourceRevision: "saved-revision",
    choice: "saved",
  });
  expect(result.operation.projectId).toBe("new-immutable-id");
  expect(requests).toHaveLength(1);
  expect(requests[0]?.url).toContain("/user/projects/source-id/copies");
  expect(requests[0]?.body).toMatchObject({
    targetServerKeyId: "server-id",
    folderName: "demo_2",
    sourceRevision: "saved-revision",
    operationId: expect.any(String),
  });
  expect(getPendingProjectCopy("owner", "source-id")?.operation.projectId).toBe("new-immutable-id");
});
test.each([
  ["source_revision_changed", 409],
  ["too_large", 409],
  ["invalid_path", 422],
  ["invalid_input", 422],
] as const)("definitive preflight %s releases its choices", async (code, status) => {
  vi.stubGlobal(
    "fetch",
    vi.fn().mockResolvedValue(new Response(JSON.stringify({ error: code }), { status })),
  );
  await expect(
    copyProjectToServer({
      projectId: "source-id",
      ownerId: "owner",
      target,
      folderName: "demo_2",
      sourceRevision: "saved-revision",
      choice: "saved",
    }),
  ).rejects.toThrow(code);
  expect(getPendingProjectCopy("owner", "source-id")).toBeNull();
});
test("logout and login as the same owner cancels a deferred acknowledgement without repopulating recovery", async () => {
  let resolve!: (response: Response) => void;
  vi.stubGlobal(
    "fetch",
    vi.fn(
      () =>
        new Promise<Response>((done) => {
          resolve = done;
        }),
    ),
  );
  const work = copyProjectToServer({
    projectId: "source-id",
    ownerId: "owner",
    target,
    folderName: "demo_2",
    sourceRevision: "saved-revision",
    choice: "saved",
  });
  useAuthStore.setState({ currentUser: null });
  useAuthStore.setState({ currentUser: { id: "owner" } } as never);
  resolve(new Response(JSON.stringify(completed)));
  await expect(work).rejects.toThrow("session_changed");
  expect(getPendingProjectCopy("owner", "source-id")).toBeNull();
});
test.each(["pending", "completed"])(
  "a known %s operation resumes by its ID without changing target or revision",
  async (state) => {
    const fetcher = vi.fn().mockRejectedValueOnce(new TypeError("offline"));
    vi.stubGlobal("fetch", fetcher);
    await expect(
      copyProjectToServer({
        projectId: "source-id",
        ownerId: "owner",
        target,
        folderName: "demo_2",
        sourceRevision: "saved-revision",
        choice: "saved",
      }),
    ).rejects.toThrow();
    const request = getPendingProjectCopy("owner", "source-id")!.request;
    fetcher.mockResolvedValueOnce(
      new Response(
        JSON.stringify({
          ...completed,
          ...request,
          state,
          error: state === "completed" ? "resource_pack_pending" : null,
        }),
      ),
    );
    fetcher.mockResolvedValueOnce(new Response(JSON.stringify({ ...completed, ...request })));
    await resumeProjectCopy("owner", "source-id");
    expect(fetcher.mock.calls[2]![0]).toContain(`/copies/${request.operationId}/resume`);
    expect(fetcher.mock.calls[2]![1].body).toBeUndefined();
  },
);
test("incompatible targets cannot submit a transfer", async () => {
  const fetcher = vi.fn();
  vi.stubGlobal("fetch", fetcher);
  await expect(
    copyProjectToServer({
      projectId: "source-id",
      ownerId: "owner",
      target: { ...target, compatible: false, reason: "incompatible_version" },
      folderName: "demo_2",
      sourceRevision: "saved-revision",
      choice: "saved",
    }),
  ).rejects.toThrow("incompatible_version");
  expect(fetcher).not.toHaveBeenCalled();
});
