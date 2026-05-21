import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import { AccountPage } from "./account";
import * as networksApi from "@/lib/api/networks";

vi.mock("@/state/authStore", () => ({
  useAuthStore: (sel: (s: { currentUser: { id: string; name: string; email: string } | null }) => unknown) =>
    sel({ currentUser: { id: "u1", name: "Iban", email: "i@a.b" } }),
}));

vi.mock("react-i18next", () => ({
  useTranslation: () => ({
    t: (key: string) => key,
    i18n: { changeLanguage: () => Promise.resolve() },
  }),
}));

vi.mock("@tanstack/react-router", async () => {
  const actual = await vi.importActual<typeof import("@tanstack/react-router")>("@tanstack/react-router");
  return {
    ...actual,
    Link: ({ children, ...props }: any) => <a {...props}>{children}</a>,
  };
});

describe("AccountPage", () => {
  beforeEach(() => vi.restoreAllMocks());

  it("displays user info + user's networks", async () => {
    vi.spyOn(networksApi, "listNetworks").mockResolvedValue([
      { id: "n1", name: "Survival", tier: "free" },
    ]);
    render(<AccountPage />);
    expect(screen.getByText(/Iban/)).toBeTruthy();
    await waitFor(() => expect(screen.getByText("Survival")).toBeTruthy());
  });

  it("shows setup CTA when no networks", async () => {
    vi.spyOn(networksApi, "listNetworks").mockResolvedValue([]);
    render(<AccountPage />);
    await waitFor(() => expect(screen.getByText(/set up your first server/i)).toBeTruthy());
  });
});
