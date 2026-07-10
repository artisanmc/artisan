import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";

const navigateSpy = vi.hoisted(() => vi.fn());

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
import { useSessionStore } from "@/state/sessionStore";

describe("ServerDetailPage", () => {
  beforeEach(() => {
    navigateSpy.mockClear();
    useSessionStore.getState().clearSession();
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

  it("403 without a plugin session bounces to /networks", async () => {
    vi.mocked(getNetwork).mockRejectedValueOnce(
      Object.assign(new Error("forbidden"), { status: 403 }),
    );
    render(<ServerDetailPage />);
    await waitFor(() =>
      expect(navigateSpy).toHaveBeenCalledWith({ to: "/networks", replace: true }),
    );
  });

  it("403 with an active plugin session does NOT bounce (dual-auth: the session authorizes the leaf)", async () => {
    // Utilisateur connecté à un compte + session /artisan editor sur un network
    // que ce compte ne possède pas : getNetwork (cookie-auth) 403 alors que la
    // route project (token de session) est légitime — pas d'éjection.
    useSessionStore.getState().setSession("tok", "sk_1", "net_1", "TRUST", true);
    const consoleSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    vi.mocked(getNetwork).mockRejectedValueOnce(
      Object.assign(new Error("forbidden"), { status: 403 }),
    );
    render(<ServerDetailPage />);
    await waitFor(() => expect(consoleSpy).toHaveBeenCalled());
    expect(navigateSpy).not.toHaveBeenCalled();
    consoleSpy.mockRestore();
  });
});
