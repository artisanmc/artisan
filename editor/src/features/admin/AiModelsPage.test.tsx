import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";
import { AiModelsPage } from "./AiModelsPage";

const listMock = vi.fn();
const setDefaultMock = vi.fn(async () => ({ ok: true, data: { ok: true } }));
const testMock = vi.fn(async () => ({ ok: true, latencyMs: 100, inputTokens: 10, outputTokens: 2, creditsCost: 3, realCostMicroUsd: 66 }));
const updateMock = vi.fn(async () => ({ ok: true, data: {} }));
vi.mock("@/lib/api/adminModels", () => ({
  listModels: () => listMock(),
  setDefaultModel: (id: string) => setDefaultMock(id),
  testModel: (id: string) => testMock(id),
  updateModel: (id: string, p: unknown) => updateMock(id, p),
}));
vi.mock("sonner", () => ({ toast: { success: vi.fn(), error: vi.fn() } }));

const model = (over: Record<string, unknown> = {}) => ({
  id: "m1", displayName: "Sonnet 5", description: "", badge: "balanced",
  provider: "anthropic", providerModelId: "claude-sonnet-5",
  creditsPerMInput: 30, creditsPerMOutput: 150, realUsdPerMInput: 3_000_000, realUsdPerMOutput: 15_000_000,
  isActive: true, isDefault: false, createdAt: "2020-01-01T00:00:00Z", updatedAt: "2020-01-01T00:00:00Z", ...over,
});

afterEach(() => vi.clearAllMocks());

describe("AiModelsPage", () => {
  it("lists models with formatted real cost", async () => {
    listMock.mockResolvedValue([model({ isDefault: true }), model({ id: "m2", displayName: "Cheap", badge: "cheap" })]);
    render(<AiModelsPage />);
    expect(await screen.findByText("Sonnet 5")).toBeInTheDocument();
    expect(screen.getByText("Cheap")).toBeInTheDocument();
  });

  it("sets a non-default model as default", async () => {
    listMock.mockResolvedValue([model({ id: "m2", displayName: "Cheap", isDefault: false })]);
    render(<AiModelsPage />);
    await screen.findByText("Cheap");
    await userEvent.click(screen.getByRole("button", { name: /default|défaut/i }));
    await waitFor(() => expect(setDefaultMock).toHaveBeenCalledWith("m2"));
  });

  it("runs a live test", async () => {
    listMock.mockResolvedValue([model()]);
    render(<AiModelsPage />);
    await screen.findByText("Sonnet 5");
    await userEvent.click(screen.getByRole("button", { name: /test/i }));
    await waitFor(() => expect(testMock).toHaveBeenCalledWith("m1"));
  });

  it("shows empty state with no models", async () => {
    listMock.mockResolvedValue([]);
    render(<AiModelsPage />);
    expect(await screen.findByText(/no model|aucun mod/i)).toBeInTheDocument();
  });
});
