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

  it("auto-claims when user has 0 networks", async () => {
    setUrl("?code=ABC123");
    mockUser({ id: "u1", email: "test@x" });
    vi.spyOn(api, "listNetworks").mockResolvedValue([]);
    const claimSpy = vi
      .spyOn(api, "claimLinkCode")
      .mockResolvedValue({ server_key_id: "sk", network_id: "n1" });
    const { default: LinkRoute } = await import("./link");
    render(<LinkRoute />);
    await waitFor(() => expect(claimSpy).toHaveBeenCalledWith("ABC123"));
    await screen.findByText(/Setup terminé/i);
  });

  it("shows confirm UI when user has exactly 1 network", async () => {
    setUrl("?code=ABC123");
    mockUser({ id: "u1", email: "test@x" });
    vi.spyOn(api, "listNetworks").mockResolvedValue([
      { id: "n1", name: "My Net", tier: "free" },
    ]);
    const claimSpy = vi
      .spyOn(api, "claimLinkCode")
      .mockResolvedValue({ server_key_id: "sk", network_id: "n1" });
    const { default: LinkRoute } = await import("./link");
    render(<LinkRoute />);
    await screen.findByText("My Net");
    fireEvent.click(screen.getByText(/Confirmer/i));
    await waitFor(() => expect(claimSpy).toHaveBeenCalledWith("ABC123", "n1"));
  });

  it("shows picker when user has 2+ networks", async () => {
    setUrl("?code=ABC123");
    mockUser({ id: "u1", email: "test@x" });
    vi.spyOn(api, "listNetworks").mockResolvedValue([
      { id: "n1", name: "A", tier: "free" },
      { id: "n2", name: "B", tier: "free" },
    ]);
    const claimSpy = vi
      .spyOn(api, "claimLinkCode")
      .mockResolvedValue({ server_key_id: "sk", network_id: "n2" });
    const { default: LinkRoute } = await import("./link");
    render(<LinkRoute />);
    await screen.findByText("A");
    await screen.findByText("B");
    fireEvent.click(screen.getByText("B"));
    fireEvent.click(screen.getByText(/Confirmer/i));
    await waitFor(() => expect(claimSpy).toHaveBeenCalledWith("ABC123", "n2"));
  });
});
