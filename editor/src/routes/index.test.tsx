import { render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { HomeRoute } from "./index";

vi.mock("@tanstack/react-router", async () => {
  const actual =
    await vi.importActual<typeof import("@tanstack/react-router")>("@tanstack/react-router");
  return {
    ...actual,
    Navigate: ({ params }: { params: { networkId: string; serverId: string } }) => (
      <div data-testid="navigate">{`${params.networkId}/${params.serverId}`}</div>
    ),
  };
});

describe("HomeRoute", () => {
  it("opens the server the plugin serves", () => {
    render(<HomeRoute />);
    expect(screen.getByTestId("navigate")).toHaveTextContent("local/local");
  });
});
