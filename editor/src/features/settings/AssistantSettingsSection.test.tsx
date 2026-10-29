import { ApiError } from "@/lib/api/client";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import i18n from "i18next";
import { beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { AssistantSettingsSection } from "./AssistantSettingsSection";

const api = vi.hoisted(() => ({
  getAiSettings: vi.fn(),
  saveAiSettings: vi.fn(),
  deleteAiSettings: vi.fn(),
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
