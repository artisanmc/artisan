import { formatCredits } from "@/lib/format";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { toast } from "sonner";
import { afterEach, describe, expect, it, vi } from "vitest";
import { UserAiTab } from "./UserAiTab";

const FOCUS = {
  totals: {
    inputTokens: 1200,
    outputTokens: 300,
    creditsCharged: 150,
    realCostMicroUsd: 500_000,
    turns: 7,
    errors: 0,
  },
  byModel: [
    {
      modelId: "m1",
      modelName: "Sonnet 5",
      provider: "anthropic",
      inputTokens: 1200,
      outputTokens: 300,
      creditsCharged: 120,
      realCostMicroUsd: 500_000,
      turns: 7,
    },
  ],
  networks: [
    {
      id: "n1",
      name: "Survie",
      balance: 900,
      grants: [
        {
          id: "g1",
          delta: 1000,
          reason: "manual_grant",
          note: "starter",
          createdBy: "admin1",
          createdAt: "2026-06-01T00:00:00Z",
        },
      ],
    },
  ],
};

const getUserFocusMock = vi.fn();
const grantCreditsMock = vi.fn();

vi.mock("@/lib/api/adminAiUsage", () => ({
  getUserFocus: (...args: unknown[]) => getUserFocusMock(...args),
  grantCredits: (...args: unknown[]) => grantCreditsMock(...args),
}));
vi.mock("sonner", () => ({ toast: { success: vi.fn(), error: vi.fn() } }));

// Intl.NumberFormat("fr") uses a narrow no-break space (U+202F) — normalize before matching.
const norm = (s: string) => s.replace(/\s/gu, " ");

afterEach(() => vi.clearAllMocks());

describe("UserAiTab", () => {
  it("loads the focus and shows turns/credits/tokens + networks with balance and grants", async () => {
    getUserFocusMock.mockResolvedValue(FOCUS);
    render(<UserAiTab userId="u2" />);

    await waitFor(() =>
      expect(getUserFocusMock).toHaveBeenCalledWith("u2", expect.any(String), expect.any(String)),
    );
    expect(await screen.findByText(norm(formatCredits(7, "fr")))).toBeInTheDocument();
    expect(screen.getByText(norm(formatCredits(150, "fr")))).toBeInTheDocument();
    const tokensText = `${formatCredits(1200, "fr")} / ${formatCredits(300, "fr")}`;
    expect(
      screen.getByText((_content, el) => norm(el?.textContent ?? "") === norm(tokensText)),
    ).toBeInTheDocument();
    expect(screen.getByText("Sonnet 5")).toBeInTheDocument();

    expect(screen.getByText("Survie")).toBeInTheDocument();
    expect(
      screen.getByText(
        (_content, el) =>
          norm(el?.textContent ?? "") === norm(`Solde de crédits · ${formatCredits(900, "fr")}`),
      ),
    ).toBeInTheDocument();
    expect(screen.getByText(/starter/i)).toBeInTheDocument();
  });

  it("submits grantCredits with networkId/amount/note and refetches focus", async () => {
    getUserFocusMock.mockResolvedValue(FOCUS);
    grantCreditsMock.mockResolvedValue({ ok: true, data: { ok: true, balance: 1400 } });
    render(<UserAiTab userId="u2" />);
    await screen.findByText("Survie");

    await userEvent.click(screen.getByRole("button", { name: /donner des crédits/i }));
    const amountInput = screen.getByRole("spinbutton");
    await userEvent.type(amountInput, "500");
    const noteInput = screen.getByPlaceholderText(/note/i);
    await userEvent.type(noteInput, "bonus");
    await userEvent.click(screen.getByRole("button", { name: /donner des crédits/i }));

    await waitFor(() => expect(grantCreditsMock).toHaveBeenCalledWith("n1", 500, "bonus"));
    await waitFor(() => expect(getUserFocusMock).toHaveBeenCalledTimes(2));
    expect(toast.success).toHaveBeenCalled();
  });

  it("shows a toast error when the grant amount is invalid", async () => {
    getUserFocusMock.mockResolvedValue(FOCUS);
    grantCreditsMock.mockResolvedValue({ ok: false, status: 400, error: "invalid_amount" });
    render(<UserAiTab userId="u2" />);
    await screen.findByText("Survie");

    await userEvent.click(screen.getByRole("button", { name: /donner des crédits/i }));
    const amountInput = screen.getByRole("spinbutton");
    await userEvent.type(amountInput, "-5");
    await userEvent.click(screen.getByRole("button", { name: /donner des crédits/i }));

    await waitFor(() => expect(toast.error).toHaveBeenCalled());
  });
});
