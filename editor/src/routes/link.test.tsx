import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, waitFor, fireEvent } from "@testing-library/react";
import { useAuthStore } from "@/state/authStore";
import * as api from "@/lib/api/networks";

const navigate = vi.fn();
vi.mock("@tanstack/react-router", async () => {
  const actual =
    await vi.importActual<typeof import("@tanstack/react-router")>(
      "@tanstack/react-router",
    );
  return {
    ...actual,
    useNavigate: () => navigate,
  };
});

function setUrl(search: string) {
  Object.defineProperty(window, "location", {
    writable: true,
    value: { ...window.location, search },
  });
}

function mockUser(user: { id: string; email: string } | null) {
  useAuthStore.setState({
    currentUser: user ? { id: user.id, email: user.email, name: "", avatarUrl: null } : null,
    isLoading: false,
  });
}

describe("/link?code=...", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
    navigate.mockClear();
  });

  it("redirects to /login?next=... when not authenticated", async () => {
    setUrl("?code=ABC123");
    mockUser(null);
    const { default: LinkRoute } = await import("./link");
    render(<LinkRoute />);
    await waitFor(() =>
      expect(navigate).toHaveBeenCalledWith({
        to: "/login",
        search: { next: "/link?code=ABC123" },
      }),
    );
  });

  it("shows the network picker even when user has 0 networks", async () => {
    setUrl("?code=ABC123");
    mockUser({ id: "u1", email: "test@x" });
    vi.spyOn(api, "listNetworks").mockResolvedValue([]);
    const { default: LinkRoute } = await import("./link");
    render(<LinkRoute />);
    // No auto-claim — the picker shows up with the "create new network" input
    await screen.findByPlaceholderText(/my_network/i);
  });

  it("creates a new network + pack inline via the picker flow", async () => {
    setUrl("?code=ABC123");
    mockUser({ id: "u1", email: "test@x" });
    vi.spyOn(api, "listNetworks").mockResolvedValue([]);
    const claimSpy = vi
      .spyOn(api, "claimLinkCode")
      .mockResolvedValue({ server_key_id: "sk", network_id: "n_new", pack_id: "p_new" });
    const { default: LinkRoute } = await import("./link");
    render(<LinkRoute />);

    // Step 1 — type a new network name
    fireEvent.change(await screen.findByPlaceholderText(/my_network/i), {
      target: { value: "Vaelheim" },
    });
    fireEvent.click(screen.getAllByText(/Suivant|Next/i)[0]!);

    // Step 2 — type a new pack name
    fireEvent.change(await screen.findByPlaceholderText(/my_workspace/i), {
      target: { value: "Lobby" },
    });
    fireEvent.click(screen.getAllByText(/Suivant|Next/i)[0]!);

    // Step 3 — confirm
    fireEvent.click(await screen.findByText(/Confirmer|^Confirm$/i));
    await waitFor(() => {
      expect(claimSpy).toHaveBeenCalledWith("ABC123", {
        networkId: undefined,
        networkName: "Vaelheim",
        packId: undefined,
        packName: "Lobby",
        serverKeyLabel: undefined,
      });
    });
  });

  it("lets the user pick an existing network + pack via the picker flow", async () => {
    setUrl("?code=ABC123");
    mockUser({ id: "u1", email: "test@x" });
    vi.spyOn(api, "listNetworks").mockResolvedValue([
      { id: "n1", name: "My Net", tier: "free" },
    ]);
    vi.spyOn(api, "getNetwork").mockResolvedValue({
      network: { id: "n1", name: "My Net", tier: "free" },
      packs: [{ id: "p1", name: "menu_principal", hash: "h", updatedAt: "2026-05-01T00:00:00Z" }],
      serverKeys: [],
    });
    const claimSpy = vi
      .spyOn(api, "claimLinkCode")
      .mockResolvedValue({ server_key_id: "sk", network_id: "n1", pack_id: "p1" });
    const { default: LinkRoute } = await import("./link");
    render(<LinkRoute />);

    fireEvent.click(await screen.findByText("My Net"));
    fireEvent.click(screen.getAllByText(/Suivant|Next/i)[0]!);
    fireEvent.click(await screen.findByText("menu_principal"));
    fireEvent.click(screen.getAllByText(/Suivant|Next/i)[0]!);
    fireEvent.click(await screen.findByText(/Confirmer|^Confirm$/i));

    await waitFor(() => {
      expect(claimSpy).toHaveBeenCalledWith("ABC123", {
        networkId: "n1",
        networkName: undefined,
        packId: "p1",
        packName: undefined,
        serverKeyLabel: undefined,
      });
    });
  });
});
