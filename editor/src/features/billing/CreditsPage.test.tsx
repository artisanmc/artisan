import { useAuthStore } from "@/state/authStore";
import { useNetworksStore } from "@/state/networksStore";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";
import { CreditsPage } from "./CreditsPage";

const h = vi.hoisted(() => ({ search: {} as Record<string, string> }));
vi.mock("@tanstack/react-router", async (orig) => ({
  ...(await orig<typeof import("@tanstack/react-router")>()),
  useSearch: () => h.search,
  useNavigate: () => vi.fn(),
  Link: ({ children }: { children: React.ReactNode }) => <a>{children}</a>,
}));
vi.mock("@/lib/api/billing", () => ({
  getBillingBalance: vi.fn(async () => ({
    total: 500,
    subscription: 300,
    rollover: 0,
    topup: 200,
    subscriptionQuota: 1000,
    periodEnd: "2999-01-01T00:00:00Z",
  })),
  getProjects: vi.fn(async () => [
    {
      id: "pk1",
      name: "Starter",
      priceCents: 1000,
      currency: "eur",
      credits: 500,
      bonusPct: 20,
      creditsGranted: 600,
    },
  ]),
  getPlans: vi.fn(async () => [
    {
      id: "pl1",
      name: "Pro",
      interval: "month",
      priceCents: 2000,
      currency: "eur",
      creditsPerPeriod: 5000,
      rolloverCap: 1000,
      features: "",
    },
  ]),
  getSubscription: vi.fn(async () => ({
    status: "active",
    planId: "pl1",
    planName: "Pro",
    currentPeriodEnd: "2999-02-01T00:00:00Z",
    graceUntil: null,
  })),
  getPurchases: vi.fn(async () => [
    {
      id: "pur1",
      amountCents: 1000,
      currency: "eur",
      credits: 600,
      stripeInvoiceUrl: null,
      createdAt: "2026-07-01T00:00:00Z",
    },
  ]),
  startPackCheckout: vi.fn(async () => "https://stripe/checkout"),
  startSubscriptionCheckout: vi.fn(async () => null),
  openPortal: vi.fn(async () => "https://stripe/portal"),
}));
vi.mock("@/lib/api/members", () => ({
  listMembers: vi.fn(async () => [{ userId: "u1", role: "owner" }]),
}));

afterEach(() => {
  vi.clearAllMocks();
  h.search = {};
  useAuthStore.setState({ currentUser: null } as never);
  useNetworksStore.setState({ activeId: null } as never);
});

function signedIn() {
  useAuthStore.setState({ currentUser: { id: "u1", email: "a@b.c" } } as never);
  useNetworksStore.setState({
    activeId: "net1",
    networks: [{ id: "net1", name: "N", tier: "free" }],
  } as never);
}

describe("CreditsPage", () => {
  it("prompts sign-in when signed out", () => {
    render(<CreditsPage />);
    expect(screen.getByText(/Connecte-toi/)).toBeTruthy();
  });

  it("prompts network pick when no active network", () => {
    useAuthStore.setState({ currentUser: { id: "u1", email: "a@b.c" } } as never);
    render(<CreditsPage />);
    expect(screen.getByText(/Choisis un réseau/)).toBeTruthy();
  });

  it("renders projects and starts checkout on Buy (redirects to Stripe url)", async () => {
    signedIn();
    const assign = vi.fn();
    Object.defineProperty(window, "location", { value: { assign, href: "" }, writable: true });
    const billing = await import("@/lib/api/billing");
    render(<CreditsPage />);
    await waitFor(() => expect(screen.getByText("Starter")).toBeTruthy());
    await userEvent.click(screen.getByRole("button", { name: /Acheter/ }));
    await waitFor(() => expect(billing.startPackCheckout).toHaveBeenCalledWith("net1", "pk1"));
    await waitFor(() => expect(assign).toHaveBeenCalledWith("https://stripe/checkout"));
  });

  it("balance badge offers no buy-credits action (already on the page)", async () => {
    signedIn();
    render(<CreditsPage />);
    await waitFor(() => expect(document.querySelector("[data-tone]")).toBeTruthy());
    await userEvent.click(document.querySelector("[data-tone]") as HTMLElement);
    expect(screen.queryByText(/Ajouter des crédits/)).toBeNull();
  });

  it("shows the active subscription + manage button", async () => {
    signedIn();
    render(<CreditsPage />);
    await waitFor(() => expect(screen.getByText(/Mon abonnement/)).toBeTruthy());
    expect(screen.getByRole("button", { name: /Gérer/ })).toBeTruthy();
  });

  it("shows purchase history", async () => {
    signedIn();
    render(<CreditsPage />);
    await waitFor(() => expect(screen.getByText(/Historique d'achats/)).toBeTruthy());
  });

  it("describes checkout return as pending rather than asserting payment", async () => {
    signedIn();
    h.search = { checkout: "success" };
    render(<CreditsPage />);
    await waitFor(() => expect(screen.getByText(/retour du paiement/)).toBeTruthy());
    expect(screen.queryByText(/Paiement reçu/)).toBeNull();
  });

  it("uses the network returned by Stripe instead of a stale sidebar selection", async () => {
    signedIn();
    h.search = { checkout: "success", networkId: "paid-network" };
    const billing = await import("@/lib/api/billing");
    render(<CreditsPage />);
    await waitFor(() => expect(billing.getSubscription).toHaveBeenCalledWith("paid-network"));
  });

  it("shows retry if the catalog cannot be loaded", async () => {
    signedIn();
    const billing = await import("@/lib/api/billing");
    vi.mocked(billing.getPlans).mockRejectedValueOnce(new Error("offline"));
    render(<CreditsPage />);
    expect(await screen.findByRole("alert")).toHaveTextContent(/charger/i);
    expect(screen.getByRole("button", { name: /réessayer/i })).toBeTruthy();
  });

  it("formats an annual subscription with its actual period", async () => {
    signedIn();
    const billing = await import("@/lib/api/billing");
    vi.mocked(billing.getPlans).mockResolvedValueOnce([
      {
        id: "year",
        name: "Yearly",
        interval: "year",
        priceCents: 12000,
        currency: "eur",
        creditsPerPeriod: 15000,
        rolloverCap: 0,
        features: "",
      },
    ]);
    render(<CreditsPage />);
    expect(await screen.findByText(/\/an/)).toBeTruthy();
  });

  it("labels annual Pro credits as a monthly grant", async () => {
    signedIn();
    const billing = await import("@/lib/api/billing");
    vi.mocked(billing.getPlans).mockResolvedValueOnce([{ id: "pro-year", name: "Artisan Pro", interval: "year", priceCents: 7000, currency: "eur", creditsPerPeriod: 500, rolloverCap: 0, features: "", editorPro: true }]);
    render(<CreditsPage />);
    expect(await screen.findByText(/500 crédits IA chaque mois/i)).toBeVisible();
  });

  it("translates a past_due subscription status + shows the grace window (never the raw enum)", async () => {
    signedIn();
    const billing = await import("@/lib/api/billing");
    vi.mocked(billing.getSubscription).mockResolvedValueOnce({
      status: "past_due",
      planId: "pl1",
      planName: "Pro",
      currentPeriodEnd: "2999-02-01T00:00:00Z",
      graceUntil: "2999-01-08T00:00:00Z",
    });
    render(<CreditsPage />);
    await waitFor(() => expect(screen.getByText(/Paiement en retard/)).toBeTruthy());
    expect(screen.queryByText("past_due")).toBeNull();
    expect(screen.getByText(/Période de grâce/)).toBeTruthy();
  });
});
