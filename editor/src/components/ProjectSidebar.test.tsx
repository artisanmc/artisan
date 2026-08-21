import * as networksApi from "@/lib/api/networks";
import { listServerProjects } from "@/lib/api/projectFiles";
import { useAccountStore } from "@/state/accountStore";
import { useNetworksStore } from "@/state/networksStore";
import { useServersStore } from "@/state/serversStore";
import { act, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { ProjectSidebar } from "./ProjectSidebar";

const mockParams = vi.hoisted(() => ({
  current: { networkId: "net_1", serverId: "sk_1" } as {
    networkId?: string;
    serverId?: string;
    projectId?: string;
  },
}));

// La liste des Projects vient désormais du DISQUE du serveur actif (ADR
// `server-disk-only-storage`) : le dossier EST l'identité, donc le libellé
// affiché est son nom de dossier, plus le `name` d'une ligne en base.
vi.mock("@/lib/api/projectFiles", () => ({
  listServerProjects: vi.fn(async () => ({ ok: true, projectIds: ["pack_a", "pack_b"] })),
}));

vi.mock("@tanstack/react-router", async () => {
  const actual =
    await vi.importActual<typeof import("@tanstack/react-router")>("@tanstack/react-router");
  return {
    ...actual,
    useNavigate: () => vi.fn(),
    useParams: () => mockParams.current,
    useSearch: () => ({}),
    Link: ({ children, to, params, ...props }: any) => (
      <a href={to} {...props}>
        {children}
      </a>
    ),
  };
});

describe("ProjectSidebar", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
    // `mockResolvedValue` d'un test précédent survivrait sinon : on repose la
    // réponse disque par défaut avant chacun.
    vi.mocked(listServerProjects).mockResolvedValue({
      ok: true,
      projectIds: ["pack_a", "pack_b"],
    });
    mockParams.current = { networkId: "net_1", serverId: "sk_1" };
    useNetworksStore.setState({
      networks: [{ id: "net_1", name: "Mon Network", tier: "free" }],
      activeId: null,
    } as any);
    useServersStore.setState({ activeServerId: null } as any);
    useAccountStore.setState({ account: { id: "", projects: [], projectOrder: [] } } as any);
  });

  it("renders ServerSelector (server label visible)", async () => {
    vi.spyOn(networksApi, "getNetwork").mockResolvedValue({
      network: { id: "net_1", name: "Mon Network", tier: "free" },
      projects: [],
      serverKeys: [{ id: "sk_1", label: "Survival" }],
    });
    render(<ProjectSidebar />);
    // ServerSelector renders a button with sidebar.serverLabel text (mocked t returns key)
    expect(await screen.findByText(/sidebar\.serverLabel|Serveur|Server/i)).toBeInTheDocument();
  });

  it("liste les Projects du disque du serveur actif, triés", async () => {
    vi.spyOn(networksApi, "getNetwork").mockResolvedValue({
      network: { id: "net_1", name: "Mon Network", tier: "free" },
      projects: [
        {
          id: "pack_b",
          name: "Menu principal",
          hash: "h2",
          updatedAt: "2026-05-26T10:00:00Z",
          networkId: "net_1",
          serverKeyId: "sk_1",
        },
        {
          id: "pack_a",
          name: "Lobby",
          hash: "h1",
          updatedAt: "2026-05-25T10:00:00Z",
          networkId: "net_1",
          serverKeyId: "sk_1",
        },
      ],
      serverKeys: [{ id: "sk_1", label: "Survival" }],
    });
    render(<ProjectSidebar />);
    const items = await screen.findAllByRole("link", { name: /pack_a|pack_b/ });
    // L'ordre vient du plugin (dossiers triés) : pack_a avant pack_b. Le libellé
    // est le nom du dossier — c'est lui l'identité désormais.
    expect(items[0]).toHaveTextContent("pack_a");
    expect(items[1]).toHaveTextContent("pack_b");
  });

  it("workspace links use the server-scoped URL pattern", async () => {
    vi.spyOn(networksApi, "getNetwork").mockResolvedValue({
      network: { id: "net_1", name: "Mon Network", tier: "free" },
      projects: [
        { id: "pack_a", name: "Lobby", hash: "h1", networkId: "net_1", serverKeyId: "sk_1" },
      ],
      serverKeys: [{ id: "sk_1", label: "Survival" }],
    });
    render(<ProjectSidebar />);
    const link = await screen.findByRole("link", { name: /pack_a/ });
    expect(link).toHaveAttribute(
      "href",
      "/networks/$networkId/servers/$serverId/projects/$projectId",
    );
  });

  it("renders the Modules empty state", async () => {
    vi.spyOn(networksApi, "getNetwork").mockResolvedValue({
      network: { id: "net_1", name: "Mon Network", tier: "free" },
      projects: [],
      serverKeys: [],
    });
    render(<ProjectSidebar />);
    expect(await screen.findByText(/Aucun module installé/i)).toBeInTheDocument();
  });

  it("renders the + Nouveau workspace link", async () => {
    vi.spyOn(networksApi, "getNetwork").mockResolvedValue({
      network: { id: "net_1", name: "Mon Network", tier: "free" },
      projects: [],
      serverKeys: [],
    });
    render(<ProjectSidebar />);
    expect(await screen.findByText(/Nouveau projet/i)).toBeInTheDocument();
  });

  it("renders the user menu pill (Settings link lives inside its dropdown)", async () => {
    vi.spyOn(networksApi, "getNetwork").mockResolvedValue({
      network: { id: "net_1", name: "Mon Network", tier: "free" },
      projects: [],
      serverKeys: [],
    });
    render(<ProjectSidebar />);
    expect(await screen.findByText(/Anonymous|Anonyme/i)).toBeInTheDocument();
  });

  it("resolves slug URL params and lists the active server's workspaces", async () => {
    // Phase 4a routes put slugs (not ids) in networkId/serverId params.
    mockParams.current = { networkId: "mon-network", serverId: "survival" };
    useNetworksStore.setState({
      networks: [{ id: "net_1", name: "Mon Network", slug: "mon-network", tier: "free" }],
    } as any);
    vi.spyOn(networksApi, "getNetwork").mockResolvedValue({
      network: { id: "net_1", name: "Mon Network", slug: "mon-network", tier: "free" },
      projects: [
        { id: "pack_a", name: "Lobby", hash: "h1", networkId: "net_1", serverKeyId: "sk_1" },
      ],
      serverKeys: [{ id: "sk_1", label: "Survival", slug: "survival" }],
    });
    render(<ProjectSidebar />);
    expect(await screen.findByRole("link", { name: /pack_a/ })).toBeInTheDocument();
  });

  it("shows the active server label in ServerSelector when the URL carries the server slug", async () => {
    mockParams.current = { networkId: "mon-network", serverId: "survival" };
    useNetworksStore.setState({
      networks: [{ id: "net_1", name: "Mon Network", slug: "mon-network", tier: "free" }],
    } as any);
    vi.spyOn(networksApi, "getNetwork").mockResolvedValue({
      network: { id: "net_1", name: "Mon Network", slug: "mon-network", tier: "free" },
      projects: [],
      serverKeys: [{ id: "sk_1", label: "Survival", slug: "survival" }],
    });
    render(<ProjectSidebar />);
    expect(await screen.findByText("Survival")).toBeInTheDocument();
  });

  it("falls back to the persisted server selection on routes without a serverId param", async () => {
    // e.g. /settings or /credits — no networkId/serverId in the URL.
    mockParams.current = {};
    useServersStore.setState({ activeServerId: "sk_1" } as any);
    vi.spyOn(networksApi, "getNetwork").mockResolvedValue({
      network: { id: "net_1", name: "Mon Network", tier: "free" },
      projects: [
        { id: "p1", name: "Lobby", hash: "h", networkId: "net_1", serverKeyId: "sk_1" },
        { id: "p2", name: "Shop", hash: "h", networkId: "net_1", serverKeyId: "sk_2" },
      ],
      serverKeys: [
        { id: "sk_1", label: "Survival" },
        { id: "sk_2", label: "Creatif" },
      ],
    });
    render(<ProjectSidebar />);
    expect(await screen.findByRole("link", { name: /pack_a/ })).toBeInTheDocument();
    // Still scoped to the persisted server, not the whole network.
    expect(screen.queryByRole("link", { name: /Shop/ })).not.toBeInTheDocument();
    // The selector still shows the persisted server as active.
    expect(await screen.findByText("Survival")).toBeInTheDocument();
  });

  // Un serveur persisté qui n'existe plus ne peut plus « retomber sur tout le
  // network » : un Project appartient à un serveur et se lit sur SON disque
  // (ADR `server-disk-only-storage`). Il n'y a donc rien à lister — le sélecteur
  // de serveur reste là pour en choisir un vrai.
  it("un serveur persisté disparu ne liste rien plutôt qu'une liste d'un autre serveur", async () => {
    mockParams.current = {};
    useServersStore.setState({ activeServerId: "sk_deleted" } as any);
    vi.mocked(listServerProjects).mockResolvedValueOnce({ ok: false, error: "forbidden" });
    vi.spyOn(networksApi, "getNetwork").mockResolvedValue({
      network: { id: "net_1", name: "Mon Network", tier: "free" },
      projects: [{ id: "p1", name: "Lobby", hash: "h", networkId: "net_1", serverKeyId: "sk_1" }],
      serverKeys: [{ id: "sk_1", label: "Survival" }],
    });
    render(<ProjectSidebar />);
    await waitFor(() => expect(listServerProjects).toHaveBeenCalled());
    expect(screen.queryByRole("link", { name: /pack_a|Lobby/ })).toBeNull();
  });

  /**
   * Même exigence que la page d'un serveur : une liste vide affirmée pendant la
   * lecture, ou pour un serveur hors ligne, se lit comme « ce serveur n'a rien »
   * — et le bouton « Nouveau projet » invite alors à écrire sur un disque
   * qu'on ne joint pas.
   */
  it("dit qu'elle lit plutôt que d'afficher une liste vide", async () => {
    vi.mocked(listServerProjects).mockReturnValue(new Promise(() => {}) as never);
    vi.spyOn(networksApi, "getNetwork").mockResolvedValue({
      network: { id: "net_1", name: "Mon Network", tier: "free" },
      projects: [],
      serverKeys: [{ id: "sk_1", label: "Survival" }],
    });
    render(<ProjectSidebar />);
    expect(await screen.findByText("Lecture en cours…")).toBeInTheDocument();
    expect(screen.queryByText("+ Nouveau projet")).toBeNull();
  });

  it("dit que le serveur est injoignable, et n'invite plus à y créer un projet", async () => {
    vi.mocked(listServerProjects).mockResolvedValue({ ok: false, error: "server_offline" });
    vi.spyOn(networksApi, "getNetwork").mockResolvedValue({
      network: { id: "net_1", name: "Mon Network", tier: "free" },
      projects: [],
      serverKeys: [{ id: "sk_1", label: "Survival" }],
    });
    render(<ProjectSidebar />);
    await waitFor(() => expect(listServerProjects).toHaveBeenCalled());
    expect(await screen.findByText("Serveur injoignable")).toBeInTheDocument();
    expect(screen.queryByText("+ Nouveau projet")).toBeNull();
  });

  it("retrouve le bouton de création quand la lecture a abouti", async () => {
    vi.mocked(listServerProjects).mockResolvedValue({ ok: true, projectIds: ["pack_a"] });
    vi.spyOn(networksApi, "getNetwork").mockResolvedValue({
      network: { id: "net_1", name: "Mon Network", tier: "free" },
      projects: [],
      serverKeys: [{ id: "sk_1", label: "Survival" }],
    });
    render(<ProjectSidebar />);
    await waitFor(() => expect(listServerProjects).toHaveBeenCalled());
    expect(await screen.findByText("+ Nouveau projet")).toBeInTheDocument();
  });

  it("persists the URL server (slug resolved to id) and network into the stores", async () => {
    mockParams.current = { networkId: "mon-network", serverId: "survival" };
    useNetworksStore.setState({
      networks: [{ id: "net_1", name: "Mon Network", slug: "mon-network", tier: "free" }],
      activeId: null,
    } as any);
    vi.spyOn(networksApi, "getNetwork").mockResolvedValue({
      network: { id: "net_1", name: "Mon Network", slug: "mon-network", tier: "free" },
      projects: [],
      serverKeys: [{ id: "sk_1", label: "Survival", slug: "survival" }],
    });
    render(<ProjectSidebar />);
    await waitFor(() => expect(useServersStore.getState().activeServerId).toBe("sk_1"));
    expect(useNetworksStore.getState().activeId).toBe("net_1");
  });

  it("links the active network name to its network page", async () => {
    vi.spyOn(networksApi, "getNetwork").mockResolvedValue({
      network: { id: "net_1", name: "Mon Network", tier: "free" },
      projects: [],
      serverKeys: [{ id: "sk_1", label: "Survival" }],
    });
    render(<ProjectSidebar />);
    const link = await screen.findByRole("link", { name: /Mon Network/ });
    expect(link).toHaveAttribute("href", "/networks/$networkId");
  });

  it("refetches when networkId changes", async () => {
    const getNetwork = vi.spyOn(networksApi, "getNetwork").mockResolvedValue({
      network: { id: "net_1", name: "Mon Network", tier: "free" },
      projects: [],
      serverKeys: [],
    });
    render(<ProjectSidebar />);
    await waitFor(() => expect(getNetwork).toHaveBeenCalledWith("net_1"));
  });

  it("refetches when the store refresh token is bumped (server/workspace created elsewhere)", async () => {
    const getNetwork = vi.spyOn(networksApi, "getNetwork").mockResolvedValue({
      network: { id: "net_1", name: "Mon Network", tier: "free" },
      projects: [],
      serverKeys: [{ id: "sk_1", label: "Survival" }],
    });
    render(<ProjectSidebar />);
    await waitFor(() => expect(getNetwork).toHaveBeenCalledTimes(1));

    // A page (network hub, wizard…) creates a server, then signals the refresh.
    getNetwork.mockResolvedValue({
      network: { id: "net_1", name: "Mon Network", tier: "free" },
      projects: [],
      serverKeys: [
        { id: "sk_1", label: "Survival" },
        { id: "sk_2", label: "Creatif" },
      ],
    });
    act(() => useNetworksStore.getState().bumpRefresh());

    await waitFor(() => expect(getNetwork.mock.calls.length).toBeGreaterThanOrEqual(2));
  });
});
