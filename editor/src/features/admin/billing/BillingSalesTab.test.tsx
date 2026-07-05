import { render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { formatMoney } from "@/lib/format";
import { BillingSalesTab } from "./BillingSalesTab";

const salesMock = vi.fn();
vi.mock("@/lib/api/adminBilling", () => ({
  getSales: (from?: string, to?: string) => salesMock(from, to),
}));

afterEach(() => vi.clearAllMocks());

// Intl.NumberFormat("fr") uses a narrow no-break space (U+202F) as separator; normalize
// to a regular space to match testing-library's whitespace-collapsed DOM text.
const norm = (s: string) => s.replace(/\s/gu, " ");

describe("BillingSalesTab", () => {
  it("shows stat cards (FR) with per-currency money and a per-plan row", async () => {
    salesMock.mockResolvedValue({
      from: "2026-06-01",
      to: "2026-07-01",
      topups: { count: 12, byCurrency: { usd: 5000, eur: 3000 } },
      subscriptions: {
        activeCount: 7,
        mrrByCurrency: { usd: 2000 },
        perPlan: [{ planId: "p1", planName: "Pro", currency: "usd", priceCents: 1000, activeCount: 2 }],
      },
      daily: [{ date: "2026-06-30", topupCents: 500, topupCount: 3 }],
    });

    render(<BillingSalesTab />);

    expect(await screen.findByText("Ventes")).toBeInTheDocument();
    const revenueText = norm(`${formatMoney(5000, "usd", "fr")} / ${formatMoney(3000, "eur", "fr")}`);
    expect(screen.getByText((_, el) => norm(el?.textContent ?? "") === revenueText)).toBeInTheDocument();
    // MRR stat and the per-plan caption both render 20,00 $US (2000 cents) here — assert both are present.
    expect(screen.getAllByText(norm(formatMoney(2000, "usd", "fr")))).toHaveLength(2);
    expect(screen.getByText("Pro")).toBeInTheDocument();
  });

  it("shows the no-data state when everything is empty", async () => {
    salesMock.mockResolvedValue({
      from: "",
      to: "",
      topups: { count: 0, byCurrency: {} },
      subscriptions: { activeCount: 0, mrrByCurrency: {}, perPlan: [] },
      daily: [],
    });
    render(<BillingSalesTab />);
    expect(await screen.findByText(/aucune vente/i)).toBeInTheDocument();
  });

  it("degrades to the no-data state without throwing when the fetch rejects", async () => {
    salesMock.mockRejectedValue(new Error("network"));
    render(<BillingSalesTab />);
    expect(await screen.findByText(/aucune vente/i)).toBeInTheDocument();
  });
});
