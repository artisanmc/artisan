import * as networksApi from "@/lib/api/networks";
import { useAccountStore } from "@/state/accountStore";
import { useNetworksStore } from "@/state/networksStore";
import { useSessionStore } from "@/state/sessionStore";
import { useUiStore } from "@/state/uiStore";
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
    mockParams.current = { networkId: "net_1", serverId: "sk_1" };
    useNetworksStore.setState({
      networks: [{ id: "net_1", name: "Mon Network", tier: "free" }],
    } as any);
    useSessionStore.setState({ networkId: "net_1" } as any);
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

  it("lists workspaces returned by getNetwork, sorted alphabetically by id", async () => {
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
    const items = await screen.findAllByRole("link", { name: /Menu principal|Lobby/ });
    // Sort is by id (stable, deterministic), so pack_a comes before pack_b.
    expect(items[0]).toHaveTextContent("Lobby");
    expect(items[1]).toHaveTextContent("Menu principal");
  });

  it("shows an element-count badge from the pack summary", async () => {
    vi.spyOn(networksApi, "getNetwork").mockResolvedValue({
      network: { id: "net_1", name: "Mon Network", tier: "free" },
      projects: [
        {
          id: "pack_a",
          name: "Lobby",
          hash: "h1",
          networkId: "net_1",
          serverKeyId: "sk_1",
          elementCount: 3,
        },
      ],
      serverKeys: [{ id: "sk_1", label: "Survival" }],
    });
    render(<ProjectSidebar />);
    await screen.findByRole("link", { name: /Lobby/ });
    expect(screen.getByText("3")).toBeInTheDocument();
  });

  it("workspace links use the server-scoped URL pattern", async () => {
    vi.spyOn(networksApi, "getNetwork").mockResolvedValue({
      network: { id: "net_1", name: "Mon Network", tier: "free" },
      projects: [{ id: "pack_a", name: "Lobby", hash: "h1", networkId: "net_1", serverKeyId: "sk_1" }],
      serverKeys: [{ id: "sk_1", label: "Survival" }],
    });
    render(<ProjectSidebar />);
    const link = await screen.findByRole("link", { name: /Lobby/ });
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
    useSessionStore.setState({ networkId: null, serverKeyId: null } as any);
    vi.spyOn(networksApi, "getNetwork").mockResolvedValue({
      network: { id: "net_1", name: "Mon Network", slug: "mon-network", tier: "free" },
      projects: [{ id: "pack_a", name: "Lobby", hash: "h1", networkId: "net_1", serverKeyId: "sk_1" }],
      serverKeys: [{ id: "sk_1", label: "Survival", slug: "survival" }],
    });
    render(<ProjectSidebar />);
    expect(await screen.findByRole("link", { name: /Lobby/ })).toBeInTheDocument();
  });

  it("shows the active server label in ServerSelector when the URL carries the server slug", async () => {
    mockParams.current = { networkId: "mon-network", serverId: "survival" };
    useNetworksStore.setState({
      networks: [{ id: "net_1", name: "Mon Network", slug: "mon-network", tier: "free" }],
    } as any);
    useSessionStore.setState({ networkId: null, serverKeyId: null } as any);
    vi.spyOn(networksApi, "getNetwork").mockResolvedValue({
      network: { id: "net_1", name: "Mon Network", slug: "mon-network", tier: "free" },
      projects: [],
      serverKeys: [{ id: "sk_1", label: "Survival", slug: "survival" }],
    });
    render(<ProjectSidebar />);
    expect(await screen.findByText("Survival")).toBeInTheDocument();
  });

  it("shows a missing-translations badge on the active workspace's Translations sub-tab", async () => {
    mockParams.current = { networkId: "net_1", serverId: "sk_1", projectId: "pack_a" };
    // Badge mirrors the panel's active-language headline — view "fr".
    useUiStore.setState({ activeLang: "fr" } as any);
    vi.spyOn(networksApi, "getNetwork").mockResolvedValue({
      network: { id: "net_1", name: "Mon Network", tier: "free" },
      projects: [{ id: "pack_a", name: "Lobby", hash: "h1", networkId: "net_1", serverKeyId: "sk_1" }],
      serverKeys: [{ id: "sk_1", label: "Survival" }],
    });
    useAccountStore.setState({
      account: {
        id: "",
        projectOrder: [],
        projects: [
          {
            id: "pack_a",
            name: "Lobby",
            defaultLang: "en",
            i18nKeys: {
              k1: { en: "Hello" }, // missing fr → 1 missing
              k2: { en: "Bye", fr: "Au revoir" },
            },
            menus: [],
            commands: [],
            dialogs: [],
            assets: [],
          },
        ],
      },
    } as any);
    render(<ProjectSidebar />);
    await screen.findByRole("link", { name: /Lobby/ });
    const badge = await screen.findByLabelText(/manquante|missing translation/i);
    expect(badge).toHaveTextContent("1");
  });

  it("hides the translations badge when nothing is missing", async () => {
    mockParams.current = { networkId: "net_1", serverId: "sk_1", projectId: "pack_a" };
    useUiStore.setState({ activeLang: "fr" } as any);
    vi.spyOn(networksApi, "getNetwork").mockResolvedValue({
      network: { id: "net_1", name: "Mon Network", tier: "free" },
      projects: [{ id: "pack_a", name: "Lobby", hash: "h1", networkId: "net_1", serverKeyId: "sk_1" }],
      serverKeys: [{ id: "sk_1", label: "Survival" }],
    });
    useAccountStore.setState({
      account: {
        id: "",
        projectOrder: [],
        projects: [
          {
            id: "pack_a",
            name: "Lobby",
            defaultLang: "en",
            i18nKeys: { k1: { en: "Hello", fr: "Bonjour" } },
            menus: [],
            commands: [],
            dialogs: [],
            assets: [],
          },
        ],
      },
    } as any);
    render(<ProjectSidebar />);
    await screen.findByRole("link", { name: /Lobby/ });
    expect(screen.queryByLabelText(/manquante|missing translation/i)).not.toBeInTheDocument();
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
