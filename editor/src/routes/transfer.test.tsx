import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, waitFor, fireEvent } from "@testing-library/react";
import { useAuthStore } from "@/state/authStore";
import * as networksApi from "@/lib/api/networks";

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
    currentUser: user ? { id: user.id, email: user.email, name: "" } : null,
    isLoading: false,
  } as any);
}

describe("/transfer?token=...", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
    navigate.mockClear();
  });

  it("redirects to /login when not authenticated", async () => {
    setUrl("?token=TOK");
    mockUser(null);
    const { default: TransferRoute } = await import("./transfer");
    render(<TransferRoute />);
    await waitFor(() =>
      expect(navigate).toHaveBeenCalledWith({
        to: "/login",
        search: { next: "/transfer?token=TOK" },
      }),
    );
  });

  it("shows transfer info and lets user accept", async () => {
    setUrl("?token=TOK");
    mockUser({ id: "u1", email: "i@a.b" });
    vi.spyOn(networksApi, "getNetworkTransfer").mockResolvedValue({
      networkId: "n1",
      networkName: "Alpha",
      packCount: 3,
      serverKeyCount: 1,
      expiresAt: "2026-05-23T00:00:00Z",
    });
    const acceptSpy = vi.spyOn(networksApi, "acceptNetworkTransfer").mockResolvedValue({ networkId: "n1" });

    const { default: TransferRoute } = await import("./transfer");
    render(<TransferRoute />);

    await screen.findByText(/Alpha/);
    expect(screen.getByText(/3 packs/)).toBeTruthy();
    expect(screen.getByText(/1 server_key/)).toBeTruthy();

    const acceptButton = screen.getByText(/Accepter/i);
    fireEvent.click(acceptButton);

    await waitFor(() => expect(acceptSpy).toHaveBeenCalledWith("TOK"));
    await screen.findByText(/Transfert accepté/i);
  });

  it("shows expired message when token is expired", async () => {
    setUrl("?token=TOK");
    mockUser({ id: "u1", email: "i@a.b" });
    vi.spyOn(networksApi, "getNetworkTransfer").mockResolvedValue("expired");
    const { default: TransferRoute } = await import("./transfer");
    render(<TransferRoute />);
    await screen.findByText(/expiré/i);
  });

  it("shows consumed message when token is consumed", async () => {
    setUrl("?token=TOK");
    mockUser({ id: "u1", email: "i@a.b" });
    vi.spyOn(networksApi, "getNetworkTransfer").mockResolvedValue("consumed");
    const { default: TransferRoute } = await import("./transfer");
    render(<TransferRoute />);
    await screen.findByText(/déjà utilisé|déjà été utilisé/i);
  });

  it("shows not found on 404", async () => {
    setUrl("?token=TOK");
    mockUser({ id: "u1", email: "i@a.b" });
    vi.spyOn(networksApi, "getNetworkTransfer").mockResolvedValue("not_found");
    const { default: TransferRoute } = await import("./transfer");
    render(<TransferRoute />);
    await screen.findByText(/introuvable/i);
  });

  it("shows error on fetch failure", async () => {
    setUrl("?token=TOK");
    mockUser({ id: "u1", email: "i@a.b" });
    vi.spyOn(networksApi, "getNetworkTransfer").mockRejectedValue(new Error("Network error"));
    const { default: TransferRoute } = await import("./transfer");
    render(<TransferRoute />);
    await screen.findByText(/Erreur lors du chargement/i);
  });
});
