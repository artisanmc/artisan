import { render, screen } from "@testing-library/react";
import { expect, it, vi } from "vitest";
import { BillingPage } from "./BillingPage";

vi.mock("./BillingSalesTab", () => ({ BillingSalesTab: () => null }));
vi.mock("./BillingPacksTab", () => ({ BillingPacksTab: () => null }));
vi.mock("./BillingPlansTab", () => ({ BillingPlansTab: () => null }));
vi.mock("./BillingGrantTab", () => ({ BillingGrantTab: () => null }));

it("keeps plan rules in subscriptions without a separate editor policy", () => {
  render(<BillingPage />);
  expect(screen.getAllByRole("tab")).toHaveLength(5);
  expect(screen.queryByRole("tab", { name: "Accès éditeur" })).not.toBeInTheDocument();
});
