import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { formatCredits, formatUsdFromMicro } from "@/lib/format";
import { AiUsagePage } from "./AiUsagePage";

const summaryMock = vi.fn();
vi.mock("@/lib/api/adminAiUsage", () => ({
  getUsageSummary: (from?: string, to?: string) => summaryMock(from, to),
}));

afterEach(() => vi.clearAllMocks());

// Intl.NumberFormat("fr") uses a narrow no-break space (U+202F) as the thousands/currency
// separator; testing-library's default whitespace normalizer collapses that to a regular
// space when matching DOM text, so normalize our expected strings the same way before
// asserting equality (querying by exact string skips that normalization).
const norm = (s: string) => s.replace(/\s/gu, " ");

describe("AiUsagePage", () => {
  const zero = {
    inputTokens: 0,
    outputTokens: 0,
    cachedInputTokens: 0,
    creditsCharged: 0,
    realCostMicroUsd: 0,
    marginMicroUsd: 0,
    turns: 0,
    errors: 0,
  };

  it("shows formatted totals in stat cards", async () => {
    summaryMock.mockResolvedValue({
      totals: {
        ...zero,
        inputTokens: 12000,
        outputTokens: 3000,
        creditsCharged: 500,
        realCostMicroUsd: 2_500_000,
        marginMicroUsd: 1_000_000,
        turns: 42,
        errors: 1,
      },
      byModel: [],
      byProvider: [],
      daily: [],
    });
    render(<AiUsagePage />);
    expect(await screen.findByText(norm(formatCredits(12000, "fr")))).toBeInTheDocument();
    expect(screen.getByText(norm(formatCredits(3000, "fr")))).toBeInTheDocument();
    expect(screen.getByText(norm(formatCredits(500, "fr")))).toBeInTheDocument();
    expect(screen.getByText(norm(formatUsdFromMicro(2_500_000, "fr")))).toBeInTheDocument();
    expect(screen.getByText(norm(formatCredits(42, "fr")))).toBeInTheDocument();
    expect(screen.getByText(norm(formatCredits(1, "fr")))).toBeInTheDocument();
  });

  it("gives the margin stat card a danger tone when margin is negative", async () => {
    summaryMock.mockResolvedValue({
      totals: { ...zero, marginMicroUsd: -500_000, creditsCharged: 100 },
      byModel: [],
      byProvider: [],
      daily: [],
    });
    render(<AiUsagePage />);
    const marginValue = await screen.findByText(norm(formatUsdFromMicro(-500_000, "fr")));
    expect(marginValue.className).toContain("--danger");
  });

  it("gives the margin stat card a positive tone when margin is positive", async () => {
    summaryMock.mockResolvedValue({
      totals: { ...zero, marginMicroUsd: 750_000, creditsCharged: 100 },
      byModel: [],
      byProvider: [],
      daily: [],
    });
    render(<AiUsagePage />);
    const marginValue = await screen.findByText(norm(formatUsdFromMicro(750_000, "fr")));
    expect(marginValue.className).toContain("--success");
  });

  it("renders bars for byModel and byProvider breakdowns", async () => {
    summaryMock.mockResolvedValue({
      totals: { ...zero, creditsCharged: 300, turns: 10 },
      byModel: [
        {
          modelId: "m1",
          modelName: "Sonnet 5",
          provider: "anthropic",
          inputTokens: 100,
          outputTokens: 50,
          creditsCharged: 200,
          realCostMicroUsd: 1000,
          turns: 6,
        },
        {
          modelId: "m2",
          modelName: "Cheap",
          provider: "anthropic",
          inputTokens: 20,
          outputTokens: 10,
          creditsCharged: 100,
          realCostMicroUsd: 200,
          turns: 4,
        },
      ],
      byProvider: [
        {
          provider: "anthropic",
          inputTokens: 120,
          outputTokens: 60,
          creditsCharged: 300,
          realCostMicroUsd: 1200,
          turns: 10,
        },
      ],
      daily: [
        {
          date: "2026-07-01",
          inputTokens: 120,
          outputTokens: 60,
          creditsCharged: 300,
          realCostMicroUsd: 1200,
          turns: 10,
        },
      ],
    });
    render(<AiUsagePage />);
    expect(await screen.findByText("Sonnet 5")).toBeInTheDocument();
    expect(screen.getByText("Cheap")).toBeInTheDocument();
    expect(screen.getByText("anthropic")).toBeInTheDocument();
    expect(screen.getByText("2026-07-01")).toBeInTheDocument();
  });

  it("shows the no-data state when everything is empty", async () => {
    summaryMock.mockResolvedValue({ totals: { ...zero }, byModel: [], byProvider: [], daily: [] });
    render(<AiUsagePage />);
    expect(await screen.findByText(/aucune donn.e/i)).toBeInTheDocument();
  });

  it("re-fetches with new from/to when the period selector changes", async () => {
    summaryMock.mockResolvedValue({ totals: { ...zero }, byModel: [], byProvider: [], daily: [] });
    render(<AiUsagePage />);
    await waitFor(() => expect(summaryMock).toHaveBeenCalledTimes(1));
    const [initialFrom] = summaryMock.mock.calls[0] as [string, string];

    fireEvent.click(screen.getByRole("button", { name: /7 derniers jours/i }));
    await waitFor(() => expect(summaryMock).toHaveBeenCalledTimes(2));
    const [sevenDayFrom] = summaryMock.mock.calls[1] as [string, string];
    expect(sevenDayFrom).not.toEqual(initialFrom);
  });

  it("re-fetches with custom from/to when the date inputs change", async () => {
    summaryMock.mockResolvedValue({ totals: { ...zero }, byModel: [], byProvider: [], daily: [] });
    render(<AiUsagePage />);
    await waitFor(() => expect(summaryMock).toHaveBeenCalledTimes(1));

    const fromInput = screen.getByLabelText(/^Du$/i) as HTMLInputElement;
    fireEvent.change(fromInput, { target: { value: "2026-01-01" } });
    await waitFor(() => expect(summaryMock).toHaveBeenCalledTimes(2));
    const [customFrom] = summaryMock.mock.calls[1] as [string, string];
    expect(customFrom.slice(0, 10)).toBe("2026-01-01");
  });
});
