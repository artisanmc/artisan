import { describe, it, expect, vi } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";

vi.mock("@tanstack/react-router", async () => {
  const actual = await vi.importActual<typeof import("@tanstack/react-router")>("@tanstack/react-router");
  return {
    ...actual,
    useChildMatches: () => [],
    useParams: () => ({ networkId: "net_1", serverId: "sk_1" }),
    useNavigate: () => vi.fn(),
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
      { id: "p1", name: "Hub", hash: "h1", networkId: "net_1", serverKeyId: "sk_1", elementCount: 5 },
      { id: "p2", name: "Lobby", hash: "h2", networkId: "net_1", serverKeyId: "sk_2" },
    ],
  }),
}));

vi.mock("react-i18next", () => ({
  useTranslation: () => ({ t: (k: string) => k }),
}));

import ServerDetailPage from "./networks.$networkId.servers.$serverId";

describe("ServerDetailPage", () => {
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
});
