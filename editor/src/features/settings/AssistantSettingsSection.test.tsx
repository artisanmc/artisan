import { ApiError } from "@/lib/api/client";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import i18n from "i18next";
import { beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { AssistantSettingsSection } from "./AssistantSettingsSection";

const api = vi.hoisted(() => ({
  getAiSettings: vi.fn(),
  saveAiSettings: vi.fn(),
  deleteAiSettings: vi.fn(),
  getAiCloud: vi.fn(),
}));
vi.mock("@/lib/api/ai", () => api);
vi.mock("@/state/aiStatus", () => ({ resetAiStatus: vi.fn() }));

const settings = (over: Record<string, unknown> = {}) => ({
  source: "none",
  editable: true,
  enabled: false,
  provider: null,
  model: "claude-opus-5-5",
  effort: "medium",
  maxSteps: 25,
  baseUrl: "",
  keyHint: null,
  providers: ["anthropic"],
  efforts: ["low", "medium", "high", "xhigh", "max"],
  defaultModel: "claude-opus-5-5",
  ...over,
});

beforeAll(async () => {
  await i18n.changeLanguage("en");
});

describe("assistant settings", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("picks one of artisanmc.net's models, with no key nor address", async () => {
    api.getAiSettings.mockResolvedValue(settings({ providers: ["anthropic", "artisan", "openai"] }));
    api.getAiCloud.mockResolvedValue({
      linked: true,
      balance: 12.5,
      buy: "https://artisanmc.net/account/#ai-credits",
      models: [
        { id: "claude", label: "Claude Sonnet", protocol: "anthropic", attachments: ["text"] },
        { id: "deepseek", label: "DeepSeek", protocol: "openai", attachments: ["text"] },
      ],
    });
    api.saveAiSettings.mockResolvedValue(
      settings({ source: "database", enabled: true, provider: "artisan", model: "deepseek" }),
    );
    render(<AssistantSettingsSection />);
    fireEvent.click(await screen.findByRole("button", { name: "artisanmc.net credits" }));

    expect(await screen.findByText("Balance: 12.5 credits.")).toBeInTheDocument();
    expect(screen.queryByLabelText(/^API key/)).not.toBeInTheDocument();
    expect(screen.queryByLabelText(/^Address/)).not.toBeInTheDocument();
    // Effort goes to Anthropic's protocol only.
    fireEvent.click(screen.getByRole("button", { name: "Claude Sonnet" }));
    expect(screen.getByRole("button", { name: "high" })).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "DeepSeek" }));
    expect(screen.queryByRole("button", { name: "high" })).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Save" }));

    await waitFor(() =>
      expect(api.saveAiSettings).toHaveBeenCalledWith({
        provider: "artisan",
        model: "deepseek",
        effort: "medium",
        maxSteps: 25,
        baseUrl: "",
      }),
    );
  });

  it("says when the network is not linked to an artisanmc.net account", async () => {
    api.getAiSettings.mockResolvedValue(settings({ providers: ["anthropic", "artisan"] }));
    api.getAiCloud.mockResolvedValue({ linked: false });
    render(<AssistantSettingsSection />);
    fireEvent.click(await screen.findByRole("button", { name: "artisanmc.net credits" }));
    expect(await screen.findByText(/not linked to an artisanmc.net account/)).toBeInTheDocument();
  });

  it("saves a model, an address and a key, then shows only the key's end", async () => {
    api.getAiSettings.mockResolvedValue(settings());
    api.saveAiSettings.mockResolvedValue(
      settings({
        source: "database",
        enabled: true,
        provider: "anthropic",
        model: "deepseek-chat",
        baseUrl: "https://api.deepseek.com/anthropic",
        keyHint: "…6789",
      }),
    );
    render(<AssistantSettingsSection />);
    expect(await screen.findByText(/The assistant is off/)).toBeInTheDocument();

    fireEvent.change(screen.getByLabelText(/^Address/), {
      target: { value: "https://api.deepseek.com/anthropic" },
    });
    fireEvent.change(screen.getByLabelText(/^Model/), { target: { value: "deepseek-chat" } });
    fireEvent.change(screen.getByLabelText(/^API key/), { target: { value: "sk-123456789" } });
    fireEvent.click(screen.getByRole("button", { name: "high" }));
    fireEvent.click(screen.getByRole("button", { name: "Save" }));

    await waitFor(() =>
      expect(api.saveAiSettings).toHaveBeenCalledWith({
        provider: "anthropic",
        model: "deepseek-chat",
        effort: "high",
        maxSteps: 25,
        baseUrl: "https://api.deepseek.com/anthropic",
        apiKey: "sk-123456789",
      }),
    );
    expect(await screen.findByText(/The assistant is on, with deepseek-chat/)).toBeInTheDocument();
    expect(screen.getByLabelText(/^API key/)).toHaveValue("");
    expect(screen.getByText(/A key ending in …6789 is saved/)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Turn off" })).toBeInTheDocument();
  });

  it("keeps the saved key when the field is left empty, and says why a save failed", async () => {
    api.getAiSettings.mockResolvedValue(
      settings({ source: "database", enabled: true, provider: "anthropic", keyHint: "…abcd" }),
    );
    api.saveAiSettings.mockRejectedValue(new ApiError("ai_key_required", 422, null, "apiKey"));
    render(<AssistantSettingsSection />);
    fireEvent.change(await screen.findByLabelText(/^Address/), {
      target: { value: "https://elsewhere.example" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Save" }));
    await waitFor(() => expect(api.saveAiSettings).toHaveBeenCalled());
    expect(api.saveAiSettings.mock.calls[0]?.[0]).not.toHaveProperty("apiKey");
    expect(await screen.findByText(/enter the key again/)).toBeInTheDocument();
  });

  it("switches to an OpenAI-compatible API: a vendor's address in one click, no Claude model, no effort", async () => {
    api.getAiSettings.mockResolvedValue(settings({ providers: ["anthropic", "openai"] }));
    api.saveAiSettings.mockResolvedValue(settings({ providers: ["anthropic", "openai"] }));
    render(<AssistantSettingsSection />);
    fireEvent.click(await screen.findByRole("button", { name: /OpenAI-compatible/ }));
    expect(screen.getByLabelText(/^Model/)).toHaveValue("");
    expect(screen.queryByRole("button", { name: "high" })).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "DeepSeek" }));
    expect(screen.getByLabelText(/^Address/)).toHaveValue("https://api.deepseek.com");
    expect(screen.getByRole("button", { name: "DeepSeek" })).toHaveAttribute(
      "aria-pressed",
      "true",
    );
    fireEvent.change(screen.getByLabelText(/^Model/), { target: { value: "deepseek-chat" } });
    fireEvent.change(screen.getByLabelText(/^API key/), { target: { value: "sk-123456789" } });
    fireEvent.click(screen.getByRole("button", { name: "Save" }));
    await waitFor(() =>
      expect(api.saveAiSettings).toHaveBeenCalledWith(
        expect.objectContaining({
          provider: "openai",
          model: "deepseek-chat",
          baseUrl: "https://api.deepseek.com",
        }),
      ),
    );
  });

  it("shows environment.yml's settings read-only", async () => {
    api.getAiSettings.mockResolvedValue(
      settings({ source: "file", editable: false, enabled: true, provider: "anthropic" }),
    );
    render(<AssistantSettingsSection />);
    expect(
      await screen.findByText(/come from the ai section of environment.yml/),
    ).toBeInTheDocument();
    expect(screen.getByLabelText(/^Model/)).toBeDisabled();
    expect(screen.queryByRole("button", { name: "Save" })).not.toBeInTheDocument();
  });
});
