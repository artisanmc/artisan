import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import { CreditIndicator, creditTone } from "./CreditIndicator";

describe("creditTone", () => {
  it("empty when total <= 0", () => {
    expect(creditTone({ total: 0, subscription: 0, rollover: 0, topup: 0 })).toBe("empty");
  });
  it("critical/low/ok by TOTAL vs quota", () => {
    expect(
      creditTone({ total: 4, subscription: 4, rollover: 0, topup: 0, subscriptionQuota: 100 }),
    ).toBe("critical");
    expect(
      creditTone({ total: 15, subscription: 15, rollover: 0, topup: 0, subscriptionQuota: 100 }),
    ).toBe("low");
    expect(
      creditTone({ total: 100, subscription: 80, rollover: 0, topup: 20, subscriptionQuota: 100 }),
    ).toBe("ok");
  });
  it("does NOT cry wolf when subscription is spent but rollover/top-up remain", () => {
    // subscription bucket empty at period-end, but 5000 top-up left → healthy.
    expect(
      creditTone({
        total: 5000,
        subscription: 0,
        rollover: 0,
        topup: 5000,
        subscriptionQuota: 1000,
      }),
    ).toBe("ok");
  });
  it("ok when positive and no quota", () => {
    expect(creditTone({ total: 50, subscription: 0, rollover: 0, topup: 50 })).toBe("ok");
  });
});

describe("CreditIndicator", () => {
  it("renders null while loading (balance null)", () => {
    const { container } = render(<CreditIndicator balance={null} onRecharge={() => {}} />);
    expect(container.firstChild).toBeNull();
  });
  it("shows the total (FR locale)", () => {
    render(
      <CreditIndicator
        balance={{ total: 1200, subscription: 0, rollover: 0, topup: 1200 }}
        onRecharge={() => {}}
      />,
    );
    expect(screen.getByText(/1\s?200 crédits/)).toBeTruthy();
  });
  it("shows the recharge action in the breakdown when onRecharge is provided", async () => {
    render(
      <CreditIndicator
        balance={{ total: 100, subscription: 0, rollover: 0, topup: 100 }}
        onRecharge={() => {}}
      />,
    );
    await userEvent.click(screen.getByRole("button"));
    expect(screen.getByText(/Ajouter des crédits|Add credits/)).toBeTruthy();
  });
  it("omits the recharge action when onRecharge is not provided (already on the credits page)", async () => {
    render(<CreditIndicator balance={{ total: 100, subscription: 0, rollover: 0, topup: 100 }} />);
    await userEvent.click(screen.getByRole("button"));
    expect(screen.queryByText(/Ajouter des crédits|Add credits/)).toBeNull();
  });
  it("exposes a data-tone attribute for the empty state", () => {
    render(
      <CreditIndicator
        balance={{ total: 0, subscription: 0, rollover: 0, topup: 0 }}
        onRecharge={() => {}}
      />,
    );
    expect(document.querySelector('[data-tone="empty"]')).toBeTruthy();
  });
});
