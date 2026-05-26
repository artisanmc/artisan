import { describe, expect, it, beforeEach, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { NetworkDropdown } from "./NetworkDropdown";
import { useNetworksStore } from "@/state/networksStore";
import { useSessionStore } from "@/state/sessionStore";

vi.mock("@tanstack/react-router", async () => {
  const actual = await vi.importActual<typeof import("@tanstack/react-router")>("@tanstack/react-router");
  return {
    ...actual,
    useNavigate: () => vi.fn(),
    Link: ({ children, ...props }: any) => <a {...props}>{children}</a>,
  };
});

describe("NetworkDropdown", () => {
  beforeEach(() => {
    useNetworksStore.setState({
      networks: [
        { id: "net_1", name: "Mon Network", tier: "free" },
        { id: "net_2", name: "Test Network", tier: "free" },
      ],
    } as any);
    useSessionStore.setState({ networkId: "net_1" } as any);
  });

  it("renders the active network's name", () => {
    render(<NetworkDropdown />);
    expect(screen.getByText("Mon Network")).toBeInTheDocument();
  });

  it("hides the caret if user has only 1 network", () => {
    useNetworksStore.setState({
      networks: [{ id: "net_1", name: "Solo", tier: "free" }],
    } as any);
    render(<NetworkDropdown />);
    expect(screen.queryByTestId("network-dropdown-caret")).toBeNull();
  });

  it("shows other networks when clicked", () => {
    render(<NetworkDropdown />);
    fireEvent.click(screen.getByText("Mon Network"));
    expect(screen.getByText("Test Network")).toBeInTheDocument();
  });

  it("returns null if there's no active network in session", () => {
    useSessionStore.setState({ networkId: null } as any);
    render(<NetworkDropdown />);
    expect(screen.queryByText("Mon Network")).toBeNull();
  });
});
