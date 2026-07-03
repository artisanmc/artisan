import type { AiModelDto } from "@/lib/api/adminModels";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";
import { AiModelForm } from "./AiModelForm";

const createMock = vi.fn(async () => ({ ok: true, data: {} }) as { ok: true; data: unknown });
const updateMock = vi.fn(async () => ({ ok: true, data: {} }) as { ok: true; data: unknown });
const listProvidersMock = vi.fn(async () => null as Record<string, unknown> | null);

vi.mock("@/lib/api/adminModels", () => ({
  createModel: (input: unknown) => createMock(input),
  updateModel: (id: string, patch: unknown) => updateMock(id, patch),
  listProviders: () => listProvidersMock(),
}));

const toastErrorMock = vi.fn();
const toastSuccessMock = vi.fn();
vi.mock("sonner", () => ({
  toast: {
    success: (...args: unknown[]) => toastSuccessMock(...args),
    error: (...args: unknown[]) => toastErrorMock(...args),
  },
}));

const model = (over: Partial<AiModelDto> = {}): AiModelDto => ({
  id: "m1",
  displayName: "Sonnet 5",
  description: "desc",
  badge: "balanced",
  provider: "anthropic",
  providerModelId: "claude-sonnet-5",
  creditsPerMInput: 30,
  creditsPerMOutput: 150,
  realUsdPerMInput: 3_000_000,
  realUsdPerMOutput: 15_000_000,
  isActive: true,
  isDefault: false,
  createdAt: "2020-01-01T00:00:00Z",
  updatedAt: "2020-01-01T00:00:00Z",
  ...over,
});

afterEach(() => vi.clearAllMocks());

describe("AiModelForm", () => {
  it("creates a model with USD converted to micro-USD", async () => {
    listProvidersMock.mockResolvedValue(null);
    render(<AiModelForm open onClose={vi.fn()} model={null} onSaved={vi.fn()} />);

    await userEvent.type(screen.getByLabelText(/display name|nom affiché/i), "Sonnet 5");
    await userEvent.type(screen.getByLabelText(/provider model id|id modèle/i), "claude-sonnet-5");
    await userEvent.type(screen.getByLabelText(/^provider$/i), "anthropic");
    await userEvent.type(screen.getByLabelText(/\$.*(input|entrée)/i), "3");
    await userEvent.type(screen.getByLabelText(/\$.*(output|sortie)/i), "15");
    await userEvent.click(screen.getByRole("button", { name: /save|enregistrer/i }));

    await waitFor(() => expect(createMock).toHaveBeenCalled());
    const body = createMock.mock.calls[0][0] as Record<string, unknown>;
    expect(body.realUsdPerMInput).toBe(3_000_000);
    expect(body.realUsdPerMOutput).toBe(15_000_000);
    expect(body.displayName).toBe("Sonnet 5");
    expect(body.provider).toBe("anthropic");
    expect(body.providerModelId).toBe("claude-sonnet-5");
  });

  it("prefills fields from model on edit and calls updateModel with the patch", async () => {
    listProvidersMock.mockResolvedValue(null);
    const m = model();
    render(<AiModelForm open onClose={vi.fn()} model={m} onSaved={vi.fn()} />);

    expect(screen.getByLabelText(/display name|nom affiché/i)).toHaveValue("Sonnet 5");
    expect(screen.getByLabelText(/\$.*(input|entrée)/i)).toHaveValue(3);
    expect(screen.getByLabelText(/\$.*(output|sortie)/i)).toHaveValue(15);

    await userEvent.click(screen.getByRole("button", { name: /save|enregistrer/i }));

    await waitFor(() => expect(updateMock).toHaveBeenCalled());
    expect(updateMock.mock.calls[0][0]).toBe("m1");
    const patch = updateMock.mock.calls[0][1] as Record<string, unknown>;
    expect(patch.realUsdPerMInput).toBe(3_000_000);
    expect(patch.displayName).toBe("Sonnet 5");
  });

  it("shows a toast when the provider key is missing", async () => {
    listProvidersMock.mockResolvedValue(null);
    createMock.mockResolvedValue({
      ok: false,
      status: 400,
      error: "provider_key_missing",
    } as never);
    render(<AiModelForm open onClose={vi.fn()} model={null} onSaved={vi.fn()} />);

    await userEvent.click(screen.getByRole("button", { name: /save|enregistrer/i }));

    await waitFor(() => expect(toastErrorMock).toHaveBeenCalled());
  });
});
