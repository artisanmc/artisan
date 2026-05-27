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

  it("lists workspaces returned by getNetwork, sorted by updatedAt desc", async () => {
    vi.spyOn(networksApi, "getNetwork").mockResolvedValue({
      network: { id: "net_1", name: "Mon Network", tier: "free" },
      packs: [
        { id: "pack_a", name: "Lobby", hash: "h1", updatedAt: "2026-05-25T10:00:00Z" },
        { id: "pack_b", name: "Menu principal", hash: "h2", updatedAt: "2026-05-26T10:00:00Z" },
      ],
      serverKeys: [],
    });
    render(<WorkspaceSidebar />);
    const items = await screen.findAllByRole("link", { name: /Menu principal|Lobby/ });
    // First item should be Menu principal (most recent updatedAt)
    expect(items[0]).toHaveTextContent("Menu principal");
    expect(items[1]).toHaveTextContent("Lobby");
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

  it("renders a Settings link to /settings", async () => {
    vi.spyOn(networksApi, "getNetwork").mockResolvedValue({
      network: { id: "net_1", name: "Mon Network", tier: "free" },
      packs: [],
      serverKeys: [],
    });
    render(<WorkspaceSidebar />);
    const link = await screen.findByRole("link", { name: /Settings|Paramètres/i });
    expect(link).toHaveAttribute("href", "/settings");
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
