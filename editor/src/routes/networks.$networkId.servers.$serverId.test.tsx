import { render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

const navigateSpy = vi.hoisted(() => vi.fn());

const authState = vi.hoisted(() => ({
  currentUser: { id: "u1", name: "Iban" } as { id: string; name: string } | null,
  isLoading: false,
}));

vi.mock("@/state/authStore", () => ({
  useAuthStore: (sel: (s: typeof authState) => unknown) => sel(authState),
}));

function setUrl(pathname: string, search = "") {
  Object.defineProperty(window, "location", {
    writable: true,
    value: { ...window.location, pathname, search },
  });
}

vi.mock("@tanstack/react-router", async () => {
  const actual =
    await vi.importActual<typeof import("@tanstack/react-router")>("@tanstack/react-router");
  return {
    ...actual,
    useChildMatches: () => [],
    useParams: () => ({ networkId: "net_1", serverId: "sk_1" }),
    useNavigate: () => navigateSpy,
    Navigate: () => null,
    Link: ({ children, to, params, ...p }: any) => (
      <a href={to} {...p}>
        {children}
      </a>
    ),
    createFileRoute: () => () => ({ component: () => null }),
  };
});

vi.mock("@/lib/api/networks", () => ({
  getNetwork: vi.fn().mockResolvedValue({
    network: { id: "net_1", name: "Mon Réseau", tier: "free" },
    serverKeys: [{ id: "sk_1", slug: "primal", label: "Survival" }],
    projects: [],
  }),
}));

vi.mock("@/lib/api/projectFiles", () => ({
  listServerProjects: vi.fn().mockResolvedValue({ ok: true, projectIds: ["Hub", "boutique_shop"] }),
}));

const screensState = vi.hoisted(() => ({
  screens: [] as Array<Record<string, unknown>>,
  load: vi.fn(),
}));
vi.mock("@/state/serverScreensStore", () => ({
  useServerScreensStore: Object.assign(
    (sel: (s: typeof screensState) => unknown) => sel(screensState),
    { getState: () => screensState },
  ),
}));

const accountState = vi.hoisted(() => ({ account: { projects: [] as unknown[] } }));
vi.mock("@/state/accountStore", () => ({
  useAccountStore: (sel: (s: typeof accountState) => unknown) => sel(accountState),
}));

const modulesState = vi.hoisted(() => ({ mountedIds: [] as string[] }));
vi.mock("@/state/modulesStore", () => ({
  useModulesStore: (sel: (s: typeof modulesState) => unknown) => sel(modulesState),
}));

vi.mock("@artisan/editor-sdk", () => ({
  getModule: (id: string) =>
    id === "boutique" ? { id: "boutique", displayName: "Boutique", routes: [] } : undefined,
}));

vi.mock("react-i18next", () => ({
  useTranslation: () => ({ t: (k: string) => k }),
}));

import { getNetwork } from "@/lib/api/networks";
import { listServerProjects } from "@/lib/api/projectFiles";
import ServerDetailPage from "./networks.$networkId.servers.$serverId";

describe("ServerDetailPage", () => {
  beforeEach(() => {
    navigateSpy.mockClear();
    authState.currentUser = { id: "u1", name: "Iban" };
    authState.isLoading = false;
    screensState.screens = [];
    screensState.load.mockClear();
    vi.mocked(listServerProjects).mockResolvedValue({
      ok: true,
      projectIds: ["Hub", "boutique_shop"],
    });
    modulesState.mountedIds = [];
  });

  it("redirects anonymous visitors to /login with a next return path", async () => {
    authState.currentUser = null;
    authState.isLoading = false;
    setUrl("/networks/net_1/servers/sk_1", "?x=1");

    render(<ServerDetailPage />);

    await waitFor(() =>
      expect(navigateSpy).toHaveBeenCalledWith({
        to: "/login",
        search: { next: "/networks/net_1/servers/sk_1?x=1" },
        replace: true,
      }),
    );
  });

  it("does not redirect a logged-in user", async () => {
    setUrl("/networks/net_1/servers/sk_1");
    render(<ServerDetailPage />);
    await waitFor(() => expect(screen.getByText("Hub")).toBeInTheDocument());
    expect(navigateSpy).not.toHaveBeenCalled();
  });

  /**
   * La liste vient du disque du serveur, comme la sidebar (ADR
   * `server-disk-only-storage`) — la table des projects ne décrit plus ce qui
   * existe. Le slug d'URL doit être résolu en id avant l'appel.
   */
  it("lit les Projects sur le disque du serveur, par ids résolus", async () => {
    render(<ServerDetailPage />);
    await waitFor(() => expect(listServerProjects).toHaveBeenCalledWith("net_1", "sk_1"));
  });

  /**
   * Plus de compteur de Documents ici : le backend ne détient plus les fichiers
   * (ADR `server-disk-only-storage`), donc il ne peut plus le connaître sans
   * interroger le disque du serveur.
   */
  it("n'affiche plus de compteur de Documents — le backend ne le connaît plus", async () => {
    render(<ServerDetailPage />);
    await waitFor(() => expect(screen.getByText("Hub")).toBeInTheDocument());
    expect(screen.queryByText("5")).not.toBeInTheDocument();
  });

  it("workspace link points to the new URL pattern", async () => {
    render(<ServerDetailPage />);
    const link = await screen.findByRole("link", { name: /Hub/ });
    expect(link).toHaveAttribute(
      "href",
      "/networks/$networkId/servers/$serverId/projects/$projectId",
    );
  });

  /** Même regroupement que la sidebar : un project possédé par un Add-on sort
   *  de la liste plate et apparaît sous le nom du module. */
  it("affiche un project possédé sous son module, pas dans la liste des projects", async () => {
    screensState.screens = [
      {
        id: "catalogue",
        moduleId: "boutique",
        label: "Catalogue",
        table: "data/catalogue",
        projectId: "boutique_shop",
      },
    ];
    render(<ServerDetailPage />);
    await waitFor(() => expect(screen.getByText("Boutique")).toBeInTheDocument());
    expect(screen.queryByText("boutique_shop")).not.toBeInTheDocument();
    expect(screen.getByText("Hub")).toBeInTheDocument();
  });

  it("montre les onglets du module : éditeur puis écrans déclarés", async () => {
    screensState.screens = [
      {
        id: "catalogue",
        moduleId: "boutique",
        label: "Catalogue",
        table: "data/catalogue",
        projectId: "boutique_shop",
      },
    ];
    render(<ServerDetailPage />);
    await screen.findByText("Boutique");
    expect(screen.getByText("screens.editorEntry")).toBeInTheDocument();
    const link = screen.getByRole("link", { name: "Catalogue" });
    expect(link).toHaveAttribute(
      "href",
      "/networks/$networkId/servers/$serverId/screens/$screenId",
    );
  });

  /**
   * Tant que le disque n'a pas répondu, la page ne prétend rien : afficher
   * « aucun projet » pendant la lecture, c'est affirmer un vide qu'on n'a pas
   * constaté — exactement ce qui donnait un serveur « vide » au premier rendu.
   */
  it("n'annonce pas un serveur vide tant que la lecture disque n'a pas répondu", async () => {
    vi.mocked(listServerProjects).mockReturnValue(new Promise(() => {}) as never);
    render(<ServerDetailPage />);
    await screen.findByText("serverDetail.loadingProjects");
    expect(screen.queryByText("serverDetail.noProjects")).not.toBeInTheDocument();
  });

  it("dit que le serveur est injoignable quand la lecture disque échoue", async () => {
    vi.mocked(listServerProjects).mockResolvedValue({ ok: false, error: "server_offline" });
    render(<ServerDetailPage />);
    await screen.findByText("serverDetail.projectsUnavailable");
    expect(screen.queryByText("serverDetail.noProjects")).not.toBeInTheDocument();
  });

  /** Les Config screens décident du regroupement : la page les charge pour SON
   *  serveur, sinon un project possédé apparaît d'abord à plat puis saute. */
  it("charge les Config screens de son propre serveur", async () => {
    render(<ServerDetailPage />);
    await waitFor(() =>
      expect(screensState.load).toHaveBeenCalledWith({ networkId: "net_1", serverId: "sk_1" }),
    );
  });

  it("403 for a logged-in user renders the request-access panel instead of bouncing", async () => {
    vi.mocked(getNetwork).mockRejectedValueOnce(
      Object.assign(new Error("forbidden"), { status: 403 }),
    );
    render(<ServerDetailPage />);
    await screen.findByText("requestAccess.title");
    expect(navigateSpy).not.toHaveBeenCalled();
  });

  it("404 still bounces to /networks", async () => {
    vi.mocked(getNetwork).mockRejectedValueOnce(
      Object.assign(new Error("not found"), { status: 404 }),
    );
    render(<ServerDetailPage />);
    await waitFor(() =>
      expect(navigateSpy).toHaveBeenCalledWith({ to: "/networks", replace: true }),
    );
  });
});
