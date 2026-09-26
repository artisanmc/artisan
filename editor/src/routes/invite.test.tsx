import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, waitFor, fireEvent } from "@testing-library/react";
import { useAuthStore } from "@/state/authStore";
import * as invitesApi from "@/lib/api/invites";

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

describe("/invite?code=...", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
    navigate.mockClear();
  });

  it("renders preview with network name and role, join CTA when logged in", async () => {
    setUrl("?code=CODE1");
    mockUser({ id: "u1", email: "i@a.b" });
    vi.spyOn(invitesApi, "fetchInvitePreview").mockResolvedValue({
      status: "valid",
      networkName: "Acme",
      role: "member",
    });
    const { default: InviteRoute } = await import("./invite");
    render(<InviteRoute />);

    await screen.findByRole("heading", { name: /Acme/ });
    expect(screen.getByRole("button", { name: /Rejoindre/i })).toBeTruthy();
  });

  it("accepts the invite and navigates to the returned network", async () => {
    setUrl("?code=CODE1");
    mockUser({ id: "u1", email: "i@a.b" });
    vi.spyOn(invitesApi, "fetchInvitePreview").mockResolvedValue({
      status: "valid",
      networkName: "Acme",
      role: "member",
    });
    vi.spyOn(invitesApi, "acceptInvite").mockResolvedValue({
      networkId: "n1",
      alreadyMember: false,
    });

    const { default: InviteRoute } = await import("./invite");
    render(<InviteRoute />);

    const joinButton = await screen.findByRole("button", { name: /Rejoindre/i });
    fireEvent.click(joinButton);

    await waitFor(() =>
      expect(navigate).toHaveBeenCalledWith({
        to: "/networks/$networkId",
        params: { networkId: "n1" },
      }),
    );
  });

  it("shows already-member message with CTA when accept reports already_member", async () => {
    setUrl("?code=CODE1");
    mockUser({ id: "u1", email: "i@a.b" });
    vi.spyOn(invitesApi, "fetchInvitePreview").mockResolvedValue({
      status: "valid",
      networkName: "Acme",
      role: "member",
    });
    vi.spyOn(invitesApi, "acceptInvite").mockResolvedValue({
      networkId: "n1",
      alreadyMember: true,
    });

    const { default: InviteRoute } = await import("./invite");
    render(<InviteRoute />);

    const joinButton = await screen.findByRole("button", { name: /Rejoindre/i });
    fireEvent.click(joinButton);

    await screen.findByText(/déjà membre/i);
  });

  it("explains the collaborator limit when the invitation cannot be accepted", async () => {
    setUrl("?code=CODE1");
    mockUser({ id: "u1", email: "i@a.b" });
    vi.spyOn(invitesApi, "fetchInvitePreview").mockResolvedValue({ status: "valid", networkName: "Acme", role: "member" });
    vi.spyOn(invitesApi, "acceptInvite").mockRejectedValue(new invitesApi.AcceptInviteError("collaborator_limit_reached"));
    const { default: InviteRoute } = await import("./invite");
    render(<InviteRoute />);
    fireEvent.click(await screen.findByRole("button", { name: /Rejoindre/i }));
    expect(await screen.findByText(/limite de collaborateurs/i)).toBeVisible();
  });

  it("shows expired message", async () => {
    setUrl("?code=CODE1");
    mockUser({ id: "u1", email: "i@a.b" });
    vi.spyOn(invitesApi, "fetchInvitePreview").mockResolvedValue({
      status: "expired",
      networkName: "Acme",
      role: "member",
    });
    const { default: InviteRoute } = await import("./invite");
    render(<InviteRoute />);
    await screen.findByText(/expiré/i);
  });

  it("shows revoked message", async () => {
    setUrl("?code=CODE1");
    mockUser({ id: "u1", email: "i@a.b" });
    vi.spyOn(invitesApi, "fetchInvitePreview").mockResolvedValue({
      status: "revoked",
      networkName: "Acme",
      role: "member",
    });
    const { default: InviteRoute } = await import("./invite");
    render(<InviteRoute />);
    await screen.findByText(/révoquée|annulée/i);
  });

  it("shows exhausted message", async () => {
    setUrl("?code=CODE1");
    mockUser({ id: "u1", email: "i@a.b" });
    vi.spyOn(invitesApi, "fetchInvitePreview").mockResolvedValue({
      status: "exhausted",
      networkName: "Acme",
      role: "member",
    });
    const { default: InviteRoute } = await import("./invite");
    render(<InviteRoute />);
    await screen.findByText(/épuisée|limite/i);
  });

  it("shows not found on 404", async () => {
    setUrl("?code=BADCODE");
    mockUser({ id: "u1", email: "i@a.b" });
    vi.spyOn(invitesApi, "fetchInvitePreview").mockResolvedValue("not_found");
    const { default: InviteRoute } = await import("./invite");
    render(<InviteRoute />);
    await screen.findByText(/introuvable/i);
  });

  it("shows error on fetch failure", async () => {
    setUrl("?code=CODE1");
    mockUser({ id: "u1", email: "i@a.b" });
    vi.spyOn(invitesApi, "fetchInvitePreview").mockRejectedValue(new Error("Network error"));
    const { default: InviteRoute } = await import("./invite");
    render(<InviteRoute />);
    await screen.findByText(/erreur/i);
  });

  it("shows login CTA (no accept button) when not authenticated", async () => {
    setUrl("?code=CODE1");
    mockUser(null);
    vi.spyOn(invitesApi, "fetchInvitePreview").mockResolvedValue({
      status: "valid",
      networkName: "Acme",
      role: "member",
    });
    const { default: InviteRoute } = await import("./invite");
    render(<InviteRoute />);

    await screen.findByRole("heading", { name: /Acme/ });
    expect(screen.queryByRole("button", { name: /Rejoindre/i })).toBeNull();
    const loginButton = screen.getByRole("button", { name: /connecter/i });
    fireEvent.click(loginButton);

    expect(navigate).toHaveBeenCalledWith({
      to: "/login",
      search: { next: "/invite?code=CODE1" },
    });
  });
});
