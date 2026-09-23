import * as billing from "@/lib/api/billing";
import { listMembers } from "@/lib/api/members";
import { createNetwork, listNetworks } from "@/lib/api/networks";
import { useAuthStore } from "@/state/authStore";
import { useNetworksStore } from "@/state/networksStore";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { PricingPage } from "./PricingPage";

vi.mock("@/lib/api/billing", () => ({
  getPlans: vi.fn(),
  getProjects: vi.fn(async () => []),
  getSubscription: vi.fn(async () => ({ status: null })),
  startSubscriptionCheckout: vi.fn(async () => null),
  openPortal: vi.fn(async () => null),
}));
vi.mock("@/lib/api/networks", () => ({ listNetworks: vi.fn(), createNetwork: vi.fn() }));
vi.mock("@/lib/api/members", () => ({ listMembers: vi.fn() }));
const plan = {
  id: "annual",
  name: "Studio",
  interval: "year",
  priceCents: 9900,
  currency: "eur",
  creditsPerPeriod: 12000,
  rolloverCap: 2000,
  features: "First benefit\nSecond benefit",
  description: "For your next creation",
  highlighted: true,
  sortOrder: 0,
};

beforeEach(() => {
  vi.clearAllMocks();
  window.history.replaceState({}, "", "/pricing");
  useAuthStore.setState({ currentUser: null, isLoading: false });
  useNetworksStore.setState({ activeId: null });
  vi.mocked(billing.getPlans).mockResolvedValue([plan]);
  vi.mocked(billing.getSubscription).mockResolvedValue({ status: null });
  vi.mocked(listNetworks).mockResolvedValue([{ id: "n1", name: "My server", tier: "free" }]);
  vi.mocked(listMembers).mockResolvedValue([{ userId: "u1", role: "owner" } as never]);
});

