import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";
import { AiProvidersSection } from "./AiProvidersSection";

const listProvidersMock = vi.fn();
const putProviderMock = vi.fn(async () => ({ ok: true, data: { ok: true } }));

vi.mock("@/lib/api/adminModels", () => ({
  listProviders: () => listProvidersMock(),
  putProvider: (slug: string, body: unknown) => putProviderMock(slug, body),
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

describe("AiProvidersSection", () => {
  it("lists preset providers", async () => {
    listProvidersMock.mockResolvedValue({
      openai: { label: "OpenAI", baseUrl: "", keySet: false, preset: true },
      deepseek: { label: "DeepSeek", baseUrl: "", keySet: true, preset: true },
    });
    render(<AiProvidersSection />);
    expect(await screen.findByText("OpenAI")).toBeInTheDocument();
    expect(screen.getByText("DeepSeek")).toBeInTheDocument();
  });

  it("saves a provider (PUT) with base URL and a newly typed key", async () => {
    listProvidersMock.mockResolvedValue({
      openai: { label: "OpenAI", baseUrl: "", keySet: false, preset: true },
    });
    render(<AiProvidersSection />);
    await screen.findByText("OpenAI");

    await userEvent.type(screen.getByLabelText(/base url/i), "https://api.openai.com");
    await userEvent.type(screen.getByLabelText(/clé api|api key/i), "sk-new");
    await userEvent.click(screen.getByRole("button", { name: /enregistrer|save/i }));

    await waitFor(() =>
      expect(putProviderMock).toHaveBeenCalledWith(
        "openai",
        expect.objectContaining({ baseUrl: "https://api.openai.com", apiKey: "sk-new" }),
      ),
    );
    expect(toastSuccessMock).toHaveBeenCalled();
  });

  it("shows a toast when encryption is not configured (503)", async () => {
    listProvidersMock.mockResolvedValue({
      openai: { label: "OpenAI", baseUrl: "", keySet: false, preset: true },
    });
    putProviderMock.mockResolvedValueOnce({
      ok: false,
      status: 503,
      error: "encryption_not_configured",
    } as never);
    render(<AiProvidersSection />);
    await screen.findByText("OpenAI");

    await userEvent.click(screen.getByRole("button", { name: /enregistrer|save/i }));

    await waitFor(() => expect(toastErrorMock).toHaveBeenCalled());
  });

  it("adds a custom provider", async () => {
    listProvidersMock.mockResolvedValue({});
    render(<AiProvidersSection />);

    await userEvent.click(screen.getByRole("button", { name: /ajouter un provider|add custom/i }));

    await userEvent.type(screen.getByLabelText(/slug/i), "groq");
    await userEvent.type(screen.getByLabelText(/nom du provider|provider name/i), "Groq");
    await userEvent.type(screen.getByLabelText(/base url/i), "https://api.groq.com");
    await userEvent.type(screen.getByLabelText(/clé api|api key/i), "sk-groq");
    await userEvent.click(screen.getByRole("button", { name: /enregistrer|save/i }));

    await waitFor(() =>
      expect(putProviderMock).toHaveBeenCalledWith(
        "groq",
        expect.objectContaining({
          label: "Groq",
          baseUrl: "https://api.groq.com",
          apiKey: "sk-groq",
        }),
      ),
    );
  });
});
