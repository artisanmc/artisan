import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import { NetworksPage } from "./networks";
import { useNetworksStore } from "@/state/networksStore";
import * as networksApi from "@/lib/api/networks";

vi.mock("@/state/authStore", () => ({
  useAuthStore: (sel: (s: { currentUser: { id: string; name: string } | null }) => unknown) =>
    sel({ currentUser: { id: "u1", name: "Iban" } }),
}));

vi.mock("@tanstack/react-router", async () => {
  const actual = await vi.importActual<typeof import("@tanstack/react-router")>("@tanstack/react-router");
  return {
    ...actual,
    useChildMatches: () => [],
    Link: ({ children, ...props }: any) => <a {...props}>{children}</a>,
  };
});

describe("NetworksPage", () => {
  beforeEach(() => {
    useNetworksStore.getState().reset();
    vi.restoreAllMocks();
  });

  it("fetches and displays the user's networks", async () => {
    vi.spyOn(networksApi, "listNetworks").mockResolvedValue([
      { id: "n1", name: "Survival Network", tier: "free" },
      { id: "n2", name: "Creative Network", tier: "free" },
    ]);
    render(<NetworksPage />);
    await waitFor(() => expect(screen.getByText("Survival Network")).toBeTruthy());
    expect(screen.getByText("Creative Network")).toBeTruthy();
  });

  it("shows empty state with 'Create your first network' CTA", async () => {
    vi.spyOn(networksApi, "listNetworks").mockResolvedValue([]);
    render(<NetworksPage />);
    await waitFor(() => expect(screen.getByText(/Aucun Network/i)).toBeTruthy());
  });
});
