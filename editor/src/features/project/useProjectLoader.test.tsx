import * as projectFilesApi from "@/lib/api/projectFiles";
import * as userProjectsApi from "@/lib/api/userProjects";
import { useAuthStore } from "@/state/authStore";
import { useProjectBaselineStore } from "@/state/projectBaselineStore";
import { projectCacheKey, useProjectCacheStore } from "@/state/projectCacheStore";
import { renderHook, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { useProjectLoader } from "./useProjectLoader";

describe("useProjectLoader", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
    useAuthStore.setState({ currentUser: null } as never);
    useProjectCacheStore.setState({ entries: {} } as never);
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

  it("sets error when no user is signed in", async () => {
    const { result } = renderHook(() => useProjectLoader("p1"));
    await waitFor(() => expect(result.current.error).toBe("Not authenticated"));
    expect(result.current.project).toBeNull();
  });
});
