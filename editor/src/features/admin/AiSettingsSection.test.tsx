import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";
import { AiSettingsSection } from "./AiSettingsSection";

const getMock = vi.fn(async () => ({
  creditUsdMicroRate: 10_000,
  maxCreditsPerTurn: 500,
  pricingMarginPct: 100,
}));
const putMock = vi.fn(async () => ({
  ok: true,
  data: { creditUsdMicroRate: 20_000, maxCreditsPerTurn: null, pricingMarginPct: 40 },
}));

vi.mock("@/lib/api/adminModels", () => ({
  getAiSettings: () => getMock(),
  putAiSettings: (patch: unknown) => putMock(patch),
}));

const toastErrorMock = vi.fn();
const toastSuccessMock = vi.fn();
vi.mock("sonner", () => ({
  toast: {
    success: (...args: unknown[]) => toastSuccessMock(...args),
    error: (...args: unknown[]) => toastErrorMock(...args),
  },
}));

afterEach(() => vi.clearAllMocks());

describe("AiSettingsSection", () => {
  it("loads existing settings, converting the micro-USD rate to a readable $ amount", async () => {
    render(<AiSettingsSection />);
    const rateField = screen.getByLabelText(/taux crédit|credit.*rate/i) as HTMLInputElement;
    await waitFor(() => expect(rateField.value).toBe("0.01"));
    expect((screen.getByLabelText(/crédits max|max credits/i) as HTMLInputElement).value).toBe(
      "500",
    );
  });

  it("saves with maxCreditsPerTurn empty -> null and the $ rate converted back to micro-USD", async () => {
    render(<AiSettingsSection />);
    const rateField = screen.getByLabelText(/taux crédit|credit.*rate/i) as HTMLInputElement;
    await waitFor(() => expect(rateField.value).toBe("0.01"));

    const maxField = screen.getByLabelText(/crédits max|max credits/i);
    await userEvent.clear(maxField);

    await userEvent.clear(rateField);
    await userEvent.type(rateField, "0.02");

    const marginField = screen.getByLabelText(/marge appliquée|applied margin/i);
    await userEvent.clear(marginField);
    await userEvent.type(marginField, "40");

    await userEvent.click(screen.getByRole("button", { name: /enregistrer|save/i }));

    await waitFor(() =>
      expect(putMock).toHaveBeenCalledWith({
        creditUsdMicroRate: 20_000,
        maxCreditsPerTurn: null,
        pricingMarginPct: 40,
      }),
    );
    expect(toastSuccessMock).toHaveBeenCalled();
  });
});
