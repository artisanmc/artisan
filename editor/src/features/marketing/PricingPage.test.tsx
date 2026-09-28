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
  getEditorOffer: vi.fn(async () => ({
    quota: 10,
    proQuota: 250,
    freeServers: 2,
    proServers: 10,
    freeCollaborators: 2,
  })),
  getProjects: vi.fn(async () => []),
  getSubscription: vi.fn(async () => ({ status: null })),
  startSubscriptionCheckout: vi.fn(async () => null),
  openPortal: vi.fn(async () => null),
}));
vi.mock("@/lib/api/networks", () => ({ listNetworks: vi.fn(), createNetwork: vi.fn() }));
vi.mock("@/lib/api/members", () => ({ listMembers: vi.fn() }));
const plan = {
  id: "annual",
  key: "pro",
  version: 1,
  managedBy: "code" as const,
  audience: "public" as const,
  targetNetworkId: null,
  publicationStatus: "published" as const,
  creditInterval: "month" as const,
  limits: { resourcesPerServer: 250, servers: 10, collaborators: null },
  capabilities: { editorPro: true },
  name: "Studio",
  interval: "year",
  priceCents: 7000,
  currency: "eur",
  creditsPerPeriod: 500,
  rolloverCap: 2000,
  features: "First benefit\nSecond benefit",
  description: "For your next creation",
  highlighted: true,
  sortOrder: 0,
  editorPro: true,
  purchasable: true,
};

const free = {
  ...plan,
  id: "free",
  key: "free",
  priceCents: 0,
  limits: { resourcesPerServer: 10, servers: 2, collaborators: 2 },
  purchasable: false,
};
const monthly = { ...plan, id: "monthly", interval: "month", priceCents: 900 };
beforeEach(() => {
  vi.clearAllMocks();
  window.history.replaceState({}, "", "/pricing");
  useAuthStore.setState({ currentUser: null, isLoading: false });
  useNetworksStore.setState({ activeId: null });
  vi.mocked(billing.getPlans).mockResolvedValue([free, monthly, plan]);
  vi.mocked(billing.getSubscription).mockResolvedValue({ status: null });
  vi.mocked(listNetworks).mockResolvedValue([{ id: "n1", name: "My server", tier: "free" }]);
  vi.mocked(listMembers).mockResolvedValue([{ userId: "u1", role: "owner" } as never]);
});

