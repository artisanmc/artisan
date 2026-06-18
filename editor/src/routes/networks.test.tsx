import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import { NetworksPage } from "./networks";
import { useNetworksStore } from "@/state/networksStore";
import * as networksApi from "@/lib/api/networks";

vi.mock("@/state/authStore", () => ({
  useAuthStore: (sel: (s: { currentUser: { id: string; name: string } | null }) => unknown) =>
    sel({ currentUser: { id: "u1", name: "Iban" } }),
}));

vi.mock("@tanstack/react-router", async () => {
  const actual = await vi.importActual<typeof import("@tanstack/react-router")>("@tanstack/react-router");
  return {
    ...actual,
    useChildMatches: () => [],
    Link: ({ children, ...props }: any) => <a {...props}>{children}</a>,
  };
});

// Mock NewServerModal to avoid its internal router/dialog deps
vi.mock("@/components/network-detail/NewServerModal", () => ({
  NewServerModal: ({ open }: { open: boolean }) =>
    open ? <div data-testid="new-server-modal" /> : null,
}));

describe("NetworksPage — hub layout", () => {
  beforeEach(() => {
    useNetworksStore.getState().reset();
    vi.restoreAllMocks();
  });

  it("renders each network as a section with its name", async () => {
    vi.spyOn(networksApi, "listNetworks").mockResolvedValue([
      { id: "n1", name: "Survival Network", tier: "free" },
      { id: "n2", name: "Creative Network", tier: "free" },
    ]);
    vi.spyOn(networksApi, "getNetwork").mockImplementation(async (id) => ({
      network: { id, name: id === "n1" ? "Survival Network" : "Creative Network", tier: "free" },
      serverKeys: [],
      projects: [],
    }));

    render(<NetworksPage />);

    await waitFor(() => expect(screen.getByText("Survival Network")).toBeTruthy());
    expect(screen.getByText("Creative Network")).toBeTruthy();
  });

  it("renders server rows inside each network section", async () => {
    vi.spyOn(networksApi, "listNetworks").mockResolvedValue([
      { id: "n1", name: "Survival", tier: "free" },
    ]);
    vi.spyOn(networksApi, "getNetwork").mockResolvedValue({
      network: { id: "n1", name: "Survival", tier: "free" },
      serverKeys: [
        { id: "sk_abcd1234efgh", label: "Main Server" },
        { id: "sk_xyz987654321", label: null },
      ],
      projects: [
        { id: "p1", name: "Project A", hash: "", updatedAt: "", networkId: "n1", serverKeyId: "sk_abcd1234efgh" },
        { id: "p2", name: "Project B", hash: "", updatedAt: "", networkId: "n1", serverKeyId: "sk_abcd1234efgh" },
      ],
    });

    render(<NetworksPage />);

    await waitFor(() => expect(screen.getByText("Main Server")).toBeTruthy());
    // Unlabelled server should show friendly fallback
    expect(screen.getByText("Server xyz9")).toBeTruthy();
    // Project counts — bilingual: tests run in French but English form is accepted too
    const projectCounts = screen.getAllByText(/\d+ projets?/i);
    expect(projectCounts.length).toBeGreaterThanOrEqual(1);
  });

  it("shows 'no server yet' state when network has no servers", async () => {
    vi.spyOn(networksApi, "listNetworks").mockResolvedValue([
      { id: "n1", name: "Empty Net", tier: "free" },
    ]);
    vi.spyOn(networksApi, "getNetwork").mockResolvedValue({
      network: { id: "n1", name: "Empty Net", tier: "free" },
      serverKeys: [],
      projects: [],
    });

    render(<NetworksPage />);

    await waitFor(() => expect(screen.getByText("Empty Net")).toBeTruthy());
    expect(screen.getByText(/No server yet|Aucun serveur/i)).toBeTruthy();
  });

  it("shows empty state when user has no networks", async () => {
    vi.spyOn(networksApi, "listNetworks").mockResolvedValue([]);
    vi.spyOn(networksApi, "getNetwork").mockResolvedValue({ network: { id: "", name: "", tier: "free" }, serverKeys: [], projects: [] });

    render(<NetworksPage />);

    await waitFor(() => expect(screen.getByText(/No network|Aucun network/i)).toBeTruthy());
  });
});
