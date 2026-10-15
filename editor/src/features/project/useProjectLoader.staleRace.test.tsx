import * as dataSourcesApi from "@/lib/api/dataSources";
import * as declaredActionsApi from "@/lib/api/declaredActions";
import * as draftsApi from "@/lib/api/projectDrafts";
import * as projectFilesApi from "@/lib/api/projectFiles";
import * as userProjectsApi from "@/lib/api/userProjects";
import { useAccountStore } from "@/state/accountStore";
import { useAuthStore } from "@/state/authStore";
import { projectCacheKey, useProjectCacheStore } from "@/state/projectCacheStore";
import { useProjectDraftStore } from "@/state/projectDraftStore";
import { act, renderHook, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { useProjectLoader } from "./useProjectLoader";
import { menusOf } from "@/domain/documents";

const IDENTITY = {
  project: { id: "p1", name: "Boutique", hash: "h", externalId: "boutique_shop" },
  networkId: "net_1",
  serverKeyId: "sk_1",
};

const menu = (id: string) => `schema: menu/v1\nid: ${id}\ntitle: ${id}\nsize: 27\nelements: []\n`;

/**
 * The show-from-cache trap: both builds write to the SAME store, the one the
 * canvas reads. The cache build starts first but may finish last (it also
 * waits for the server's declared models) — and it then silently overwrote
 * the fresh version.
 *
 * The screen showed the previous visit while claiming to show the server:
 * vanished elements, an empty template, and nothing to say so.
 */
describe("useProjectLoader — the fresh version always wins", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
    vi.spyOn(draftsApi, "listDrafts").mockResolvedValue([]);
    vi.spyOn(declaredActionsApi, "fetchServerDeclaredActions").mockResolvedValue([]);
    useProjectCacheStore.setState({ entries: {}, reloadToken: 0 } as never);
    useProjectDraftStore.setState({ drafts: {}, pendingRenames: {}, ownerId: null, backups: {} });
    useAccountStore.setState({
      account: { id: "", projects: [], projectOrder: [] },
    } as never);
    useAuthStore.setState({ currentUser: { id: "u1", name: "x", email: "x@a.b" } } as never);
  });

  it("a cached display that finishes late does not overwrite the fresh Project", async () => {
    useProjectCacheStore.getState().put(projectCacheKey("p1", undefined, "u1"), {
      identity: IDENTITY,
      diskId: "boutique_shop",
      serverKeyId: "sk_1",
      tree: { "menus/perime.yaml": menu("perime") },
      hash: "vieille",
      fetchedAt: new Date().toISOString(),
    } as never);

    vi.spyOn(userProjectsApi, "loadUserProject").mockResolvedValue(IDENTITY as never);
    vi.spyOn(projectFilesApi, "readProjectFiles").mockResolvedValue({
      ok: true,
      files: { "menus/frais.yaml": menu("frais") },
      failed: [],
      hash: "fraiche",
    });

    // The build from the cache starts first but lags: this order reveals the
    // bug, and it is not theoretical (two distinct network calls, two
    // latencies).
    let call = 0;
    vi.spyOn(dataSourcesApi, "fetchServerDeclaredModels").mockImplementation(() => {
      call += 1;
      const delay = call === 1 ? 60 : 0;
      return new Promise((resolve) => setTimeout(() => resolve([]), delay));
    });

    const { result } = renderHook(() => useProjectLoader("p1"));

    await waitFor(() => expect(result.current.project).not.toBeNull());
    expect(result.current.stale).toBe(false);

    const stored = useAccountStore.getState().account.projects.find((p) => p.id === "p1");
    const menuIds = (menusOf(stored) ?? []).map((m) => m.id);
    expect(menuIds).toContain("frais");
    expect(menuIds).not.toContain("perime");
  });

  /**
   * "Reading the server's files…" still showed on every visit although the
   * known version was there: the build from the cache waited for a REST round
   * trip (the server's declared models) before rendering anything. A cache that
   * waits for the network is not a cache.
   */
  it("does not expose a cached project before the network authorizes opening it", async () => {
    useProjectCacheStore.getState().put(projectCacheKey("p1", undefined, "u1"), {
      identity: IDENTITY,
      diskId: "boutique_shop",
      serverKeyId: "sk_1",
      tree: { "menus/connu.yaml": menu("connu") },
      declaredModels: [],
      hash: "connue",
      fetchedAt: new Date().toISOString(),
    } as never);

    vi.spyOn(userProjectsApi, "loadUserProject").mockReturnValue(new Promise(() => {}) as never);
    vi.spyOn(projectFilesApi, "readProjectFiles").mockReturnValue(new Promise(() => {}) as never);
    // The network NEVER answers: if the screen waits for anything, it stays empty.
    const models = vi
      .spyOn(dataSourcesApi, "fetchServerDeclaredModels")
      .mockReturnValue(new Promise(() => {}) as never);

    const { result } = renderHook(() => useProjectLoader("p1"));

    await act(async () => {});
    expect(result.current.project).toBeNull();
    expect(models).not.toHaveBeenCalled();
  });

  /**
   * The worst possible case: unsaved work disappearing on a simple page reload.
   *
   * The persisted draft holds elements added but not yet saved. The paths
   * through the cache — immediate display, "unchanged" answer, unreachable
   * server — rebuilt from the SERVER's tree, ignoring it. Only the "fresh tree"
   * path picked it up.
   */
  it("an unsaved draft survives an 'unchanged' response", async () => {
    useProjectCacheStore.getState().put(projectCacheKey("p1", undefined, "u1"), {
      identity: IDENTITY,
      diskId: "boutique_shop",
      serverKeyId: "sk_1",
      tree: { "menus/serveur.yaml": menu("serveur") },
      declaredModels: [],
      hash: "identique",
      fetchedAt: new Date().toISOString(),
    } as never);
    useProjectDraftStore.setState({
      drafts: {
        p1: {
          baseline: { "menus/serveur.yaml": menu("serveur") },
          initialTree: { "menus/serveur.yaml": menu("serveur") },
          tree: {
            "menus/serveur.yaml": menu("serveur"),
            "menus/en_cours.yaml": menu("en_cours"),
          },
        },
      },
    } as never);

    vi.spyOn(userProjectsApi, "loadUserProject").mockResolvedValue(IDENTITY as never);
    vi.spyOn(projectFilesApi, "readProjectFiles").mockResolvedValue({
      ok: true,
      unchanged: true,
      hash: "identique",
    });
    vi.spyOn(dataSourcesApi, "fetchServerDeclaredModels").mockResolvedValue([] as never);

    const { result } = renderHook(() => useProjectLoader("p1"));

    await waitFor(() => expect(result.current.project).not.toBeNull());
    await waitFor(() => expect(result.current.stale).toBe(false));
    expect(projectFilesApi.readProjectFiles).toHaveBeenCalledExactlyOnceWith("p1", "identique");

    const menuIds = menusOf(result.current.project).map((m) => m.id);
    expect(menuIds).toContain("en_cours");
    expect(useProjectDraftStore.getState().drafts.p1).toBeDefined();
  });
});
