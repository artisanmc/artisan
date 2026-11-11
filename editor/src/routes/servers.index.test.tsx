import { ApiError } from "@/lib/api/client";
import { listServers } from "@/lib/api/servers";
import { render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { ServersPage } from "./servers.index";

vi.mock("@tanstack/react-router", async () => {
  const actual =
    await vi.importActual<typeof import("@tanstack/react-router")>("@tanstack/react-router");
  return {
    ...actual,
    Navigate: ({ to, params }: { to: string; params?: { serverId: string } }) => (
      <div data-testid="navigate">{params?.serverId ?? to}</div>
    ),
  };
});

vi.mock("@/lib/api/servers", () => ({
  listServers: vi.fn().mockResolvedValue([
    {
      id: "824473e8-413e-4109-ae91-185021a150e9",
      label: "Hub",
      online: true,
      minecraftVersion: null,
      lastSeenAt: null,
    },
  ]),
}));

describe("ServersPage", () => {
  it("opens the hub's own server", async () => {
    render(<ServersPage />);
    expect(await screen.findByTestId("navigate")).toHaveTextContent(
      "824473e8-413e-4109-ae91-185021a150e9",
    );
  });

  it("sends an anonymous visitor to the login page", async () => {
    vi.mocked(listServers).mockRejectedValueOnce(new ApiError("unauthorized", 401));
    render(<ServersPage />);
    expect(await screen.findByTestId("navigate")).toHaveTextContent("/login");
  });
});
