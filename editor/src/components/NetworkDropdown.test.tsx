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

  it("shows other networks when clicked (user-auth mode, no live session)", () => {
    // The dropdown is locked when an /artisan session pins a network — opening
    // it would suggest the user can switch, but switching wouldn't change the
    // session's server_key binding. We test the user-auth scenario.
    useSessionStore.setState({ networkId: null } as any);
    render(<NetworkDropdown />);
    fireEvent.click(screen.getByText("Mon Network"));
    expect(screen.getByText("Test Network")).toBeInTheDocument();
  });

  it("falls back to the first owned network when there's no active session", () => {
    // User-auth mode: no /artisan session yet, but the user has networks via
    // the web flow. The dropdown should still surface the first one so the
    // sidebar shows the "Network" badge.
    useSessionStore.setState({ networkId: null } as any);
    render(<NetworkDropdown />);
    expect(screen.getByText("Mon Network")).toBeInTheDocument();
  });

  it("returns null when the user has no networks at all", () => {
    useNetworksStore.setState({ networks: [] } as any);
    useSessionStore.setState({ networkId: null } as any);
    render(<NetworkDropdown />);
    expect(screen.queryByText("Mon Network")).toBeNull();
  });
});
