import * as dataSourcesApi from "@/lib/api/dataSources";
import * as projectFilesApi from "@/lib/api/projectFiles";
import * as userProjectsApi from "@/lib/api/userProjects";
import { useAccountStore } from "@/state/accountStore";
import { useAuthStore } from "@/state/authStore";
import { projectCacheKey, useProjectCacheStore } from "@/state/projectCacheStore";
import { useProjectDraftStore } from "@/state/projectDraftStore";
import { renderHook, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { useProjectLoader } from "./useProjectLoader";

const IDENTITY = {
  project: { id: "p1", name: "Boutique", hash: "h", externalId: "boutique_shop" },
  networkId: "net_1",
  serverKeyId: "sk_1",
};

const menu = (id: string) => `schema: menu/v1\nid: ${id}\ntitle: ${id}\nsize: 27\nelements: []\n`;

/**
 * Le piège de l'affichage-depuis-le-cache : les deux constructions écrivent dans
 * le MÊME store, celui que le canvas lit. Celle du cache part la première mais
 * peut finir la dernière (elle attend, elle aussi, les modèles déclarés du
 * serveur) — et elle écrasait alors la version fraîche, en silence.
 *
 * L'écran affichait donc la visite précédente en croyant montrer le serveur :
 * des éléments disparus, un template vide, et rien pour le dire.
 */
describe("useProjectLoader — la version fraîche gagne toujours", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
    useProjectCacheStore.setState({ entries: {}, reloadToken: 0 } as never);
    useProjectDraftStore.setState({ drafts: {} } as never);
    useAccountStore.setState({
      account: { id: "", projects: [], projectOrder: [] },
    } as never);
    useAuthStore.setState({ currentUser: { id: "u1", name: "x", email: "x@a.b" } } as never);
  });

  it("un affichage depuis le cache qui finit en retard n'écrase pas le Project frais", async () => {
    useProjectCacheStore.getState().put(projectCacheKey("p1"), {
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

    // La construction depuis le cache part en premier mais traîne : c'est
    // l'ordre qui révèle le bug, et il n'a rien de théorique (deux appels
    // réseau distincts, deux latences).
    let call = 0;
    vi.spyOn(dataSourcesApi, "fetchServerDeclaredModels").mockImplementation(() => {
      call += 1;
      const delay = call === 1 ? 60 : 0;
      return new Promise((resolve) => setTimeout(() => resolve([]), delay));
    });

    const { result } = renderHook(() => useProjectLoader("p1"));

    await waitFor(() => expect(result.current.stale).toBe(false));
    await new Promise((r) => setTimeout(r, 120));

    const stored = useAccountStore.getState().account.projects.find((p) => p.id === "p1");
    const menuIds = (stored?.menus ?? []).map((m) => m.id);
    expect(menuIds).toContain("frais");
    expect(menuIds).not.toContain("perime");
  });

  /**
   * « Lecture des fichiers du serveur… » s'affichait encore à chaque visite,
   * alors que la version connue était là : la construction depuis le cache
   * attendait un aller-retour REST (les modèles déclarés du serveur) avant de
   * rendre quoi que ce soit. Un cache qui attend le réseau n'est pas un cache.
   */
  it("affiche la version connue sans attendre le réseau", async () => {
    useProjectCacheStore.getState().put(projectCacheKey("p1"), {
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
    // Le réseau ne répond JAMAIS : si l'écran attend quoi que ce soit, il reste vide.
    const models = vi
      .spyOn(dataSourcesApi, "fetchServerDeclaredModels")
      .mockReturnValue(new Promise(() => {}) as never);

    const { result } = renderHook(() => useProjectLoader("p1"));

    await waitFor(() => expect(result.current.project).not.toBeNull());
    expect(result.current.stale).toBe(true);
    expect(models).not.toHaveBeenCalled();
  });

  /**
   * Le pire cas possible : du travail non enregistré qui disparaît à un simple
   * rechargement de page.
   *
   * Le brouillon persisté porte les éléments ajoutés mais pas encore
   * enregistrés. Les chemins passant par le cache — affichage immédiat,
   * réponse « inchangé », serveur injoignable — reconstruisaient depuis
   * l'arbre du SERVEUR en l'ignorant. Seul le chemin « arbre frais » le
   * reprenait.
   */
  it("un brouillon non enregistré survit à une réponse « inchangé »", async () => {
    useProjectCacheStore.getState().put(projectCacheKey("p1"), {
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

    const menuIds = (result.current.project?.menus ?? []).map((m) => m.id);
    expect(menuIds).toContain("en_cours");
    expect(useProjectDraftStore.getState().drafts.p1).toBeDefined();
  });
});
