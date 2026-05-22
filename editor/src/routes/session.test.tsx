import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen } from "@testing-library/react";
import { useSessionStore } from "@/state/sessionStore";

vi.mock("@tanstack/react-router", () => ({
  Outlet: () => <div data-testid="outlet" />,
  createRootRoute: () => ({ component: null }),
}));

vi.mock("@/state/accountStore", () => ({
  useAccountStore: {
    subscribe: vi.fn(() => vi.fn()),
    getState: () => ({ account: { packs: [] } }),
  },
}));

vi.mock("@/state/authStore", () => ({
  useAuthStore: {
    getState: () => ({ hydrate: vi.fn() }),
  },
}));

vi.mock("@/lib/packApi");
vi.mock("@/lib/i18nKeys");
vi.mock("@/features/export/transform");

import { RootLayout } from "./__root";

describe("Session network banner in RootLayout", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
    useSessionStore.getState().clearSession();
  });

  it("renders network banner when networkId is in session store", () => {
    useSessionStore.getState().setSession("token", "sk_123", "net_abc123", "code", true);
    const { container } = render(<RootLayout />);

    expect(screen.getByText("Network:")).toBeTruthy();
    expect(screen.getByText("net_abc123")).toBeTruthy();
  });

  it("does not render network banner when networkId is null", () => {
    useSessionStore.getState().setSession("token", "sk_123", null, "code", true);
    render(<RootLayout />);

    expect(screen.queryByText(/Network:/)).not.toBeInTheDocument();
  });
});
