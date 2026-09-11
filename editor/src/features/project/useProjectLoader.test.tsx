import * as dataSourcesApi from "@/lib/api/dataSources";
import * as projectFilesApi from "@/lib/api/projectFiles";
import * as userProjectsApi from "@/lib/api/userProjects";
import * as draftsApi from "@/lib/api/projectDrafts";
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
    useAuthStore.setState({ currentUser: null } as never);
    useProjectCacheStore.setState({ entries: {} } as never);
    useProjectDraftStore.setState({ drafts: {}, pendingRenames: {}, ownerId: null, backups: {} });
  });

  it("shows the backend draft before a slow Minecraft read completes", async () => {
    useAuthStore.setState({ currentUser: { id: "u1" } } as never);
    vi.spyOn(userProjectsApi, "loadUserProject").mockResolvedValue({
      project: { id: "p1", name: "Shop", externalId: "shop" }, networkId: "net_1", serverKeyId: "sk_1",
    } as never);
    const baseline = { "manifest.yaml": "id: shop\nname: Original\n" };
    const tree = { "manifest.yaml": "id: shop\nname: Backend draft\n" };
    vi.mocked(draftsApi.listDrafts).mockResolvedValue([{ id: "d1", ownerId: "u1", name: "Work", revision: 1, status: "active", snapshot: { baseline, tree, at: 1 } }] as never);
    vi.spyOn(projectFilesApi, "readProjectFiles").mockReturnValue(new Promise(() => {}));
    const { result } = renderHook(() => useProjectLoader("p1"));
    await waitFor(() => expect(result.current.project).not.toBeNull());
    expect(result.current.fromDraft).toBe(true);
    expect(useProjectBaselineStore.getState().get("p1")).toEqual(baseline);
  });

  it("charge le contenu depuis le DISQUE du serveur, pas depuis le backend", async () => {
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
    // Lu sous l'id disque, auprès du serveur propriétaire. Sans version connue,
    // aucune empreinte à annoncer : le serveur envoie l'arbre.
    expect(readSpy).toHaveBeenCalledWith("net_1", "sk_1", "boutique_shop", undefined);
    // Ce qui a été lu devient la base du compare-and-swap.
    expect(useProjectBaselineStore.getState().get("p1")).toEqual({
      "manifest.yaml": "id: boutique_shop\n",
    });
  });

  it("serveur hors ligne : pas de repli, le Project n'est pas ouvrable", async () => {
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
   * Le disque du serveur est loin : plusieurs secondes d'attente à chaque
   * ouverture, pour un contenu presque toujours identique à la visite
   * précédente. On affiche donc ce qu'on avait, tout de suite, et on revalide
   * derrière — sans jamais faire passer le cache pour la vérité (`stale`).
   */
  it("affiche tout de suite la dernière version connue, puis la remplace par celle du serveur", async () => {
    useAuthStore.setState({ currentUser: { id: "u1", name: "x", email: "x@a.b" } } as never);
    useProjectCacheStore.getState().put(projectCacheKey("p1"), {
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
    // La lecture disque ne répond pas tout de suite : c'est exactement la
    // fenêtre pendant laquelle l'écran restait vide.
    let release: (v: unknown) => void = () => {};
    vi.spyOn(projectFilesApi, "readProjectFiles").mockReturnValue(
      new Promise((r) => {
        release = r;
      }) as never,
    );

    const { result } = renderHook(() => useProjectLoader("p1"));

    await waitFor(() => expect(result.current.project).not.toBeNull());
    expect(result.current.stale).toBe(true);

    release({
      ok: true,
      files: { "manifest.yaml": "id: boutique_shop\nname: frais\n" },
      failed: [],
    });
    await waitFor(() => expect(result.current.stale).toBe(false));
  });

  it("ce que le serveur a rendu devient la version connue", async () => {
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

    expect(useProjectCacheStore.getState().get(projectCacheKey("p1"))?.tree).toEqual({
      "manifest.yaml": "id: boutique_shop\n",
    });
  });

  /**
   * Le gain de la revalidation par empreinte : quand rien n'a bougé, le serveur
   * ne renvoie RIEN, et la version connue reste à l'écran — mais elle cesse
   * d'être annoncée comme datée, parce qu'elle vient d'être confirmée.
   */
  it("annonce l'empreinte détenue et garde sa copie quand le serveur dit « inchangé »", async () => {
    useAuthStore.setState({ currentUser: { id: "u1", name: "x", email: "x@a.b" } } as never);
    useProjectCacheStore.getState().put(projectCacheKey("p1"), {
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
    expect(readSpy).toHaveBeenCalledWith("net_1", "sk_1", "boutique_shop", "empreinte-connue");
    // Revalidé : la copie affichée n'est plus « datée », elle est confirmée.
    await waitFor(() => expect(result.current.stale).toBe(false));
    // Ce qui est à l'écran est bien ce que le serveur porte : c'est la base du
    // compare-and-swap, sinon un enregistrement partirait sur du sable.
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
    useProjectCacheStore.getState().put(projectCacheKey("p1"), {
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
    expect(result.current.stale).toBe(true);
    await act(async () => {
      await vi.advanceTimersByTimeAsync(15_000);
    });
    expect(read).toHaveBeenCalledTimes(2);
    expect(result.current.offline).toBe(true);
    expect(result.current.stale).toBe(true);
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
});
