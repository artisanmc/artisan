import { useKitStore } from "@/state/kitStore";
import { useProjectDraftStore } from "@/state/projectDraftStore";
import { act, fireEvent, render, screen, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { LibraryPalette } from "./LibraryPalette";

const writeDraftFile = vi.fn();
vi.mock("./draftFile", () => ({
  writeDraftFile: (...args: unknown[]) => writeDraftFile(...args),
}));
vi.mock("@/lib/pack/kitUrls", () => ({
  kitImageUrl: (id: string) => `/kit/${id}.png`,
  kitImageBytes: async () => new Uint8Array([1, 2, 3]),
}));

const row = (name: string) =>
  screen.getByLabelText(`Couleur de ${name}`).closest("li") as HTMLElement;

describe("the server's palette in the library", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    writeDraftFile.mockReset().mockResolvedValue(undefined);
    useProjectDraftStore.setState({ drafts: {} });
    useKitStore.setState({
      read: {
        projectId: "srv.artisan",
        files: { "palette.yml": 'warning: "#aa5500"\n' },
        binaries: [],
      },
      themes: [],
      own: {},
    });
  });
  afterEach(() => vi.useRealTimers());

  it("stays folded, then shows the library's colours over the default ones", () => {
    render(<LibraryPalette projectId="srv.artisan" />);
    expect(screen.queryByTestId("kit-theme-palette")).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: /Les couleurs du serveur/ }));
    expect(within(row("warning")).getByText("#aa5500")).toBeInTheDocument();
    expect(within(row("primary")).getByText("#3b82f6")).toBeInTheDocument();
    expect(within(row("warning")).getByRole("button")).toBeEnabled();
    expect(within(row("primary")).getByRole("button")).toBeDisabled();
    expect(screen.getByText(/dans tous les modules/)).toBeInTheDocument();
  });

  it("writes a picked colour to the library's draft", async () => {
    render(<LibraryPalette projectId="srv.artisan" />);
    fireEvent.click(screen.getByRole("button", { name: /Les couleurs du serveur/ }));
    fireEvent.change(screen.getByLabelText("Couleur de primary"), { target: { value: "#123456" } });
    await act(async () => {
      await vi.advanceTimersByTimeAsync(500);
    });
    expect(writeDraftFile).toHaveBeenCalledWith(
      "srv.artisan",
      "palette.yml",
      'warning: "#aa5500"\nprimary: "#123456"\n',
    );
  });
});
