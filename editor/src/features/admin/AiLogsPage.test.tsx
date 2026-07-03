import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { UsageLogDto } from "@/lib/api/adminAiUsage";
import { AiLogsPage } from "./AiLogsPage";

const getUsageLogsMock = vi.fn();
const usageLogsCsvUrlMock = vi.fn(() => "http://backend/csv-url");

vi.mock("@/lib/api/adminAiUsage", () => ({
  getUsageLogs: (...args: unknown[]) => getUsageLogsMock(...args),
  usageLogsCsvUrl: (...args: unknown[]) => usageLogsCsvUrlMock(...args),
}));

afterEach(() => vi.clearAllMocks());

function makeLog(overrides: Partial<UsageLogDto> = {}): UsageLogDto {
  return {
    id: "log-1",
    createdAt: "2026-07-01T12:00:00.000Z",
    networkId: "net-1",
    userId: "user-1",
    serverKeyId: null,
    modelId: "m1",
    modelName: "Sonnet 5",
    provider: "anthropic",
    providerModelId: "claude-sonnet-5",
    actionType: "chat",
    status: "success",
    inputTokens: 100,
    outputTokens: 50,
    cachedInputTokens: 0,
    creditsCharged: 20,
    realCostMicroUsd: 500,
    durationMs: 1200,
    errorMessage: null,
    promptPreview: "Hello there prompt preview",
    ...overrides,
  };
}

describe("AiLogsPage", () => {
  it("renders logs from the initial fetch", async () => {
    getUsageLogsMock.mockResolvedValue({ logs: [makeLog()], nextCursor: null });
    render(<AiLogsPage />);
    expect(await screen.findByText("Sonnet 5")).toBeInTheDocument();
  });

  it("re-fetches with the selected status and resets the cursor when Apply is clicked", async () => {
    getUsageLogsMock
      .mockResolvedValueOnce({ logs: [makeLog()], nextCursor: "cursor-1" })
      .mockResolvedValueOnce({
        logs: [makeLog({ id: "log-2", modelName: "Cheap" })],
        nextCursor: null,
      });
    render(<AiLogsPage />);
    await waitFor(() => expect(getUsageLogsMock).toHaveBeenCalledTimes(1));

    const statusSelect = screen.getByLabelText(/^Statut$/i) as HTMLSelectElement;
    fireEvent.change(statusSelect, { target: { value: "error" } });
    fireEvent.click(screen.getByRole("button", { name: /^Appliquer$/i }));

    await waitFor(() => expect(getUsageLogsMock).toHaveBeenCalledTimes(2));
    const [filtersArg, cursorArg] = getUsageLogsMock.mock.calls[1] as [Record<string, unknown>, unknown];
    expect(filtersArg).toEqual(expect.objectContaining({ status: "error" }));
    expect(cursorArg).toBeUndefined();
  });

  it("appends logs on Load more using nextCursor, keeping previous rows", async () => {
    getUsageLogsMock
      .mockResolvedValueOnce({
        logs: [makeLog({ id: "log-1", modelName: "Sonnet 5" })],
        nextCursor: "cursor-1",
      })
      .mockResolvedValueOnce({
        logs: [makeLog({ id: "log-2", modelName: "Cheap" })],
        nextCursor: null,
      });
    render(<AiLogsPage />);
    expect(await screen.findByText("Sonnet 5")).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: /^Charger plus$/i }));

    expect(await screen.findByText("Cheap")).toBeInTheDocument();
    expect(screen.getByText("Sonnet 5")).toBeInTheDocument();
    const [, cursorArg] = getUsageLogsMock.mock.calls[1] as [Record<string, unknown>, unknown];
    expect(cursorArg).toBe("cursor-1");
  });

  it("opens the export CSV URL in a new tab", async () => {
    getUsageLogsMock.mockResolvedValue({ logs: [makeLog()], nextCursor: null });
    const openSpy = vi.spyOn(window, "open").mockImplementation(() => null);
    render(<AiLogsPage />);
    await screen.findByText("Sonnet 5");

    fireEvent.click(screen.getByRole("button", { name: /^Exporter$/i }));

    expect(usageLogsCsvUrlMock).toHaveBeenCalled();
    expect(openSpy).toHaveBeenCalledWith("http://backend/csv-url", "_blank");
    openSpy.mockRestore();
  });

  it("shows the prompt preview when a row is clicked", async () => {
    getUsageLogsMock.mockResolvedValue({
      logs: [makeLog({ promptPreview: "Unique preview text 42" })],
      nextCursor: null,
    });
    render(<AiLogsPage />);
    const row = await screen.findByText("Sonnet 5");
    fireEvent.click(row.closest("tr")!);

    expect(await screen.findByText("Unique preview text 42")).toBeInTheDocument();
  });
});
