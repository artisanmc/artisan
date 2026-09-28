import * as billing from "@/lib/api/adminBilling";
import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { BillingPlansTab } from "./BillingPlansTab";

vi.mock("@/lib/api/adminBilling", () => ({
  listPlans: vi.fn(),
  deactivatePlan: vi.fn(),
  updatePlan: vi.fn(),
  publishPlan: vi.fn(),
  provisionPlans: vi.fn(),
}));
vi.mock("sonner", () => ({ toast: { success: vi.fn(), error: vi.fn(), info: vi.fn() } }));
const standard = {
  id: "standard",
  name: "Standard",
  managedBy: "code",
  version: 1,
  interval: "month",
  priceCents: 900,
  currency: "eur",
  creditsPerPeriod: 500,
  creditInterval: "month",
  sortOrder: 0,
  isActive: true,
  publicationStatus: "published",
  stripeProvisioningStatus: "unavailable",
};
beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(billing.listPlans).mockResolvedValue([
    standard,
    {
      ...standard,
      id: "custom",
      name: "Custom",
      managedBy: "admin",
      publicationStatus: "draft",
      targetNetworkId: "network1",
    },
  ] as never);
});
describe("managed plan list", () => {
  it("preserves annual credit allocation for custom offers", async () => {
    vi.mocked(billing.listPlans).mockResolvedValue([
      { ...standard, creditInterval: "year", interval: "month" },
    ] as never);
    render(<BillingPlansTab />);
    expect(await screen.findByText("500 crédits/an")).toBeVisible();
    expect(screen.getByText("Facturé mensuellement")).toBeVisible();
  });
  it("distinguishes monthly credit allocation from annual billing and the default Free offer", async () => {
    vi.mocked(billing.listPlans).mockResolvedValue([
      { ...standard, interval: "year", creditInterval: "month" },
      {
        ...standard,
        id: "free",
        key: "free",
        name: "Free",
        priceCents: 0,
        creditsPerPeriod: 0,
        creditInterval: "none",
      },
    ] as never);
    render(<BillingPlansTab />);
    const paid = (await screen.findByText("Standard")).closest("tr")!;
    expect(within(paid).getByText("500 crédits/mois")).toBeVisible();
    expect(within(paid).getByText("Facturé annuellement")).toBeVisible();
    const free = screen.getByText("Free").closest("tr")!;
    expect(within(free).getByText("Plan par défaut des Networks")).toBeVisible();
    expect(within(free).getByText("Aucune attribution récurrente")).toBeVisible();
    expect(within(free).getByText("Sans facturation")).toBeVisible();
  });
  it("protects standards while letting admins publish an offline custom draft", async () => {
    vi.mocked(billing.publishPlan).mockResolvedValue({ ok: true, data: {} } as never);
    render(<BillingPlansTab />);
    const row = (await screen.findByText("Standard")).closest("tr")!;
    expect(within(row).queryByRole("button")).not.toBeInTheDocument();
    expect(within(row).getByText(/géré dans le code/i)).toBeVisible();
    await userEvent.click(screen.getByRole("button", { name: "Publier" }));
    await waitFor(() => expect(billing.publishPlan).toHaveBeenCalledWith("custom"));
  });
  it("allows payment provisioning to be retried separately", async () => {
    vi.mocked(billing.provisionPlans).mockResolvedValue({
      ok: true,
      data: { results: [{ planId: "standard", status: "unavailable" }] },
    });
    render(<BillingPlansTab />);
    await userEvent.click(screen.getByRole("button", { name: /préparer les offres de paiement/i }));
    expect(billing.provisionPlans).toHaveBeenCalledOnce();
  });
});
