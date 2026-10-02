import * as drafts from "@/lib/api/projectDrafts";
import * as files from "@/lib/api/projectFiles";
import * as metadata from "@/lib/api/userProjects";
import { useAccountStore } from "@/state/accountStore";
import { useAuthStore } from "@/state/authStore";
import { useDemoStore } from "@/state/demoStore";
import { useProjectDraftStore } from "@/state/projectDraftStore";
import { act, cleanup, renderHook, waitFor } from "@testing-library/react";
import { afterEach, expect, test, vi } from "vitest";
import fixture from "../../../../backend/src/templates/demo-project.json";
import { syncPersistedDraft, usePersistedDraftStore } from "./persistedDrafts";
import { useDraftSync } from "./useDraftSync";
import { useProjectLoader } from "./useProjectLoader";
afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
  useDemoStore.getState().setSession(null);
});
test("a cookie-authorized demo opens through the shared loader without a user or Network", async () => {
  useAuthStore.setState({ currentUser: null });
  useDemoStore.getState().setSession({
    principal: { kind: "guest", id: "guest" },
    projectId: "demo",
    csrfToken: "csrf",
    expiresAt: "later",
  });
  useProjectDraftStore.setState({ ownerId: null, drafts: {}, backups: {}, pendingRenames: {} });
  vi.spyOn(metadata, "loadUserProject").mockResolvedValue({
    project: { id: "demo", name: "Demo" },
    networkId: null,
    serverKeyId: null,
    capabilities: {
      canRename: false,
      canUseAssistant: false,
      liveData: false,
      captureInGame: false,
      preview: true,
    },
  });
  vi.spyOn(files, "readProjectFiles").mockResolvedValue({
    ok: true,
    files: { "manifest.yaml": "name: Demo" },
    failed: [],
    binaries: [],
    hash: "saved",
  });
  vi.spyOn(drafts, "listDrafts").mockResolvedValue([]);
  const { result } = renderHook(() => useProjectLoader("demo"));
  await waitFor(() => expect(result.current.project?.id).toBe("demo"));
  expect(result.current.networkId).toBeNull();
  expect(useProjectDraftStore.getState().ownerId).toBe("guest");
});
test("the same opaque guest owner can create and update its private draft repeatedly", async () => {
  useAuthStore.setState({ currentUser: null });
  useDemoStore.getState().setSession({
    principal: { kind: "guest", id: "demo_owner" },
    projectId: "demo",
    csrfToken: "csrf",
    expiresAt: "2099-01-01",
  });
  useProjectDraftStore.setState({
    ownerId: "demo_owner",
    drafts: {
      demo: { baseline: {}, initialTree: {}, tree: { "manifest.yaml": "name: First" }, at: 1 },
    },
    backups: {},
    pendingRenames: {},
  });
  usePersistedDraftStore.setState({
    sessions: { demo: { ownerId: "demo_owner", drafts: [], status: "pending" } },
  });
  const create = vi
    .spyOn(drafts, "createDraft")
    .mockImplementation(async (projectId, id, name, snapshot) => ({
      projectId,
      id,
      name,
      snapshot,
      ownerId: "demo_owner",
      revision: 1,
      status: "active",
      source: "editor",
      updatedAt: "",
    }));
  const update = vi
    .spyOn(drafts, "updateDraft")
    .mockImplementation(async (projectId, id, revision, name, snapshot) => ({
      projectId,
      id,
      name,
      snapshot,
      ownerId: "demo_owner",
      revision: revision + 1,
      status: "active",
      source: "editor",
      updatedAt: "",
    }));
  await syncPersistedDraft("demo");
  const first = useProjectDraftStore.getState().get("demo")!;
  useProjectDraftStore
    .getState()
    .save("demo", { ...first, tree: { "manifest.yaml": "name: Second" } });
  await syncPersistedDraft("demo");
  expect(create).toHaveBeenCalledOnce();
  expect(update).toHaveBeenCalledOnce();
  expect(useProjectDraftStore.getState().get("demo")?.remote).toMatchObject({
    ownerId: "demo_owner",
    revision: 2,
  });
});
test("the mounted guest loader and root autosave persist two successive French item-title changes", async () => {
  useAuthStore.setState({ currentUser: null });
  useDemoStore.getState().setSession({
    principal: { kind: "guest", id: "demo_owner" },
    projectId: "demo",
    csrfToken: "csrf",
    expiresAt: "2099-01-01",
  });
  useDemoStore.getState().setActive(true);
  useProjectDraftStore.setState({
    ownerId: "demo_owner",
    drafts: {},
    backups: {},
    pendingRenames: {},
  });
  usePersistedDraftStore.setState({ sessions: {} });
  vi.spyOn(metadata, "loadUserProject").mockResolvedValue({
    project: { id: "demo", name: "Demo" },
    networkId: null,
    serverKeyId: null,
  });
  vi.spyOn(files, "readProjectFiles").mockResolvedValue({
    ok: true,
    files: fixture,
    failed: [],
    binaries: [],
    hash: "initial",
  });
  vi.spyOn(drafts, "listDrafts").mockResolvedValue([]);
  const create = vi
    .spyOn(drafts, "createDraft")
    .mockImplementation(async (projectId, id, name, snapshot) => ({
      projectId,
      id,
      name,
      snapshot,
      ownerId: "demo_owner",
      revision: 1,
      status: "active",
      source: "editor",
      updatedAt: "",
    }));
  const update = vi
    .spyOn(drafts, "updateDraft")
    .mockImplementation(async (projectId, id, revision, name, snapshot) => ({
      projectId,
      id,
      name,
      snapshot,
      ownerId: "demo_owner",
      revision: revision + 1,
      status: "active",
      source: "editor",
      updatedAt: "",
    }));
  const { result } = renderHook(() => {
    useDraftSync();
    return useProjectLoader("demo");
  });
  await waitFor(() => expect(result.current.project?.menus.length).toBe(1));
  await waitFor(() => expect(useProjectDraftStore.getState().get("demo")).toBeDefined());
  const edit = (value: string) =>
    act(() =>
      useAccountStore.getState().setAppearanceTitle({
        projectId: "demo",
        menuId: "welcome",
        elementId: "explore",
        lang: "fr",
        value,
      } as never),
    );
  edit("Premier titre");
  await waitFor(() => expect(create).toHaveBeenCalledOnce(), { timeout: 4000 });
  edit("Deuxième titre");
  await waitFor(() => expect(update).toHaveBeenCalledOnce(), { timeout: 4000 });
  // Structural text is field-local — the edited title lands in the menu document.
  expect(update.mock.calls[0]![4].tree["menus/welcome.yaml"]).toContain("Deuxième titre");
});
