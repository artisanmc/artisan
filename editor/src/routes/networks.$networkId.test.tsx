import { render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { NetworkDetailPage } from "./networks.$networkId";

vi.mock("@tanstack/react-router", async () => {
  const actual =
    await vi.importActual<typeof import("@tanstack/react-router")>("@tanstack/react-router");
  return {
    ...actual,
    useChildMatches: () => [],
    Navigate: ({ to }: { to: string }) => <div data-testid="navigate">{to}</div>,
  };
});

describe("NetworkDetailPage", () => {
  it("sends back to the landing server", () => {
    render(<NetworkDetailPage />);
    expect(screen.getByTestId("navigate")).toHaveTextContent("/");
  });
});
