import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";
import { BillingGrantTab } from "./BillingGrantTab";

const grantMock = vi.fn();
vi.mock("@/lib/api/adminBilling", () => ({
  grantCredits: (networkId: string, amount: number, note?: string) => grantMock(networkId, amount, note),
}));

afterEach(() => vi.clearAllMocks());

async function fillAndSubmit(networkId: string, amount: string, note = "") {
  await userEvent.type(screen.getByLabelText("ID du network"), networkId);
  await userEvent.type(screen.getByLabelText("Montant (crédits)"), amount);
  if (note) await userEvent.type(screen.getByLabelText("Note (raison)"), note);
  await userEvent.click(screen.getByRole("button", { name: "Créditer" }));
}

describe("BillingGrantTab", () => {
  it("grants credits and shows the success message with the new balance", async () => {
    grantMock.mockResolvedValue({ ok: true, data: { ok: true, balance: 1500 } });
    render(<BillingGrantTab />);

    await fillAndSubmit("net-1", "500", "promo");

    await waitFor(() => expect(grantMock).toHaveBeenCalledWith("net-1", 500, "promo"));
    expect(await screen.findByText(/Crédité\. Nouveau solde/)).toBeInTheDocument();
    expect(screen.getByLabelText("ID du network")).toHaveValue("");
  });

  it("maps network_not_found to the FR error message", async () => {
    grantMock.mockResolvedValue({ ok: false, status: 404, error: "network_not_found" });
    render(<BillingGrantTab />);

    await fillAndSubmit("missing", "100");

    expect(await screen.findByText("Network introuvable.")).toBeInTheDocument();
  });
});