describe("pricing catalog", () => {
  it("renders Free and Pro with the published quota and live annual price", async () => {
    render(<PricingPage />);
    expect(await screen.findByRole("heading", { level: 1, name: "Tarifs" })).toBeVisible();
    expect(screen.queryByText(/créez à votre rythme/i)).not.toBeInTheDocument();
    expect(screen.queryByText(/commencez gratuitement.*voyez plus grand/i)).not.toBeInTheDocument();
    expect(await screen.findByRole("heading", { name: "Gratuit" })).toBeVisible();
    expect(screen.getByRole("heading", { name: "Artisan Pro" })).toBeVisible();
    expect(
      screen.getByRole("heading", {
        name: /contenus créés restent accessibles en jeu même sans abonnement/i,
      }),
    ).toBeVisible();
    expect(screen.getByText(/10 ressources par serveur/i)).toBeVisible();
    expect(screen.getByText(/250 ressources par serveur/i)).toBeVisible();
    expect(screen.getByText(/2 serveurs/i)).toBeVisible();
    expect(screen.getByText(/10 serveurs/i)).toBeVisible();
    expect(screen.getByText(/2 collaborateurs/i)).toBeVisible();
    expect(screen.getByText(/collaborateurs illimités/i)).toBeVisible();
    expect(screen.getByText(/500 crédits IA par mois/i)).toBeVisible();
    expect(screen.getAllByRole("button", { name: /ressources des modules/i })).toHaveLength(2);
    expect(
      screen.getByRole("heading", { name: "Artisan Pro" }).closest(".pricing-plan"),
    ).not.toHaveTextContent(/édition.*abonnement/i);
    expect(screen.getAllByText(/70\s*€/)[0]).toBeVisible();
    expect(screen.getByText(/^0\s*€$/)).toBeVisible();
    expect(screen.queryByText(/70,00|0,00/)).not.toBeInTheDocument();
    expect(screen.getAllByText(/\/an/)[0]).toBeVisible();
    expect(screen.queryByText(/\/mois/)).not.toBeInTheDocument();
  });
  it("uses catalog limits and prices instead of business fallbacks", async () => {
    vi.mocked(billing.getPlans).mockResolvedValueOnce([
      free,
      monthly,
      {
        ...plan,
        priceCents: 8100,
        limits: { resourcesPerServer: 321, servers: 14, collaborators: null },
      },
    ]);
    render(<PricingPage />);
    expect(await screen.findByText(/321 ressources par serveur/i)).toBeVisible();
    expect(screen.getByText(/14 serveurs/i)).toBeVisible();
    expect(screen.getAllByText(/81\s*€/)[0]).toBeVisible();
    expect(billing.getEditorOffer).not.toHaveBeenCalled();
  });
  it("preserves selected plan in the signup return URL", async () => {
    render(<PricingPage />);
    const choose = await screen.findByRole("link", { name: /passer à pro/i });
    const url = new URL(choose.getAttribute("href")!, "http://localhost");
    expect(url.pathname).toBe("/signup");
    expect(url.searchParams.get("next")).toBe("/pricing?plan=annual");
  });
  it("offers retry for a failed catalog and does not invent offers", async () => {
    vi.mocked(billing.getPlans).mockRejectedValueOnce(new Error("offline"));
    render(<PricingPage />);
    expect(await screen.findByRole("alert")).toHaveTextContent(/charger/i);
    await userEvent.click(screen.getByRole("button", { name: /réessayer/i }));
    expect(await screen.findByRole("heading", { name: "Artisan Pro" })).toBeVisible();
  });
  it("shows the published Pro prices without offering unavailable checkout", async () => {
    vi.mocked(billing.getPlans).mockResolvedValue([
      free,
      { ...monthly, purchasable: false },
      { ...plan, purchasable: false },
    ]);
    render(<PricingPage />);
    expect(await screen.findByText(/70\s*€/)).toBeVisible();
    expect(screen.getByRole("button", { name: /annuel.*économisez 38/i })).toBeVisible();
    expect(screen.getByText(/par network/i)).toBeVisible();
    await userEvent.click(screen.getByRole("button", { name: "Mensuel" }));
    expect(screen.getByText(/9\s*€/)).toBeVisible();
    expect(screen.getByRole("button", { name: /annuel.*économisez 38/i })).toBeVisible();
    expect(screen.queryByText(/tarif à venir/i)).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /passer à pro/i })).not.toBeInTheDocument();
    expect(screen.queryByText(/paiement sécurisé/i)).not.toBeInTheDocument();
  });
  it("shows the exact annual savings when both purchasable prices match the offer", async () => {
    vi.mocked(billing.getPlans).mockResolvedValue([
      free,
      { ...plan, id: "monthly", interval: "month", priceCents: 900 },
      { ...plan, priceCents: 7000 },
    ]);
    render(<PricingPage />);
    expect(await screen.findByText(/70\s*€/)).toBeVisible();
    expect(screen.getByRole("button", { name: /annuel.*économisez 38/i })).toBeVisible();
  });
  it("does not offer checkout for a plan without a Stripe price", async () => {
    vi.mocked(billing.getPlans).mockResolvedValue([free, monthly, { ...plan, purchasable: false }]);
    render(<PricingPage />);
    expect(await screen.findByText(/70\s*€/)).toBeVisible();
    expect(screen.queryByRole("link", { name: /passer à pro/i })).not.toBeInTheDocument();
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
