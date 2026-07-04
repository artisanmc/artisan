import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";
import { BillingPacksTab } from "./BillingPacksTab";

const listMock = vi.fn();
const createMock = vi.fn(async () => ({ ok: true, data: {} }));
const updateMock = vi.fn(async () => ({ ok: true, data: {} }));
const deactivateMock = vi.fn(async () => ({ ok: true, data: { ok: true } }));
vi.mock("@/lib/api/adminBilling", () => ({
  listPacks: () => listMock(),
  createPack: (input: unknown) => createMock(input),
  updatePack: (id: string, patch: unknown) => updateMock(id, patch),
  deactivatePack: (id: string) => deactivateMock(id),
}));
vi.mock("sonner", () => ({ toast: { success: vi.fn(), error: vi.fn() } }));

const pack = (over: Record<string, unknown> = {}) => ({
  id: "p1",
  name: "Starter",
  priceCents: 999,
  currency: "usd",
  credits: 1000,
  bonusPct: 10,
  isActive: true,
  sortOrder: 0,
  stripeProductId: null,
  stripePriceId: null,
  createdAt: "2020-01-01T00:00:00Z",
  updatedAt: "2020-01-01T00:00:00Z",
  ...over,
});

afterEach(() => vi.clearAllMocks());

describe("BillingPacksTab", () => {
  it("lists packs with formatted price and credits (FR)", async () => {
    listMock.mockResolvedValue([pack()]);
    render(<BillingPacksTab />);
    expect(await screen.findByText("Starter")).toBeInTheDocument();
    expect(screen.getByText("10%")).toBeInTheDocument();
    expect(screen.getByText("1 000")).toBeInTheDocument();
    expect(screen.getByText(/9,99/)).toBeInTheDocument();
    expect(screen.getByText("Actif")).toBeInTheDocument();
  });

  it("opens the create form from 'Nouveau pack' and submits", async () => {
    listMock.mockResolvedValue([]);
    render(<BillingPacksTab />);
    await screen.findByText(/aucun pack/i);

    await userEvent.click(screen.getByRole("button", { name: "Nouveau pack" }));
    expect(screen.getByRole("heading", { name: "Nouveau pack" })).toBeInTheDocument();

    await userEvent.type(screen.getByLabelText("Nom"), "Mega pack");
    await userEvent.click(screen.getByRole("button", { name: "Enregistrer" }));

    await waitFor(() =>
      expect(createMock).toHaveBeenCalledWith(expect.objectContaining({ name: "Mega pack" })),
    );
  });

  it("deactivates an active pack and reloads", async () => {
    listMock.mockResolvedValue([pack()]);
    render(<BillingPacksTab />);
    await screen.findByText("Starter");
    await userEvent.click(screen.getByRole("button", { name: "Désactiver" }));
    await waitFor(() => expect(deactivateMock).toHaveBeenCalledWith("p1"));
  });
});
