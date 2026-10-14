import * as networksApi from "@/lib/api/networks";
import { listServerProjects } from "@/lib/api/projectFiles";
import { useServerIndexStore } from "@/features/serverIndex/serverIndexStore";
import { useAccountStore } from "@/state/accountStore";
import { useNetworksStore } from "@/state/networksStore";
import { useServersStore } from "@/state/serversStore";
import { act, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { ProjectSidebar } from "./ProjectSidebar";

const mockParams = vi.hoisted(() => ({
  current: { serverId: "sk_1" } as {
    serverId?: string;
    projectId?: string;
  },
}));

// The Project list comes from the active server's DISK (ADR
// `server-disk-only-storage`): the folder IS the identity, so the label
// shown is its folder name.
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
    // A previous test's `mockResolvedValue` would otherwise survive: reset the
    // default disk response before each test.
    vi.mocked(listServerProjects).mockResolvedValue({
      ok: true,
      projectIds: ["pack_a", "pack_b"],
    });
    mockParams.current = { serverId: "sk_1" };
    useNetworksStore.setState({
      networks: [{ id: "net_1", name: "Mon Network", tier: "free" }],
    } as any);
    useServersStore.setState({ activeServerId: null } as any);
    useAccountStore.setState({ account: { id: "", projects: [], projectOrder: [] } } as any);
  });

  it("lists the active server's Projects from its disk, sorted", async () => {
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
    // The order comes from the plugin (sorted folders): pack_a before pack_b. The
    // label is the folder name, which is the identity.
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
    expect(link).toHaveAttribute("href", "/servers/$serverId/projects/$projectId");
  });

  describe("document tree of the open project", () => {
    const loaded = (id: string) =>
      ({
        id,
        name: id,
        defaultLang: "fr",
        i18nKeys: {},
        menus: [{ id: "accueil", rows: 3, layers: [], title: [] }],
        commands: [{ id: "c_heal", name: "heal", arguments: [], steps: [] }],
        dialogs: [],
      }) as never;

    beforeEach(() => {
      vi.spyOn(networksApi, "getNetwork").mockResolvedValue({
        network: { id: "net_1", name: "Mon Network", tier: "free" },
        projects: [],
        serverKeys: [{ id: "sk_1", label: "Survival" }],
      });
      useAccountStore.setState({
        account: { id: "", projects: [loaded("pack_a"), loaded("pack_b")], projectOrder: [] },
      } as never);
      useServerIndexStore.getState().reset();
    });

    it("expands the open project into its documents, grouped by type", async () => {
      mockParams.current = { serverId: "sk_1", projectId: "pack_a" };
      render(<ProjectSidebar />);
      const tree = await screen.findByRole("group", { name: /pack_a/ });
      expect(tree).toHaveTextContent("accueil");
      expect(tree).toHaveTextContent("/heal");
    });

    it("puts settings and creation on the open project's row, no more 'Settings' row", async () => {
      mockParams.current = { serverId: "sk_1", projectId: "pack_a" };
      render(<ProjectSidebar />);
      const tree = await screen.findByRole("group", { name: /pack_a/ });
      const row = screen.getByRole("link", { name: /pack_a/ }).parentElement as HTMLElement;
      expect(within(row).getByTestId("project-settings")).toBeInTheDocument();
      expect(within(row).getByTestId("project-create")).toBeInTheDocument();
      expect(within(tree).queryByTestId("project-settings")).toBeNull();
      expect(tree).not.toHaveTextContent(/Paramètres du projet/);
    });

    it("does not expand projects that are not open", async () => {
      mockParams.current = { serverId: "sk_1", projectId: "pack_a" };
      render(<ProjectSidebar />);
      await screen.findByRole("group", { name: /pack_a/ });
      expect(screen.getAllByRole("group", { name: /documents/i })).toHaveLength(1);
    });

    it("expands another project on demand, from its published state", async () => {
      mockParams.current = { serverId: "sk_1", projectId: "pack_a" };
      useServerIndexStore.setState({
        scope: "net_1/sk_1",
        status: "ready",
        failed: [],
        projects: [
          {
            id: "pack_b",
            name: "pack_b",
            defaultLang: "fr",
            i18nKeys: {},
            menus: [{ id: "catalogue", rows: 3, layers: [], title: [] }],
            commands: [],
            dialogs: [],
          } as never,
        ],
      });
      render(<ProjectSidebar />);
      const toggle = await screen.findByRole("button", { name: /pack_b/, expanded: false });
      expect(screen.queryByRole("group", { name: /Documents de pack_b/ })).toBeNull();
      fireEvent.click(toggle);
      expect(screen.getByRole("group", { name: /Documents de pack_b/ })).toHaveTextContent(
        "catalogue",
      );
      expect(toggle).toHaveAttribute("aria-expanded", "true");
    });

    it("shows the open project even when it is not listed (demo, no network)", async () => {
      mockParams.current = { projectId: "pack_a" };
      useNetworksStore.setState({ networks: [] } as never);
      render(<ProjectSidebar />);
      const tree = await screen.findByRole("group", { name: /Documents de pack_a/ });
      expect(tree).toHaveTextContent("accueil");
    });

    it("expands nothing outside a project", async () => {
      render(<ProjectSidebar />);
      await screen.findByRole("link", { name: /pack_a/ });
      expect(screen.queryByRole("group", { name: /documents/i })).toBeNull();
    });
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
    // Routes may put a slug (not the id) in the serverId param.
    mockParams.current = { serverId: "survival" };
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

  it("falls back to the persisted server selection on routes without a serverId param", async () => {
    // e.g. /settings or /credits — no serverId in the URL.
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
  });

  // A persisted server that no longer exists cannot "fall back to the whole
  // network": a Project belongs to a server and is read from ITS disk
  // (ADR `server-disk-only-storage`). There is nothing to list — the server
  // picker stays there to choose a real one.
  it("a persisted server that vanished lists nothing rather than another server's list", async () => {
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
   * Same requirement as a server page: an empty list asserted while reading, or
   * for an offline server, reads as "this server has nothing" — and the "New
   * project" button then invites writing to a disk that cannot be reached.
   */
  it("says it is reading rather than showing an empty list", async () => {
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

  it("says the server is unreachable, and no longer invites creating a project there", async () => {
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

  it("brings the create button back once the read has succeeded", async () => {
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

  it("persists the URL server (slug resolved to id) into the store", async () => {
    mockParams.current = { serverId: "survival" };
    useNetworksStore.setState({
      networks: [{ id: "net_1", name: "Mon Network", slug: "mon-network", tier: "free" }],
    } as any);
    vi.spyOn(networksApi, "getNetwork").mockResolvedValue({
      network: { id: "net_1", name: "Mon Network", slug: "mon-network", tier: "free" },
      projects: [],
      serverKeys: [{ id: "sk_1", label: "Survival", slug: "survival" }],
    });
    render(<ProjectSidebar />);
    await waitFor(() => expect(useServersStore.getState().activeServerId).toBe("sk_1"));
  });

  it("reads the hub's single network", async () => {
    const getNetwork = vi.spyOn(networksApi, "getNetwork").mockResolvedValue({
      network: { id: "net_1", name: "Mon Network", tier: "free" },
      projects: [],
      serverKeys: [],
    });
    render(<ProjectSidebar />);
    await waitFor(() => expect(getNetwork).toHaveBeenCalledWith());
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
