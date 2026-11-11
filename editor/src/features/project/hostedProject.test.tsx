import * as models from "@/lib/api/dataSources";
import * as drafts from "@/lib/api/projectDrafts";
import * as files from "@/lib/api/projectFiles";
import * as metadata from "@/lib/api/userProjects";
import { useAuthStore } from "@/state/authStore";
import { useProjectCacheStore } from "@/state/projectCacheStore";
import { useProjectDraftStore } from "@/state/projectDraftStore";
import { useProjectRuntimeStore } from "@/state/projectRuntimeStore";
import { useServersStore } from "@/state/serversStore";
import { act, renderHook, waitFor } from "@testing-library/react";
import { afterEach, expect, test, vi } from "vitest";
import { useProjectLoader } from "./useProjectLoader";

afterEach(() => vi.restoreAllMocks());
test("hosted project opens with zero servers and never inherits the previous live context", async () => {
  useAuthStore.setState({ currentUser: { id: "owner" } } as never);
  useServersStore.getState().setActiveServerId("stale-server");
  useProjectCacheStore.setState({ entries: {} });
  useProjectDraftStore.setState({ drafts: {}, pendingRenames: {}, ownerId: null, backups: {} });
  vi.spyOn(metadata, "loadUserProject").mockResolvedValue({
    project: { id: "host", name: "Demo", externalId: "demo", serverKeyId: null },
    serverKeyId: null,
    minecraftVersion: "1.21.4",
    capabilities: { preview: true, liveData: false, captureInGame: false, canRename: true },
    connection: { available: true },
  });
  vi.spyOn(drafts, "listDrafts").mockResolvedValue([]);
  const read = vi.spyOn(files, "readProjectFiles").mockResolvedValue({
    ok: true,
    files: { "manifest.yaml": "name: Demo\n" },
    binaries: [],
    failed: [],
    hash: "a",
  });
  const liveModels = vi.spyOn(models, "fetchServerDeclaredModels").mockResolvedValue([]);
  const { result, unmount } = renderHook(() => useProjectLoader("host"));
  await waitFor(() => expect(result.current.project?.id).toBe("host"));
  expect(result.current.offline).toBe(false);
  expect(read).toHaveBeenCalledWith("host", undefined);
  expect(liveModels).not.toHaveBeenCalled();
  expect(useServersStore.getState().activeServerId).toBeNull();
  expect(useProjectRuntimeStore.getState().current?.minecraftVersion).toBe("1.21.4");
  expect(useProjectRuntimeStore.getState().current?.capabilities).toMatchObject({
    captureInGame: false,
    liveData: false,
    preview: true,
  });
  unmount();
  vi.mocked(drafts.listDrafts).mockResolvedValue([
    {
      id: "private",
      projectId: "host",
      ownerId: "owner",
      revision: 2,
      name: "Work",
      status: "active",
      source: "editor",
      updatedAt: "now",
      snapshot: {
        at: 1,
        baseline: { "manifest.yaml": "name: Demo\n" },
        tree: { "manifest.yaml": "name: Edited\n" },
      },
    },
  ]);
  const reopened = renderHook(() => useProjectLoader("host"));
  await waitFor(() => expect(reopened.result.current.fromDraft).toBe(true));
  expect(useProjectDraftStore.getState().get("host")?.tree["manifest.yaml"]).toBe("name: Edited\n");
  expect(useServersStore.getState().activeServerId).toBeNull();
  reopened.unmount();
  await act(async () => {});
});
