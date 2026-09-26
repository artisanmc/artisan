import type { AdminPlan } from "@/lib/api/adminBilling";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";
import { PlanForm } from "./PlanForm";

const createMock = vi.fn();
const updateMock = vi.fn();
vi.mock("@/lib/api/adminBilling", () => ({
  createPlan: (input: unknown) => createMock(input),
  updatePlan: (id: string, input: unknown) => updateMock(id, input),
}));
vi.mock("sonner", () => ({ toast: { success: vi.fn(), error: vi.fn() } }));

const plan: AdminPlan = {
  id: "pro",
  name: "Pro",
  interval: "month",
  priceCents: 1200,
  currency: "eur",
  creditsPerPeriod: 1500,
  rolloverCap: 0,
  features: "First benefit\nSecond benefit",
  description: "For your network",
  highlighted: true,
  editorPro: false,
  isActive: true,
  sortOrder: 2,
  stripePriceId: "price_pro",
  stripeProductId: "prod_pro",
  createdAt: "",
  updatedAt: "",
};

afterEach(() => vi.clearAllMocks());

describe("PlanForm", () => {
  it("defaults new subscription offers to EUR", () => {
    render(<PlanForm open plan={null} onClose={vi.fn()} onSaved={vi.fn()} />);
    expect(screen.getByRole("textbox", { name: /devise/i })).toHaveValue("eur");
  });

  it("keeps the presentation editable and allows retry after a connection error", async () => {
    updateMock
      .mockRejectedValueOnce(new Error("offline"))
      .mockResolvedValueOnce({ ok: true, data: plan });
    const onSaved = vi.fn();
    render(<PlanForm open plan={plan} onClose={vi.fn()} onSaved={onSaved} />);
    await userEvent.click(screen.getByRole("button", { name: "Enregistrer" }));
    await waitFor(() => expect(screen.getByRole("button", { name: "Enregistrer" })).toBeEnabled());
    expect(onSaved).not.toHaveBeenCalled();
    expect(screen.getByRole("textbox", { name: /description courte/i })).toHaveValue(
      "For your network",
    );
    await userEvent.click(screen.getByRole("button", { name: "Enregistrer" }));
    await waitFor(() => expect(onSaved).toHaveBeenCalledOnce());
  });

  it("loads and saves the public presentation, multiline benefits and ordering with the existing price", async () => {
    updateMock.mockResolvedValue({ ok: true, data: plan });
    const onSaved = vi.fn();
    render(<PlanForm open plan={plan} onClose={vi.fn()} onSaved={onSaved} />);
    const description = screen.getByRole("textbox", { name: /description courte/i });
    expect(description).toHaveValue("For your network");
    const features = screen.getByRole("textbox", { name: /fonctionnalités/i });
    expect(features).toHaveValue("First benefit\nSecond benefit");
    expect(features.tagName).toBe("TEXTAREA");
    expect(screen.getByRole("checkbox", { name: /mettre en avant/i })).toBeChecked();
    await userEvent.clear(description);
    await userEvent.type(description, "A public description");
    await userEvent.clear(features);
    await userEvent.type(features, "Benefit one{Enter}Benefit two");
    await userEvent.click(screen.getByRole("checkbox", { name: /mettre en avant/i }));
    await userEvent.click(screen.getByRole("button", { name: "Enregistrer" }));
    await waitFor(() =>
      expect(updateMock).toHaveBeenCalledWith("pro", {
        name: "Pro",
        interval: "month",
        priceCents: 1200,
        currency: "eur",
        creditsPerPeriod: 1500,
        rolloverCap: 0,
        description: "A public description",
        highlighted: false,
        editorPro: false,
        features: "Benefit one\nBenefit two",
        sortOrder: 2,
        isActive: true,
      }),
    );
    expect(onSaved).toHaveBeenCalledOnce();
  });
});
