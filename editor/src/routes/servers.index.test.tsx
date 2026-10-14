import { render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { ServersPage } from "./servers.index";

vi.mock("@tanstack/react-router", async () => {
  const actual =
    await vi.importActual<typeof import("@tanstack/react-router")>("@tanstack/react-router");
  return {
    ...actual,
    Navigate: ({ params }: { params: { serverId: string } }) => (
      <div data-testid="navigate">{params.serverId}</div>
    ),
  };
});

vi.mock("@/lib/api/networks", () => ({
  getNetwork: vi.fn().mockResolvedValue({
    network: { id: "local", name: "Hub", tier: "free" },
    projects: [],
    serverKeys: [{ id: "824473e8-413e-4109-ae91-185021a150e9", label: "Hub" }],
  }),
}));

describe("ServersPage", () => {
  it("opens the hub's own server", async () => {
    render(<ServersPage />);
    expect(await screen.findByTestId("navigate")).toHaveTextContent(
      "824473e8-413e-4109-ae91-185021a150e9",
    );
  });
});
