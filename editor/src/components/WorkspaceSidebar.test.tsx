import { describe, expect, it, beforeEach, vi } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import { WorkspaceSidebar } from "./WorkspaceSidebar";
import { useNetworksStore } from "@/state/networksStore";
import { useSessionStore } from "@/state/sessionStore";
import * as networksApi from "@/lib/api/networks";

vi.mock("@tanstack/react-router", async () => {
  const actual = await vi.importActual<typeof import("@tanstack/react-router")>("@tanstack/react-router");
  return {
    ...actual,
    useNavigate: () => vi.fn(),
    useParams: () => ({}),
    useSearch: () => ({}),
    Link: ({ children, to, params, ...props }: any) => (
      <a href={to} {...props}>
        {children}
      </a>
    ),
  };
});

describe("WorkspaceSidebar", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
    useNetworksStore.setState({
      networks: [{ id: "net_1", name: "Mon Network", tier: "free" }],
    } as any);
    useSessionStore.setState({ networkId: "net_1" } as any);
  });

  it("renders the active network name (via NetworkDropdown)", () => {
    vi.spyOn(networksApi, "getNetwork").mockResolvedValue({
      network: { id: "net_1", name: "Mon Network", tier: "free" },
      packs: [],
      serverKeys: [],
    });
    render(<WorkspaceSidebar />);
    expect(screen.getByText("Mon Network")).toBeInTheDocument();
  });

  it("lists workspaces returned by getNetwork, sorted alphabetically by id", async () => {
    vi.spyOn(networksApi, "getNetwork").mockResolvedValue({
      network: { id: "net_1", name: "Mon Network", tier: "free" },
      packs: [
        { id: "pack_b", name: "Menu principal", hash: "h2", updatedAt: "2026-05-26T10:00:00Z" },
        { id: "pack_a", name: "Lobby", hash: "h1", updatedAt: "2026-05-25T10:00:00Z" },
      ],
      serverKeys: [],
    });
    render(<WorkspaceSidebar />);
    const items = await screen.findAllByRole("link", { name: /Menu principal|Lobby/ });
    // Sort is by id (stable, deterministic), so pack_a comes before pack_b.
    expect(items[0]).toHaveTextContent("Lobby");
    expect(items[1]).toHaveTextContent("Menu principal");
  });

  it("renders the Modules empty state", async () => {
    vi.spyOn(networksApi, "getNetwork").mockResolvedValue({
      network: { id: "net_1", name: "Mon Network", tier: "free" },
      packs: [],
      serverKeys: [],
    });
    render(<WorkspaceSidebar />);
    expect(await screen.findByText(/Aucun module installé/i)).toBeInTheDocument();
  });

  it("renders the + Nouveau workspace link", async () => {
    vi.spyOn(networksApi, "getNetwork").mockResolvedValue({
      network: { id: "net_1", name: "Mon Network", tier: "free" },
      packs: [],
      serverKeys: [],
    });
    render(<WorkspaceSidebar />);
    expect(await screen.findByText(/Nouveau workspace/i)).toBeInTheDocument();
  });

  it("renders the user menu pill (Settings link lives inside its dropdown)", async () => {
    vi.spyOn(networksApi, "getNetwork").mockResolvedValue({
      network: { id: "net_1", name: "Mon Network", tier: "free" },
      packs: [],
      serverKeys: [],
    });
    render(<WorkspaceSidebar />);
    expect(await screen.findByText(/Anonymous|Anonyme/i)).toBeInTheDocument();
  });

  it("refetches when networkId changes", async () => {
    const getNetwork = vi.spyOn(networksApi, "getNetwork").mockResolvedValue({
      network: { id: "net_1", name: "Mon Network", tier: "free" },
      packs: [],
      serverKeys: [],
    });
    render(<WorkspaceSidebar />);
    await waitFor(() => expect(getNetwork).toHaveBeenCalledWith("net_1"));
    useSessionStore.setState({ networkId: "net_2" } as any);
    await waitFor(() => expect(getNetwork).toHaveBeenCalledWith("net_2"));
  });
});
