import { useKitStore } from "@/state/kitStore";
import { fireEvent, render, screen, within } from "@testing-library/react";
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
    useKitStore.setState({ read: undefined, own: {}, themes: [], stacks: false });
  });

  it("shows every piece as Artisan's on a server that has no theme yet", () => {
    render(<KitPage menusNaming={0} />);
    const slot = screen.getByTestId("kit-slot-button.3x1");
    expect(within(slot).getByText("54 × 18 px")).toBeInTheDocument();
    expect(within(slot).getByText("Artisan")).toBeInTheDocument();
    // No theme on the server: a piece is looked at, nothing opens.
    expect(slot.tagName).toBe("DIV");
    expect(screen.getByTestId("kit-trial-close.1x1").tagName).toBe("SPAN");
    expect(screen.getByText("0 pièce redessinée sur 19")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /Ouvrir/ })).toBeNull();
  });

  it("tells a redrawn piece, and opens a piece from its card or from the trial menu", () => {
    published(
      [
        "assets/glyphs/button.3x1.png",
        "assets/textures/blason.png",
        "assets/textures/back.1x1.png",
      ],
      {
        "assets/glyphs/button.3x1.yml": "width: 54\nheight: 18\n",
        // Not the piece's size: the image is not taken, and the card says so.
        "assets/textures/back.1x1.yml": "width: 20\nheight: 16\n",
        "themes/noel/theme.yml": 'colors: {"#3c8527": "#b3261e"}\n',
      },
    );
    useKitStore.setState({ themes: ["noel"] });
    const onPiece = vi.fn();
    const onOpenKit = vi.fn();
    const onTheme = vi.fn();
    render(
      <KitPage
        menusNaming={14}
        usesOf={(name) => (name === "button.3x1" ? 3 : name === "blason" ? 1 : 0)}
        onPiece={onPiece}
        onOpenKit={onOpenKit}
        onTheme={onTheme}
      />,
    );
    const misfit = within(screen.getByTestId("kit-slot-back.1x1"));
    expect(misfit.getByText("Non prise")).toBeInTheDocument();
    expect(misfit.getByRole("alert")).toHaveTextContent(
      "Cette image fait 20 × 16 px, la pièce 16 × 16 px",
    );
    // Each image says how many menus name it.
    expect(
      within(screen.getByTestId("kit-slot-button.3x1")).getByText("3 menus la nomment"),
    ).toBeInTheDocument();
    expect(
      within(screen.getByTestId("kit-other-kit:blason")).getByText("1 menu la nomme"),
    ).toBeInTheDocument();
    expect(
      within(screen.getByTestId("kit-slot-card.3x2")).getByText("Aucun menu ne la nomme"),
    ).toBeInTheDocument();
    expect(
      within(screen.getByTestId("kit-slot-button.3x1")).getByText("Redessinée"),
    ).toBeInTheDocument();
    expect(screen.getByText("1 pièce redessinée sur 19")).toBeInTheDocument();
    expect(screen.getByText("14 menus nomment une image commune")).toBeInTheDocument();
    fireEvent.click(screen.getByTestId("kit-slot-card.3x2"));
    expect(onPiece).toHaveBeenLastCalledWith("card.3x2");
    fireEvent.click(screen.getByTestId("kit-trial-close.1x1"));
    expect(onPiece).toHaveBeenLastCalledWith("close.1x1");
    // The server's own image leads to the kit module, its theme to the theme.
    fireEvent.click(screen.getByTestId("kit-other-kit:blason"));
    expect(onOpenKit).toHaveBeenCalled();
    fireEvent.click(screen.getByRole("button", { name: "noel (en place)" }));
    expect(onTheme).toHaveBeenCalledWith("noel");
    expect(screen.queryByTestId("kit-themes-order")).toBeNull();
  });

  it("lists the themes in place first, in their order, then the others", () => {
    published([], {
      "themes/automne/theme.yml": "colors: {}\n",
      "themes/hiver/theme.yml": "colors: {}\n",
      "themes/noel/theme.yml": "colors: {}\n",
    });
    // `gone` is in place on the server and no longer among its themes: it shows nothing.
    // `printemps` is a theme of its own folder, a Project of its name.
    useKitStore.setState({
      themes: ["noel", "gone", "automne"],
      own: { printemps: { projectId: "srv.printemps", files: {}, binaries: [] } },
    });
    render(<KitPage menusNaming={0} onTheme={() => {}} />);
    const themes = within(screen.getByTestId("kit-themes"));
    expect(themes.getAllByRole("button").map((button) => button.textContent)).toEqual([
      "1. noel (en place)",
      "2. automne (en place)",
      "hiver",
      "printemps",
    ]);
    expect(screen.getByTestId("kit-themes-order")).toBeInTheDocument();
  });
});
