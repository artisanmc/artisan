import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";
import { ModelSelector } from "./ModelSelector";

const norm = (s: string) => s.replace(/\s/gu, " ");

const MODELS = [
  {
    id: "m1",
    displayName: "Haiku",
    description: "Fast and cheap",
    badge: "cheap" as const,
    creditsPerMInput: 1,
    creditsPerMOutput: 2,
    estimates: { chatMessage: 3, menuMigration: 40 },
  },
  {
    id: "m2",
    displayName: "Sonnet",
    description: "Balanced",
    badge: "balanced" as const,
    creditsPerMInput: 5,
    creditsPerMOutput: 10,
    estimates: { chatMessage: 12, menuMigration: 200 },
  },
];

vi.mock("@/lib/api/aiUser", () => ({
  getModels: vi.fn(async () => ({ models: MODELS, defaultModelId: "m1", preferredModelId: "m2" })),
  setPreferredModel: vi.fn(async () => true),
}));

afterEach(() => vi.clearAllMocks());

describe("ModelSelector", () => {
  it("lists the active models with their badge and estimates", async () => {
    render(<ModelSelector token="tok" value="m2" onChange={vi.fn()} />);

    await userEvent.click(screen.getByRole("button"));

    await waitFor(() => expect(screen.getByText("Haiku")).toBeTruthy());
    expect(screen.getAllByText("Sonnet").length).toBeGreaterThan(0);
    expect(screen.getAllByText(norm("~3 cr / message")).length).toBeGreaterThan(0);
    expect(screen.getAllByText(norm("~200 cr / migration de menu")).length).toBeGreaterThan(0);
  });

  it("preselects the preferred model over the default", async () => {
    const onModelsLoaded = vi.fn();
    render(
      <ModelSelector token="tok" value={null} onChange={vi.fn()} onModelsLoaded={onModelsLoaded} />,
    );

    await waitFor(() =>
      expect(onModelsLoaded).toHaveBeenCalledWith(
        expect.objectContaining({ defaultModelId: "m1", preferredModelId: "m2" }),
      ),
    );
  });

  it("clicking a model calls onChange and persists the preference", async () => {
    const onChange = vi.fn();
    render(<ModelSelector token="tok" value="m1" onChange={onChange} />);

    await userEvent.click(screen.getByRole("button"));
    await waitFor(() => expect(screen.getByText("Sonnet")).toBeTruthy());
    await userEvent.click(screen.getByText("Sonnet"));

    const { setPreferredModel } = await import("@/lib/api/aiUser");
    expect(onChange).toHaveBeenCalledWith("m2");
    await waitFor(() => expect(setPreferredModel).toHaveBeenCalledWith("tok", "m2"));
  });

  it("degrades to an empty list when the network call rejects", async () => {
    const { getModels } = await import("@/lib/api/aiUser");
    vi.mocked(getModels).mockRejectedValueOnce(new Error("network down"));

    expect(() =>
      render(<ModelSelector token="tok" value={null} onChange={vi.fn()} />),
    ).not.toThrow();
    await userEvent.click(screen.getByRole("button"));
    expect(screen.queryByText("Haiku")).toBeNull();
  });
});
