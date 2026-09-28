import {
  assignNetworkPlan,
  getNetworkPlan,
  listBillingNetworks,
  listPlans,
} from "@/lib/api/adminBilling";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, expect, it, vi } from "vitest";
import { BillingAssignmentsTab } from "./BillingAssignmentsTab";

vi.mock("@/lib/api/adminBilling", () => ({
  assignNetworkPlan: vi.fn(),
  getNetworkPlan: vi.fn(),
  listBillingNetworks: vi.fn(),
  listPlans: vi.fn(),
}));
beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(listBillingNetworks).mockResolvedValue([{ id: "network", name: "Survival" }]);
  vi.mocked(listPlans).mockResolvedValue([
    {
      id: "pro",
      name: "Pro",
      key: "pro",
      isActive: true,
      publicationStatus: "published",
      audience: "public",
      interval: "month",
      version: 1,
      creditInterval: "month",
      creditsPerPeriod: 500,
    },
    { id: "draft", name: "Draft", isActive: true, publicationStatus: "draft" },
    {
      id: "private",
      name: "Private other",
      isActive: true,
      publicationStatus: "published",
      audience: "private",
      targetNetworkId: "other",
    },
  ] as Awaited<ReturnType<typeof listPlans>>);
  vi.mocked(getNetworkPlan).mockResolvedValue({
    effectivePlan: { planId: null, planName: "Free" },
    assignment: null,
  });
  vi.mocked(assignNetworkPlan).mockResolvedValue({ ok: true, data: { ok: true } });
});

it("assigns a published plan to the selected network without expiration", async () => {
  render(<BillingAssignmentsTab />);
  fireEvent.change(await screen.findByLabelText("Network"), { target: { value: "network" } });
  const plan = await screen.findByLabelText("Plan");
  expect(screen.queryByRole("option", { name: "Draft" })).not.toBeInTheDocument();
  expect(screen.queryByRole("option", { name: "Private other" })).not.toBeInTheDocument();
  fireEvent.change(plan, { target: { value: "pro" } });
  expect(screen.getByText(/500 crédits\/mois/)).toBeInTheDocument();
  fireEvent.click(screen.getByRole("button", { name: "Enregistrer l’attribution" }));
  await waitFor(() => expect(assignNetworkPlan).toHaveBeenCalledWith("network", "pro", null));
  expect(await screen.findByRole("status")).toHaveTextContent("Attribution enregistrée");
});

it("can remove an attribution and handles a save failure", async () => {
  vi.mocked(getNetworkPlan).mockResolvedValue({
    effectivePlan: { planId: "pro", planName: "Pro" },
    assignment: { planId: "pro", expiresAt: null, startedAt: "2026-01-01" },
  });
  vi.mocked(assignNetworkPlan).mockResolvedValue({
    ok: false,
    status: 409,
    error: "subscription_exists",
  });
  render(<BillingAssignmentsTab />);
  fireEvent.change(await screen.findByLabelText("Network"), { target: { value: "network" } });
  fireEvent.change(await screen.findByLabelText("Plan"), { target: { value: "" } });
  fireEvent.click(screen.getByRole("button", { name: "Enregistrer l’attribution" }));
  await waitFor(() => expect(assignNetworkPlan).toHaveBeenCalledWith("network", null, null));
  expect(await screen.findByRole("alert")).toHaveTextContent(/abonnement payant/i);
});