describe("pricing catalog", () => {
  it("renders live annual pricing and each configured benefit", async () => {
    render(<PricingPage />);
    expect(await screen.findByRole("heading", { name: "Studio" })).toBeVisible();
    expect(screen.getByText(/99,00/)).toBeVisible();
    expect(screen.getByText(/\/an/)).toBeVisible();
    expect(screen.getByText("Second benefit")).toBeVisible();
    expect(screen.queryByText(/\/mois/)).not.toBeInTheDocument();
  });
  it("preserves selected plan in the signup return URL", async () => {
    render(<PricingPage />);
    const choose = await screen.findByRole("link", { name: /choisir studio/i });
    const url = new URL(choose.getAttribute("href")!, "http://localhost");
    expect(url.pathname).toBe("/signup");
    expect(url.searchParams.get("next")).toBe("/pricing?plan=annual");
  });
  it("offers retry for a failed catalog and does not invent offers", async () => {
    vi.mocked(billing.getPlans).mockRejectedValueOnce(new Error("offline"));
    render(<PricingPage />);
    expect(await screen.findByRole("alert")).toHaveTextContent(/charger/i);
    await userEvent.click(screen.getByRole("button", { name: /réessayer/i }));
    expect(await screen.findByRole("heading", { name: "Studio" })).toBeVisible();
  });
  it("shows an honest empty state", async () => {
    vi.mocked(billing.getPlans).mockResolvedValue([]);
    render(<PricingPage />);
    expect(await screen.findByText(/aucun abonnement/i)).toBeVisible();
  });
  it("requires an explicit action after signing in with a selected plan", async () => {
    window.history.replaceState({}, "", "/pricing?plan=annual");
    useAuthStore.setState({ currentUser: { id: "u1", email: "a@b.c" } } as never);
    render(<PricingPage />);
    const checkout = await screen.findByRole("button", { name: /continuer vers le paiement/i });
    expect(billing.startSubscriptionCheckout).not.toHaveBeenCalled();
    await userEvent.click(checkout);
    await waitFor(() =>
      expect(billing.startSubscriptionCheckout).toHaveBeenCalledWith("n1", "annual"),
    );
  });
  it("blocks checkout for ordinary members", async () => {
    window.history.replaceState({}, "", "/pricing?plan=annual");
    useAuthStore.setState({ currentUser: { id: "u1", email: "a@b.c" } } as never);
    vi.mocked(listMembers).mockResolvedValue([{ userId: "u1", role: "member" } as never]);
    render(<PricingPage />);
    expect(await screen.findByText(/propriétaire.*facturation/i)).toBeVisible();
    expect(
      screen.queryByRole("button", { name: /continuer vers le paiement/i }),
    ).not.toBeInTheDocument();
  });
  it("uses the portal for an existing subscription", async () => {
    window.history.replaceState({}, "", "/pricing?plan=annual");
    useAuthStore.setState({ currentUser: { id: "u1", email: "a@b.c" } } as never);
    vi.mocked(billing.getSubscription).mockResolvedValue({ status: "past_due", planId: "another" });
    render(<PricingPage />);
    await userEvent.click(await screen.findByRole("button", { name: /gérer mon abonnement/i }));
    expect(billing.openPortal).toHaveBeenCalledWith("n1");
    expect(billing.startSubscriptionCheckout).not.toHaveBeenCalled();
  });

  it("creates a first network while preserving the plan and waits for checkout confirmation", async () => {
    window.history.replaceState({}, "", "/pricing?plan=annual");
    useAuthStore.setState({ currentUser: { id: "u1", email: "a@b.c" } } as never);
    vi.mocked(listNetworks).mockResolvedValue([]);
    vi.mocked(createNetwork).mockResolvedValue({ id: "created", name: "Adventure", tier: "free" });
    render(<PricingPage />);
    await userEvent.type(
      await screen.findByRole("textbox", { name: /nom du réseau/i }),
      "Adventure",
    );
    await userEvent.click(screen.getByRole("button", { name: /créer mon réseau/i }));
    expect(
      await screen.findByRole("button", { name: /continuer vers le paiement/i }),
    ).toBeEnabled();
    expect(createNetwork).toHaveBeenCalledWith("Adventure");
    expect(billing.startSubscriptionCheckout).not.toHaveBeenCalled();
  });

  it("fails closed if the subscription cannot be verified", async () => {
    window.history.replaceState({}, "", "/pricing?plan=annual");
    useAuthStore.setState({ currentUser: { id: "u1", email: "a@b.c" } } as never);
    vi.mocked(billing.getSubscription).mockResolvedValue(null);
    render(<PricingPage />);
    expect(await screen.findByRole("alert")).toHaveTextContent(/temporairement indisponibles/i);
    expect(
      screen.queryByRole("button", { name: /continuer vers le paiement/i }),
    ).not.toBeInTheDocument();
  });

  it("keeps the explicitly selected network when retrying its billing lookup", async () => {
    window.history.replaceState({}, "", "/pricing?plan=annual");
    useAuthStore.setState({ currentUser: { id: "u1", email: "a@b.c" } } as never);
    useNetworksStore.setState({ activeId: "n1" });
    vi.mocked(listNetworks).mockResolvedValue([
      { id: "n1", name: "Network A", tier: "free" },
      { id: "n2", name: "Network B", tier: "free" },
    ]);
    render(<PricingPage />);
    await screen.findByRole("button", { name: /continuer vers le paiement/i });
    vi.mocked(billing.getSubscription).mockRejectedValueOnce(new Error("offline"));
    await userEvent.selectOptions(screen.getByRole("combobox", { name: /votre réseau/i }), "n2");
    expect(await screen.findByRole("alert")).toHaveTextContent(/temporairement indisponibles/i);
    await userEvent.click(screen.getByRole("button", { name: /réessayer/i }));
    const checkout = await screen.findByRole("button", { name: /continuer vers le paiement/i });
    expect(screen.getByRole("combobox", { name: /votre réseau/i })).toHaveValue("n2");
    await userEvent.click(checkout);
    await waitFor(() =>
      expect(billing.startSubscriptionCheckout).toHaveBeenCalledWith("n2", "annual"),
    );
  });
});
