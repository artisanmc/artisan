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
    api.getAiSettings.mockResolvedValue(
      settings({ providers: ["anthropic", "artisan", "openai"] }),
    );
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
  const image = (over: Record<string, unknown> = {}) => ({
    image: {
      enabled: false,
      provider: null,
      model: "",
      baseUrl: "",
      dailyLimit: 40,
      keyHint: null,
      ...over,
    },
    imageProviders: ["google", "openai"],
    imageDefaultModels: { openai: "gpt-image-1", google: "gemini-2.5-flash-image" },
  });

  it("sets an image model beside the assistant, its key kept like the assistant's", async () => {
    api.getAiSettings.mockResolvedValue(
      settings({
        source: "database",
        enabled: true,
        provider: "anthropic",
        keyHint: "…abcd",
        ...image(),
      }),
    );
    api.saveAiSettings.mockResolvedValue(
      settings({
        source: "database",
        enabled: true,
        provider: "anthropic",
        keyHint: "…abcd",
        ...image({ enabled: true, provider: "openai", keyHint: "…9999" }),
      }),
    );
    render(<AssistantSettingsSection />);
    // None picked: no field of the image model shows.
    expect(await screen.findByRole("button", { name: "None" })).toHaveAttribute(
      "aria-pressed",
      "true",
    );
    expect(screen.queryByLabelText(/^Image API key/)).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "OpenAI (GPT Image)" }));
    expect(screen.getByText("Empty: gpt-image-1.")).toBeInTheDocument();
    fireEvent.change(screen.getByLabelText(/^Image API key/), { target: { value: "sk-img-9999" } });
    fireEvent.change(screen.getByLabelText(/^Pictures per player/), { target: { value: "12" } });
    fireEvent.click(screen.getByRole("button", { name: "Save" }));
    await waitFor(() =>
      expect(api.saveAiSettings).toHaveBeenCalledWith({
        provider: "anthropic",
        model: "claude-opus-5-5",
        effort: "medium",
        maxSteps: 25,
        baseUrl: "",
        image: {
          provider: "openai",
          model: "",
          baseUrl: "",
          dailyLimit: 12,
          apiKey: "sk-img-9999",
        },
      }),
    );
    expect(await screen.findByText(/Pictures are generated with gpt-image-1/)).toBeInTheDocument();
    expect(screen.getByLabelText(/^Image API key/)).toHaveValue("");

    // Saved again without touching the key: it is left out, the hub keeps it. None turns it off.
    fireEvent.click(screen.getByRole("button", { name: "Save" }));
    await waitFor(() => expect(api.saveAiSettings).toHaveBeenCalledTimes(2));
    expect(api.saveAiSettings.mock.calls[1]?.[0].image).toEqual({
      provider: "openai",
      model: "",
      baseUrl: "",
      dailyLimit: 40,
    });
    fireEvent.click(screen.getByRole("button", { name: "None" }));
    fireEvent.click(screen.getByRole("button", { name: "Save" }));
    await waitFor(() => expect(api.saveAiSettings).toHaveBeenCalledTimes(3));
    expect(api.saveAiSettings.mock.calls[2]?.[0].image).toBeNull();
  });

  it("sets an image model alone, the assistant left without a key", async () => {
    api.getAiSettings.mockResolvedValue(settings(image()));
    api.saveAiSettings.mockResolvedValue(
      settings(image({ enabled: true, provider: "google", keyHint: "…" })),
    );
    render(<AssistantSettingsSection />);
    fireEvent.click(await screen.findByRole("button", { name: "Google (Gemini image)" }));
    fireEvent.change(screen.getByLabelText(/^Image API key/), { target: { value: "g-key" } });
    fireEvent.click(screen.getByRole("button", { name: "Save" }));
    await waitFor(() => expect(api.saveAiSettings).toHaveBeenCalled());
    expect(api.saveAiSettings.mock.calls[0]?.[0]).toMatchObject({
      provider: "",
      image: { provider: "google", apiKey: "g-key", dailyLimit: 40 },
    });
    expect(await screen.findByText(/The assistant is off/)).toBeInTheDocument();
    expect(
      screen.getByText(/Pictures are generated with gemini-2.5-flash-image/),
    ).toBeInTheDocument();
  });

  it("picks one of artisanmc.net's image models, paid per picture, with no key nor address", async () => {
    const withCloud = (over: Record<string, unknown> = {}) => ({
      ...image(over),
      imageProviders: ["artisan", "google", "openai"],
    });
    api.getAiSettings.mockResolvedValue(
      settings({
        source: "database",
        enabled: true,
        provider: "anthropic",
        keyHint: "…abcd",
        ...withCloud(),
      }),
    );
    api.getAiCloud.mockResolvedValue({
      linked: true,
      balance: 12.5,
      buy: null,
      models: [],
      imageModels: [
        { id: "gpt-image", label: "GPT Image", transparency: true, price: 0.6 },
        { id: "nano", label: "Gemini image", transparency: false, price: 0.3 },
      ],
    });
    api.saveAiSettings.mockResolvedValue(
      settings({
        source: "database",
        enabled: true,
        provider: "anthropic",
        keyHint: "…abcd",
        ...withCloud({ enabled: true, provider: "artisan", model: "nano" }),
      }),
    );
    render(<AssistantSettingsSection />);
    fireEvent.click(await screen.findByRole("button", { name: "artisanmc.net credits" }));
    // No model picked yet: the first one is what the hub would ask.
    expect(
      await screen.findByRole("button", { name: "GPT Image · 0.6 credits a picture" }),
    ).toHaveAttribute("aria-pressed", "true");
    expect(screen.getByText("Balance: 12.5 credits.")).toBeInTheDocument();
    expect(screen.queryByLabelText(/^Image API key/)).not.toBeInTheDocument();
    expect(screen.queryByLabelText(/^Image API address/)).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Gemini image · 0.3 credits a picture" }));
    fireEvent.click(screen.getByRole("button", { name: "Save" }));
    await waitFor(() => expect(api.saveAiSettings).toHaveBeenCalled());
    expect(api.saveAiSettings.mock.calls[0]?.[0].image).toEqual({
      provider: "artisan",
      model: "nano",
      baseUrl: "",
      dailyLimit: 40,
    });
    expect(await screen.findByText(/Pictures are generated with nano/)).toBeInTheDocument();
  });

  it("says when artisanmc.net has no image model, or the network is not linked", async () => {
    api.getAiSettings.mockResolvedValue(
      settings({ ...image(), imageProviders: ["artisan", "google", "openai"] }),
    );
    api.getAiCloud.mockResolvedValue({ linked: true, balance: 1, buy: null, models: [] });
    const { unmount } = render(<AssistantSettingsSection />);
    fireEvent.click(await screen.findByRole("button", { name: "artisanmc.net credits" }));
    expect(await screen.findByText(/offers no image model yet/)).toBeInTheDocument();
    unmount();
    api.getAiCloud.mockResolvedValue({ linked: false });
    render(<AssistantSettingsSection />);
    fireEvent.click(await screen.findByRole("button", { name: "artisanmc.net credits" }));
    expect(await screen.findByText(/not linked to an artisanmc.net account/)).toBeInTheDocument();
  });

  it("names the image model's field a save refused", async () => {
    api.getAiSettings.mockResolvedValue(
      settings({
        source: "database",
        enabled: true,
        provider: "anthropic",
        keyHint: "…abcd",
        ...image(),
      }),
    );
    api.saveAiSettings.mockRejectedValue(new ApiError("invalid_input", 422, null, "image.baseUrl"));
    render(<AssistantSettingsSection />);
    fireEvent.click(await screen.findByRole("button", { name: "OpenAI (GPT Image)" }));
    fireEvent.click(screen.getByRole("button", { name: "Save" }));
    expect(await screen.findByText("Check this field: Image API address.")).toBeInTheDocument();
  });
});
