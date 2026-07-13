import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";

const navigateSpy = vi.hoisted(() => vi.fn());

const authState = vi.hoisted(() => ({
  currentUser: { id: "u1", name: "Iban" } as { id: string; name: string } | null,
  isLoading: false,
}));

vi.mock("@/state/authStore", () => ({
  useAuthStore: (sel: (s: typeof authState) => unknown) => sel(authState),
}));

function setUrl(pathname: string, search = "") {
  Object.defineProperty(window, "location", {
    writable: true,
    value: { ...window.location, pathname, search },
  });
}

vi.mock("@tanstack/react-router", async () => {
  const actual = await vi.importActual<typeof import("@tanstack/react-router")>("@tanstack/react-router");
  return {
    ...actual,
    useChildMatches: () => [],
    useParams: () => ({ networkId: "net_1", serverId: "sk_1" }),
    useNavigate: () => navigateSpy,
    Navigate: () => null,
    Link: ({ children, to, params, ...p }: any) => (
      <a href={to} {...p}>
        {children}
      </a>
    ),
    createFileRoute: () => () => ({ component: () => null }),
  };
});

vi.mock("@/lib/api/networks", () => ({
  getNetwork: vi.fn().mockResolvedValue({
    network: { id: "net_1", name: "Mon Réseau", tier: "free" },
    serverKeys: [{ id: "sk_1", label: "Survival" }],
    projects: [
      { id: "p1", name: "Hub", hash: "h1", networkId: "net_1", serverKeyId: "sk_1", documentCount: 5 },
      { id: "p2", name: "Lobby", hash: "h2", networkId: "net_1", serverKeyId: "sk_2" },
    ],
  }),
}));

vi.mock("react-i18next", () => ({
  useTranslation: () => ({ t: (k: string) => k }),
}));

import ServerDetailPage from "./networks.$networkId.servers.$serverId";
import { getNetwork } from "@/lib/api/networks";

describe("ServerDetailPage", () => {
  beforeEach(() => {
    navigateSpy.mockClear();
    authState.currentUser = { id: "u1", name: "Iban" };
    authState.isLoading = false;
  });

  it("redirects anonymous visitors to /login with a next return path", async () => {
    authState.currentUser = null;
    authState.isLoading = false;
    setUrl("/networks/net_1/servers/sk_1", "?x=1");

    render(<ServerDetailPage />);

    await waitFor(() =>
      expect(navigateSpy).toHaveBeenCalledWith({
        to: "/login",
        search: { next: "/networks/net_1/servers/sk_1?x=1" },
        replace: true,
      }),
    );
  });

  it("does not redirect a logged-in user", async () => {
    setUrl("/networks/net_1/servers/sk_1");
    render(<ServerDetailPage />);
    await waitFor(() => expect(screen.getByText("Hub")).toBeInTheDocument());
    expect(navigateSpy).not.toHaveBeenCalled();
  });
  it("shows only workspaces bound to the active server", async () => {
    render(<ServerDetailPage />);
    await waitFor(() => expect(screen.getByText("Hub")).toBeInTheDocument());
    expect(screen.queryByText("Lobby")).not.toBeInTheDocument();
  });

  it("shows the element-count indicator for a workspace", async () => {
    render(<ServerDetailPage />);
    await waitFor(() => expect(screen.getByText("Hub")).toBeInTheDocument());
    expect(screen.getByText("5")).toBeInTheDocument();
  });

  it("workspace link points to the new URL pattern", async () => {
    render(<ServerDetailPage />);
    const link = await screen.findByRole("link", { name: /Hub/ });
    expect(link).toHaveAttribute(
      "href",
      "/networks/$networkId/servers/$serverId/projects/$projectId",
    );
  });

  it("403 for a logged-in user renders the request-access panel instead of bouncing", async () => {
    vi.mocked(getNetwork).mockRejectedValueOnce(
      Object.assign(new Error("forbidden"), { status: 403 }),
    );
    render(<ServerDetailPage />);
    await screen.findByText("requestAccess.title");
    expect(navigateSpy).not.toHaveBeenCalled();
  });

  it("404 still bounces to /networks", async () => {
    vi.mocked(getNetwork).mockRejectedValueOnce(
      Object.assign(new Error("not found"), { status: 404 }),
    );
    render(<ServerDetailPage />);
    await waitFor(() =>
      expect(navigateSpy).toHaveBeenCalledWith({ to: "/networks", replace: true }),
    );
  });
});
