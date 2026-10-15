import * as dataSourcesApi from "@/lib/api/dataSources";
import * as declaredActionsApi from "@/lib/api/declaredActions";
import * as draftsApi from "@/lib/api/projectDrafts";
import * as projectFilesApi from "@/lib/api/projectFiles";
import * as userProjectsApi from "@/lib/api/userProjects";
import { useAuthStore } from "@/state/authStore";
import { useProjectBaselineStore } from "@/state/projectBaselineStore";
import { projectCacheKey, useProjectCacheStore } from "@/state/projectCacheStore";
import { useProjectDraftStore } from "@/state/projectDraftStore";
import { act, renderHook, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { useProjectLoader } from "./useProjectLoader";

describe("useProjectLoader", () => {
  afterEach(() => vi.useRealTimers());
  beforeEach(() => {
    vi.restoreAllMocks();
    vi.spyOn(draftsApi, "listDrafts").mockResolvedValue([]);
    // Like the models, the server's declared actions are fetched at build: never the network here.
    vi.spyOn(declaredActionsApi, "fetchServerDeclaredActions").mockResolvedValue([]);
    useAuthStore.setState({ currentUser: null } as never);
    useProjectCacheStore.setState({ entries: {} } as never);
    useProjectDraftStore.setState({ drafts: {}, pendingRenames: {}, ownerId: null, backups: {} });
  });

  it("waits for Minecraft before opening a persisted draft", async () => {
    useAuthStore.setState({ currentUser: { id: "u1" } } as never);
    vi.spyOn(userProjectsApi, "loadUserProject").mockResolvedValue({
      project: { id: "p1", name: "Shop", externalId: "shop" },
      networkId: "net_1",
      serverKeyId: "sk_1",
    } as never);
    const baseline = { "manifest.yaml": "id: shop\nname: Original\n" };
    const tree = { "manifest.yaml": "id: shop\nname: Backend draft\n" };
    vi.mocked(draftsApi.listDrafts).mockResolvedValue([
      {
        id: "d1",
        ownerId: "u1",
        name: "Work",
        revision: 1,
        status: "active",
        snapshot: { baseline, tree, at: 1 },
      },
    ] as never);
    vi.spyOn(projectFilesApi, "readProjectFiles").mockReturnValue(new Promise(() => {}));
    const { result } = renderHook(() => useProjectLoader("p1"));
    await act(async () => {});
    expect(result.current.project).toBeNull();
    expect(result.current.urlId).toBe("shop");
  });

  it("isolates identical folder names by server and never exposes the previous project during navigation", async () => {
    useAuthStore.setState({ currentUser: { id: "u1" } } as never);
    vi.spyOn(dataSourcesApi, "fetchServerDeclaredModels").mockResolvedValue([]);
    const load = vi.spyOn(userProjectsApi, "loadUserProject").mockImplementation(async (_ref, server) => ({
      project: { id: `internal-${server}`, name: "Shared", externalId: "shared" }, networkId: "local", serverKeyId: server!,
    }));
    const read = vi.spyOn(projectFilesApi, "readProjectFiles").mockResolvedValue({ ok: true, files: { "manifest.yaml": "schema: manifest/v2\n" }, failed: [], hash: "first-hash" });
    const { result, rerender } = renderHook(({ server }) => useProjectLoader("shared", server), { initialProps: { server: "first" } });
    await waitFor(() => expect(result.current.project?.id).toBe("internal-first"));
    read.mockReturnValue(new Promise(() => {}));
    rerender({ server: "second" });
    expect(result.current.project).toBeNull();
    await waitFor(() => expect(load).toHaveBeenCalledWith("shared", "second"));
    expect(read).toHaveBeenLastCalledWith("internal-second", undefined);
  });

  it("loads the content from the server's DISK, not from the backend", async () => {
    useAuthStore.setState({ currentUser: { id: "u1", name: "x", email: "x@a.b" } } as never);
    vi.spyOn(userProjectsApi, "loadUserProject").mockResolvedValue({
      project: { id: "p1", name: "p", hash: "h", externalId: "boutique_shop" },
      networkId: "net_1",
      serverKeyId: "sk_1",
    } as never);
    const readSpy = vi.spyOn(projectFilesApi, "readProjectFiles").mockResolvedValue({
      ok: true,
      files: { "manifest.yaml": "id: boutique_shop\n" },
      failed: [],
    });

    const { result } = renderHook(() => useProjectLoader("p1"));

    await waitFor(() => expect(result.current.project).not.toBeNull());
    expect(result.current.error).toBeNull();
    // Read under the disk id, from the owning server. With no known version,
    // there is no fingerprint to announce: the server sends the tree.
    expect(readSpy).toHaveBeenCalledWith("p1", undefined);
    // What was read becomes the compare-and-swap base.
    expect(useProjectBaselineStore.getState().get("p1")).toEqual({
      "manifest.yaml": "id: boutique_shop\n",
    });
  });

  it("server down with a backend copy: open, dated, offline", async () => {
    useAuthStore.setState({ currentUser: { id: "u1", name: "x", email: "x@a.b" } } as never);
    vi.spyOn(userProjectsApi, "loadUserProject").mockResolvedValue({
      project: { id: "p1", name: "p", hash: "h", externalId: "boutique_shop" },
      networkId: "net_1",
      serverKeyId: "sk_1",
    } as never);
    vi.spyOn(projectFilesApi, "readProjectFiles").mockResolvedValue({
      ok: true,
      files: { "manifest.yaml": "id: boutique_shop\n" },
      failed: [],
      hash: "H1",
      offlineSince: "2026-09-27T08:00:00.000Z",
    });

    const { result, unmount } = renderHook(() => useProjectLoader("p1"));

    await waitFor(() => expect(result.current.project).not.toBeNull());
    expect(result.current.offline).toBe(true);
    expect(result.current.stale).toBe(true);
    expect(result.current.offlineSince).toBe("2026-09-27T08:00:00.000Z");
    expect(result.current.error).toBeNull();
    unmount();
  });

  it("never published: opened from the draft, server not connected announced", async () => {
    useAuthStore.setState({ currentUser: { id: "u1", name: "x", email: "x@a.b" } } as never);
    vi.spyOn(userProjectsApi, "loadUserProject").mockResolvedValue({
      project: { id: "p1", name: "prepare", hash: "h", externalId: "prepare" },
      networkId: "net_1",
      serverKeyId: "sk_1",
    } as never);
    vi.spyOn(projectFilesApi, "readProjectFiles").mockResolvedValue({
      ok: true,
      files: {},
      failed: [],
      hash: "unpublished",
      unpublished: true,
      offlineSince: "2026-09-27T08:00:00.000Z",
    });
    vi.mocked(draftsApi.listDrafts).mockResolvedValue([
      {
        id: "d1",
        projectId: "p1",
        ownerId: "u1",
        name: "prepare",
        revision: 1,
        status: "active",
        source: "editor",
        updatedAt: "now",
        snapshot: { baseline: {}, tree: { "manifest.yaml": "id: prepare\nname: prepare\n" }, at: 1 },
      },
    ]);

    const { result, unmount } = renderHook(() => useProjectLoader("p1"));

    await waitFor(() => expect(result.current.project).not.toBeNull());
    expect(result.current.unpublished).toBe(true);
    expect(result.current.offline).toBe(true);
    expect(result.current.fromDraft).toBe(true);
    unmount();
  });

  it("server offline: no fallback, the Project cannot be opened", async () => {
    useAuthStore.setState({ currentUser: { id: "u1", name: "x", email: "x@a.b" } } as never);
    vi.spyOn(userProjectsApi, "loadUserProject").mockResolvedValue({
      project: { id: "p1", name: "p", hash: "h" },
      networkId: "net_1",
      serverKeyId: "sk_1",
    } as never);
    vi.spyOn(projectFilesApi, "readProjectFiles").mockResolvedValue({
      ok: false,
      error: "server_offline",
    });

    const { result } = renderHook(() => useProjectLoader("p1"));

    await waitFor(() => expect(result.current.offline).toBe(true));
    expect(result.current.project).toBeNull();
  });

  /**
   * The server's disk is far away: several seconds of waiting on every open,
   * for content almost always identical to the previous visit. So what we had
   * is shown right away and revalidated behind — without ever passing the cache
   * off as the truth (`stale`).
   */
  it("keeps the cached project closed until the server responds", async () => {
    useAuthStore.setState({ currentUser: { id: "u1", name: "x", email: "x@a.b" } } as never);
    useProjectCacheStore.getState().put(projectCacheKey("p1", undefined, "u1"), {
      identity: {
        project: { id: "p1", name: "p", hash: "h", externalId: "boutique_shop" },
        networkId: "net_1",
        serverKeyId: "sk_1",
      },
      diskId: "boutique_shop",
      tree: { "manifest.yaml": "id: boutique_shop\n" },
      fetchedAt: new Date().toISOString(),
    } as never);

    vi.spyOn(userProjectsApi, "loadUserProject").mockResolvedValue({
      project: { id: "p1", name: "p", hash: "h", externalId: "boutique_shop" },
      networkId: "net_1",
      serverKeyId: "sk_1",
    } as never);
    // The disk read does not answer right away: exactly the window during which
    // the screen stayed empty.
    let release: (v: unknown) => void = () => {};
    vi.spyOn(projectFilesApi, "readProjectFiles").mockReturnValue(
      new Promise((r) => {
        release = r;
      }) as never,
    );

    const { result } = renderHook(() => useProjectLoader("p1"));

    await act(async () => {});
    expect(result.current.project).toBeNull();

    release({
      ok: true,
      files: { "manifest.yaml": "id: boutique_shop\nname: frais\n" },
      failed: [],
    });
    await waitFor(() => expect(result.current.project).not.toBeNull());
  });

  it("what the server returned becomes the known version", async () => {
    useAuthStore.setState({ currentUser: { id: "u1", name: "x", email: "x@a.b" } } as never);
    vi.spyOn(userProjectsApi, "loadUserProject").mockResolvedValue({
      project: { id: "p1", name: "p", hash: "h", externalId: "boutique_shop" },
      networkId: "net_1",
      serverKeyId: "sk_1",
    } as never);
    vi.spyOn(projectFilesApi, "readProjectFiles").mockResolvedValue({
      ok: true,
      files: { "manifest.yaml": "id: boutique_shop\n" },
      failed: [],
    });

    const { result } = renderHook(() => useProjectLoader("p1"));
    await waitFor(() => expect(result.current.project).not.toBeNull());

    expect(useProjectCacheStore.getState().get(projectCacheKey("p1", undefined, "u1"))?.tree).toEqual({
      "manifest.yaml": "id: boutique_shop\n",
    });
  });

  /**
   * The payoff of fingerprint revalidation: when nothing moved, the server
   * sends NOTHING back, and the known version stays on screen — but it stops
   * being announced as dated, because it was just confirmed.
   */
  it("announces the held fingerprint and keeps its copy when the server says 'unchanged'", async () => {
    useAuthStore.setState({ currentUser: { id: "u1", name: "x", email: "x@a.b" } } as never);
    useProjectCacheStore.getState().put(projectCacheKey("p1", undefined, "u1"), {
      identity: {
        project: { id: "p1", name: "p", hash: "h", externalId: "boutique_shop" },
        networkId: "net_1",
        serverKeyId: "sk_1",
      },
      diskId: "boutique_shop",
      tree: { "manifest.yaml": "id: boutique_shop" },
      hash: "empreinte-connue",
      fetchedAt: new Date().toISOString(),
    } as never);

    vi.spyOn(userProjectsApi, "loadUserProject").mockResolvedValue({
      project: { id: "p1", name: "p", hash: "h", externalId: "boutique_shop" },
      networkId: "net_1",
      serverKeyId: "sk_1",
    } as never);
    const readSpy = vi
      .spyOn(projectFilesApi, "readProjectFiles")
      .mockResolvedValue({ ok: true, unchanged: true, hash: "empreinte-connue" });

    const { result } = renderHook(() => useProjectLoader("p1"));

    await waitFor(() => expect(result.current.project).not.toBeNull());
    expect(readSpy).toHaveBeenCalledWith("p1", "empreinte-connue");
    // Revalidated: the displayed copy is no longer "dated", it is confirmed.
    await waitFor(() => expect(result.current.stale).toBe(false));
    // What is on screen is indeed what the server holds: it is the
    // compare-and-swap base, otherwise a save would build on sand.
    expect(useProjectBaselineStore.getState().get("p1")).toEqual({
      "manifest.yaml": "id: boutique_shop",
    });
  });

  it("revalidates an offline project automatically, even when its hash is unchanged", async () => {
    vi.useFakeTimers();
    vi.spyOn(dataSourcesApi, "fetchServerDeclaredModels").mockResolvedValue([]);
    useAuthStore.setState({ currentUser: { id: "u1" } } as never);
    const identity = {
      project: { id: "p1", name: "p", externalId: "shop" },
      networkId: "net_1",
      serverKeyId: "sk_1",
    };
    useProjectCacheStore.getState().put(projectCacheKey("p1", undefined, "u1"), {
      identity,
      diskId: "shop",
      tree: { "manifest.yaml": "id: shop\n" },
      hash: "same",
      fetchedAt: new Date().toISOString(),
      declaredModels: [],
    });
    vi.spyOn(userProjectsApi, "loadUserProject").mockResolvedValue(identity as never);
    const read = vi
      .spyOn(projectFilesApi, "readProjectFiles")
      .mockResolvedValueOnce({ ok: false, error: "server_offline" })
      .mockResolvedValueOnce({ ok: false, error: "server_offline" })
      .mockResolvedValue({ ok: true, unchanged: true, hash: "same" });
    const { result, unmount } = renderHook(() => useProjectLoader("p1"));
    await act(async () => {});
    expect(result.current.offline).toBe(true);
    expect(result.current.project).toBeNull();
    await act(async () => {
      await vi.advanceTimersByTimeAsync(15_000);
    });
    expect(read).toHaveBeenCalledTimes(2);
    expect(result.current.offline).toBe(true);
    expect(result.current.project).toBeNull();
    await act(async () => {
      await vi.advanceTimersByTimeAsync(15_000);
    });
    expect(read).toHaveBeenCalledTimes(3);
    expect(result.current.offline).toBe(false);
    expect(result.current.stale).toBe(false);
    await act(async () => {
      await vi.advanceTimersByTimeAsync(30_000);
    });
    expect(read).toHaveBeenCalledTimes(3);
    unmount();
  });

  it("preserves offline edits and their conflict baseline when the server returns different files", async () => {
    vi.useFakeTimers();
    vi.spyOn(dataSourcesApi, "fetchServerDeclaredModels").mockResolvedValue([]);
    useAuthStore.setState({ currentUser: { id: "u1" } } as never);
    const identity = {
      project: { id: "p1", name: "p", externalId: "shop" },
      networkId: "net_1",
      serverKeyId: "sk_1",
    };
    const baseline = { "manifest.yaml": "id: shop\nname: Original\n" };
    const tree = { "manifest.yaml": "id: shop\nname: My edits\n" };
    useProjectDraftStore.getState().save("p1", { baseline, initialTree: baseline, tree, at: 1 });
    vi.spyOn(userProjectsApi, "loadUserProject").mockResolvedValue(identity as never);
    vi.spyOn(projectFilesApi, "readProjectFiles")
      .mockResolvedValueOnce({ ok: false, error: "server_offline" })
      .mockResolvedValue({
        ok: true,
        files: { "manifest.yaml": "id: shop\nname: Server edit\n" },
        failed: [],
      });
    const { result } = renderHook(() => useProjectLoader("p1"));
    await act(async () => {});
    expect(result.current.offline).toBe(true);
    await act(async () => {
      await vi.advanceTimersByTimeAsync(15_000);
    });
    expect(result.current.offline).toBe(false);
    expect(result.current.fromDraft).toBe(true);
    expect(useProjectDraftStore.getState().get("p1")?.tree).toEqual(tree);
    expect(useProjectBaselineStore.getState().get("p1")).toEqual(baseline);
  });

  it("stops retrying when the offline project is closed", async () => {
    vi.useFakeTimers();
    useAuthStore.setState({ currentUser: { id: "u1" } } as never);
    vi.spyOn(userProjectsApi, "loadUserProject").mockResolvedValue({
      project: { id: "p1", name: "p" },
      networkId: "net_1",
      serverKeyId: "sk_1",
    } as never);
    const read = vi
      .spyOn(projectFilesApi, "readProjectFiles")
      .mockResolvedValue({ ok: false, error: "server_offline" });
    const { result, unmount } = renderHook(() => useProjectLoader("p1"));
    await act(async () => {});
    expect(result.current.offline).toBe(true);
    unmount();
    await act(async () => {
      await vi.advanceTimersByTimeAsync(30_000);
    });
    expect(read).toHaveBeenCalledTimes(1);
  });

  it("sets error when no user is signed in", async () => {
    const { result } = renderHook(() => useProjectLoader("p1"));
    await waitFor(() => expect(result.current.error).toBe("Not authenticated"));
    expect(result.current.project).toBeNull();
  });

  it("keeps an already open project and dirty recovery copy when a refresh loses the server", async () => {
    vi.spyOn(dataSourcesApi, "fetchServerDeclaredModels").mockResolvedValue([]);
    useAuthStore.setState({ currentUser: { id: "u1" } } as never);
    vi.spyOn(userProjectsApi, "loadUserProject").mockResolvedValue({
      project: { id: "p1", name: "Shop", externalId: "shop" },
      networkId: "net_1",
      serverKeyId: "sk_1",
    } as never);
    const baseline = { "manifest.yaml": "schema: manifest/v2\n" };
    const read = vi
      .spyOn(projectFilesApi, "readProjectFiles")
      .mockResolvedValue({ ok: true, files: baseline, failed: [], hash: "h" });
    const { result } = renderHook(() => useProjectLoader("p1"));
    await waitFor(() => expect(result.current.project).not.toBeNull());
    const open = result.current.project;
    const tree = { ...baseline, "menus/new.yaml": "id: new\n" };
    useProjectDraftStore.getState().save("p1", { baseline, tree, initialTree: baseline, at: 1 });
    read.mockResolvedValue({ ok: false, error: "server_offline" });
    act(() => useProjectCacheStore.getState().requestReload());
    await waitFor(() => expect(result.current.offline).toBe(true));
    expect(result.current.project).toBe(open);
    expect(useProjectDraftStore.getState().get("p1")?.tree).toEqual(tree);
  });

  it("preserves an open buffer and retries when the backend itself disconnects", async () => {
    vi.useFakeTimers();
    vi.spyOn(dataSourcesApi, "fetchServerDeclaredModels").mockResolvedValue([]);
    useAuthStore.setState({ currentUser: { id: "u1" } } as never);
    const identity = {
      project: { id: "p1", name: "Shop", externalId: "shop" },
      networkId: "net_1",
      serverKeyId: "sk_1",
    };
    const load = vi.spyOn(userProjectsApi, "loadUserProject").mockResolvedValue(identity);
    const baseline = { "manifest.yaml": "schema: manifest/v2\n" };
    vi.spyOn(projectFilesApi, "readProjectFiles").mockResolvedValue({
      ok: true,
      files: baseline,
      failed: [],
      hash: "h",
    });
    const { result } = renderHook(() => useProjectLoader("p1"));
    await act(async () => {});
    const open = result.current.project;
    expect(open).not.toBeNull();
    load.mockRejectedValueOnce(new TypeError("Failed to fetch"));
    await act(async () => useProjectCacheStore.getState().requestReload());
    expect(result.current.offline).toBe(true);
    expect(result.current.error).toBeNull();
    expect(result.current.project).toBe(open);
    await act(async () => vi.advanceTimersByTimeAsync(15_000));
    expect(result.current.offline).toBe(false);
    expect(load).toHaveBeenCalledTimes(3);
  });
});
