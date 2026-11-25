import { useKitStore } from "@/state/kitStore";
import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { KitPage } from "./KitPage";

vi.mock("@/lib/pack/kitUrls", () => ({
  kitImageUrl: (id: string) => `/kit/${id}.png`,
  kitImageBytes: async () => new Uint8Array([1, 2, 3]),
}));

const published = (binaries: string[], files: Record<string, string> = {}) =>
  useKitStore.setState({
    read: { projectId: "kit", files, binaries: binaries.map((path) => ({ path, hash: "h" })) },
  });

describe("KitPage", () => {
  beforeEach(() => {
    useKitStore.setState({ read: undefined, theme: undefined });
  });

  it("shows every piece as Artisan's and offers to create the kit module", async () => {
    const onCreateKit = vi.fn().mockResolvedValue(undefined);
    render(<KitPage menusNaming={0} onCreateKit={onCreateKit} />);
    const slot = screen.getByTestId("kit-slot-button.3x1");
    expect(within(slot).getByText("54 × 18 px")).toBeInTheDocument();
    expect(within(slot).getByText("Artisan")).toBeInTheDocument();
    // No kit module: a piece is looked at, nothing opens.
    expect(slot.tagName).toBe("DIV");
    expect(screen.getByTestId("kit-trial-close.1x1").tagName).toBe("SPAN");
    expect(screen.getByText("0 pièce redessinée sur 19")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Créer le module du kit" }));
    await waitFor(() => expect(onCreateKit).toHaveBeenCalled());
  });

  it("tells a redrawn piece, and opens a piece from its card or from the trial menu", () => {
    published(["assets/glyphs/button.3x1.png", "assets/textures/blason.png"], {
      "assets/glyphs/button.3x1.yml": "width: 54\nheight: 18\n",
      "themes/noel/theme.yml": 'colors: {"#3c8527": "#b3261e"}\n',
    });
    useKitStore.setState({ theme: "noel" });
    const onPiece = vi.fn();
    const onOpenKit = vi.fn();
    const onTheme = vi.fn();
    render(<KitPage menusNaming={14} onPiece={onPiece} onOpenKit={onOpenKit} onTheme={onTheme} />);
    expect(
      within(screen.getByTestId("kit-slot-button.3x1")).getByText("Redessinée"),
    ).toBeInTheDocument();
    expect(screen.getByText("1 pièce redessinée sur 19")).toBeInTheDocument();
    expect(screen.getByText("14 menus nomment le kit")).toBeInTheDocument();
    fireEvent.click(screen.getByTestId("kit-slot-card.3x2"));
    expect(onPiece).toHaveBeenLastCalledWith("card.3x2");
    fireEvent.click(screen.getByTestId("kit-trial-close.1x1"));
    expect(onPiece).toHaveBeenLastCalledWith("close.1x1");
    // The server's own image leads to the kit module, its theme to the theme.
    fireEvent.click(screen.getByTestId("kit-other-kit:blason"));
    expect(onOpenKit).toHaveBeenCalled();
    fireEvent.click(screen.getByRole("button", { name: "noel (en place)" }));
    expect(onTheme).toHaveBeenCalledWith("noel");
  });
});
