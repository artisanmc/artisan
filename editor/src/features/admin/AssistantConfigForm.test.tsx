import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";
import { AssistantConfigForm } from "./AssistantConfigForm";

const getMock = vi.fn(async () => ({
  provider: "openai",
  baseUrl: "",
  model: "gpt-4.1-mini",
  keySet: true,
}));
const putMock = vi.fn(async () => ({
  ok: true,
  data: { provider: "deepseek", baseUrl: "", model: "deepseek-chat", keySet: true },
}));
const testMock = vi.fn(async () => ({ ok: true }));

vi.mock("@/lib/api/adminConfig", () => ({
  getAssistantConfig: () => getMock(),
  putAssistantConfig: (b: unknown) => putMock(b),
  testAssistantConfig: (b: unknown) => testMock(b),
}));

afterEach(() => vi.clearAllMocks());

describe("AssistantConfigForm", () => {
  it("loads existing config and masks the key", async () => {
    render(<AssistantConfigForm />);
    await waitFor(() =>
      expect((screen.getByLabelText(/model|modèle/i) as HTMLInputElement).value).toBe(
        "gpt-4.1-mini",
      ),
    );
    // The real key is never returned by the API; the field stays empty.
    expect((screen.getByLabelText(/api key|clé api/i) as HTMLInputElement).value).toBe("");
  });

  it("saves the form (PUT) including a newly typed key", async () => {
    render(<AssistantConfigForm />);
    await waitFor(() => expect(getMock).toHaveBeenCalled());
    await userEvent.type(screen.getByLabelText(/api key|clé api/i), "sk-new");
    await userEvent.click(screen.getByText(/save|enregistrer/i));
    await waitFor(() =>
      expect(putMock).toHaveBeenCalledWith(expect.objectContaining({ apiKey: "sk-new" })),
    );
  });

  it("tests the connection", async () => {
    render(<AssistantConfigForm />);
    await userEvent.click(screen.getByText(/test|tester/i));
    await waitFor(() => expect(testMock).toHaveBeenCalled());
  });
});
