import { render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { HomeRoute } from "./index";

vi.mock("@tanstack/react-router", async () => {
  const actual =
    await vi.importActual<typeof import("@tanstack/react-router")>("@tanstack/react-router");
  return {
    ...actual,
    Navigate: ({ to }: { to: string }) => <div data-testid="navigate">{to}</div>,
  };
});

describe("HomeRoute", () => {
  it("opens the server list", () => {
    render(<HomeRoute />);
    expect(screen.getByTestId("navigate")).toHaveTextContent("/servers");
  });
});
