import { type KitRead, useKitStore } from "@/state/kitStore";
import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { ThemesPage } from "./ThemesPage";

const theme = (projectId: string, colors: string, binaries: string[] = []): KitRead => ({
  projectId,
  files: colors ? { "overrides/colors.yml": colors } : {},
  binaries: binaries.map((path) => ({ path, hash: "h" })),
});

describe("ThemesPage", () => {
  beforeEach(() => {
    useKitStore.setState({
      read: { projectId: "srv.artisan", files: {}, binaries: [], byName: true },
      own: {
        noel: theme("srv.noel", 'colors: {"#3c8527": "#b3261e", "#1e5214": "#6f120d"}\n', [
          "overrides/artisan/close.1x1.png",
        ]),
        // A table of colours alone, which is no longer read: the theme changes nothing.
        nuit: theme("srv.nuit", 'scope: guilds\ncolors: {"#c6c6c6": "#2a3350"}\n'),
        vide: theme("srv.vide", ""),
      },
      themes: ["noel", "nuit"],
      stacks: true,
    });
  });

  it("lists the stack in place, the highest first, over Artisan's images", () => {
    render(<ThemesPage onTheme={() => {}} onOrder={async () => {}} />);
    const inPlace = within(screen.getByTestId("themes-in-place"));
    const names = inPlace
      .getAllByRole("button", { name: /^(noel|nuit)$/ })
      .map((b) => b.textContent);
    expect(names).toEqual(["nuit", "noel"]);
    // What each changes, in a few words.
    expect(inPlace.getByText("ne change rien pour l'instant")).toBeInTheDocument();
    expect(inPlace.getByText("1 image redessinée")).toBeInTheDocument();
    expect(screen.getByTestId("themes-base")).toHaveTextContent("Toujours sous tous les thèmes");
    // The ones that are not in place are apart.
    const installed = within(screen.getByTestId("themes-installed"));
    expect(installed.getByRole("button", { name: "vide" })).toBeInTheDocument();
    expect(installed.getByText("ne change rien pour l'instant")).toBeInTheDocument();
  });

  it("puts a theme in place, takes one off and opens one", async () => {
    const onPutInPlace = vi.fn().mockResolvedValue(undefined);
    const onTheme = vi.fn();
    render(<ThemesPage onTheme={onTheme} onPutInPlace={onPutInPlace} />);
    fireEvent.click(screen.getByRole("button", { name: "Mettre en place" }));
    await waitFor(() => expect(onPutInPlace).toHaveBeenCalledWith("vide", true));
    const inPlace = within(screen.getByTestId("themes-in-place"));
    await waitFor(() =>
      expect(inPlace.getAllByRole("button", { name: "Retirer" })[0]).not.toBeDisabled(),
    );
    fireEvent.click(inPlace.getAllByRole("button", { name: "Retirer" })[0] as HTMLElement);
    await waitFor(() => expect(onPutInPlace).toHaveBeenCalledWith("nuit", false));
    fireEvent.click(inPlace.getByRole("button", { name: "noel" }));
    expect(onTheme).toHaveBeenCalledWith("noel");
  });

  it("moves a theme in the stack with the keyboard, and writes the server's order", async () => {
    const onOrder = vi.fn().mockResolvedValue(undefined);
    render(<ThemesPage onTheme={() => {}} onOrder={onOrder} />);
    // jsdom lays nothing out: give each row a box, one under the other.
    const rows = within(screen.getByTestId("themes-in-place")).getAllByRole("listitem");
    rows.forEach((li, at) => {
      li.getBoundingClientRect = () =>
        ({
          x: 0,
          y: at * 40,
          top: at * 40,
          left: 0,
          width: 200,
          height: 40,
          right: 200,
          bottom: at * 40 + 40,
          toJSON: () => ({}),
        }) as DOMRect;
    });
    const handles = screen.getAllByRole("button", {
      name: "Faire glisser pour changer la place du thème",
    });
    expect(handles).toHaveLength(2);
    // `nuit`, the highest, is dropped under `noel`: `noel` is now the highest.
    const handle = handles[0] as HTMLElement;
    handle.focus();
    fireEvent.keyDown(handle, { code: "Space" });
    await new Promise((r) => setTimeout(r, 0));
    fireEvent.keyDown(document, { code: "ArrowDown" });
    await new Promise((r) => setTimeout(r, 0));
    fireEvent.keyDown(document, { code: "Space" });
    await waitFor(() => expect(onOrder).toHaveBeenCalledWith(["nuit", "noel"]));
  });

  it("says so of a theme in place the server does not hold, and of a failure", async () => {
    useKitStore.setState({ themes: ["paques"], stacks: false });
    const onPutInPlace = vi.fn().mockRejectedValue(new Error("server_offline"));
    render(<ThemesPage onTheme={() => {}} onOrder={async () => {}} onPutInPlace={onPutInPlace} />);
    const inPlace = within(screen.getByTestId("themes-in-place"));
    expect(inPlace.getByText("Introuvable")).toBeInTheDocument();
    // One theme, or a server older than the list: nothing to reorder.
    expect(
      screen.queryByRole("button", { name: "Faire glisser pour changer la place du thème" }),
    ).toBeNull();
    fireEvent.click(inPlace.getByRole("button", { name: "Retirer" }));
    expect(await screen.findByRole("alert")).toHaveTextContent("server_offline");
  });

  it("says the server has no theme, and offers to create one", () => {
    useKitStore.setState({ own: {}, themes: [] });
    render(<ThemesPage onTheme={() => {}} newTheme={(names) => <span>new:{names.length}</span>} />);
    expect(screen.getByText(/Aucun thème en place/)).toBeInTheDocument();
    expect(screen.getByText("Le serveur n'a pas encore de thème.")).toBeInTheDocument();
    expect(screen.getByText("new:0")).toBeInTheDocument();
  });
});
