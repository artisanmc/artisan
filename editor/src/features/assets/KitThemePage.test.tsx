import { useKitStore } from "@/state/kitStore";
import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { KitThemePage } from "./KitThemePage";

vi.mock("@/lib/pack/kitUrls", () => ({
  kitImageUrl: (id: string) => `/kit/${id}.png`,
  kitImageBytes: async () => new Uint8Array([1, 2, 3]),
}));

describe("KitThemePage", () => {
  beforeEach(() => {
    useKitStore.setState({
      read: {
        projectId: "kit",
        files: { "themes/noel/theme.yml": 'colors: {"#3c8527": "#b3261e"}\n' },
        binaries: [{ path: "themes/noel/assets/textures/close.1x1.png", hash: "h" }],
      },
      themes: [],
      own: {},
    });
  });

  it("shows what the theme changes and puts it in place", async () => {
    const onPutInPlace = vi.fn().mockResolvedValue(undefined);
    render(<KitThemePage name="noel" onPutInPlace={onPutInPlace} />);
    // The table of colours it once held is shown nowhere: a theme changes an image by holding one.
    expect(screen.queryByTestId("kit-theme-colors")).toBeNull();
    expect(screen.queryByTestId("kit-theme-ramps")).toBeNull();
    expect(
      within(screen.getByTestId("kit-theme-drawings")).getByText("close.1x1"),
    ).toBeInTheDocument();
    expect(screen.getByText("Désactivé")).toBeInTheDocument();
    expect(screen.getByTestId("kit-theme-before")).toBeInTheDocument();
    expect(screen.getByTestId("kit-theme-after")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Activer le thème" }));
    await waitFor(() => expect(onPutInPlace).toHaveBeenCalledWith("noel", true));
  });

  it("takes off the theme in place, and says so of a theme the kit does not hold", async () => {
    useKitStore.setState({ themes: ["noel"] });
    const onPutInPlace = vi.fn().mockResolvedValue(undefined);
    const { unmount } = render(<KitThemePage name="noel" onPutInPlace={onPutInPlace} />);
    expect(screen.getByText("Actif")).toBeInTheDocument();
    // Alone in place: there is no order to tell.
    expect(screen.queryByTestId("kit-theme-stack")).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "Désactiver le thème" }));
    await waitFor(() => expect(onPutInPlace).toHaveBeenCalledWith("noel", false));
    unmount();
    render(<KitThemePage name="paques" onPutInPlace={onPutInPlace} />);
    expect(screen.getByText(/n'a pas de thème « paques »/)).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Activer le thème" })).toBeNull();
  });

  it("shows a theme of its own folder from the Project of its name", () => {
    useKitStore.setState({
      own: {
        printemps: {
          projectId: "srv.printemps",
          files: { "overrides/colors.yml": 'scope: guilds\ncolors: {"#3c8527": "#ffb7c5"}\n' },
          binaries: [
            { path: "overrides/artisan/close.1x1.png", hash: "h" },
            { path: "overrides/guilds/banner.png", hash: "h" },
          ],
        },
      },
    });
    const onOpenKit = vi.fn();
    render(<KitThemePage name="printemps" onOpenKit={onOpenKit} />);
    expect(
      within(screen.getByTestId("kit-theme-drawings")).getByText("close.1x1"),
    ).toBeInTheDocument();
    // Its table of colours is no longer read, and said so; its image of a module's is read.
    const unread = within(screen.getByTestId("kit-theme-unread"));
    expect(unread.getAllByRole("listitem").map((li) => li.textContent)).toEqual([
      "overrides/colors.yml",
    ]);
    // Its files are its own folder's, not the common images'.
    expect(
      screen.getByText(/themes\/printemps\/ : assets\/ contient ses images/),
    ).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Ouvrir les images du serveur" })).toBeNull();
  });

  it("tells the order of the themes in place when there are several", () => {
    useKitStore.setState({ themes: ["hiver", "noel"] });
    render(<KitThemePage name="noel" />);
    expect(screen.getByTestId("kit-theme-stack")).toHaveTextContent("hiver, noel");
  });
  it("lists the own images of a theme of its own folder, each as a menu names it", () => {
    useKitStore.setState({
      own: {
        printemps: {
          projectId: "srv.printemps",
          files: { "assets/textures/bouquet.yml": "compose:\n  layers:\n    - image: tulipe\n" },
          binaries: [
            { path: "assets/textures/tulipe.png", hash: "h1" },
            { path: "assets/glyphs/abeille.png", hash: "h2" },
            { path: "overrides/artisan/panel.png", hash: "h3" },
          ],
        },
        ete: { projectId: "srv.ete", files: {}, binaries: [] },
      },
    });
    const first = render(<KitThemePage name="printemps" />);
    const list = within(screen.getByTestId("kit-theme-own-images"));
    expect(list.getAllByRole("listitem").map((li) => li.textContent)).toEqual([
      "printemps:abeille",
      "printemps:tulipe",
    ]);
    first.unmount();
    // A theme with none says how one is named.
    const second = render(<KitThemePage name="ete" />);
    expect(screen.queryByTestId("kit-theme-own-images")).toBeNull();
    expect(screen.getByText(/ete:<son nom>/)).toBeInTheDocument();
    second.unmount();
    // A theme the common images keep has no folder of its own: nothing is said.
    render(<KitThemePage name="noel" />);
    expect(screen.queryByText("Ses propres images")).toBeNull();
  });

  it("says nothing of unread files for a theme that holds none", () => {
    useKitStore.setState({
      own: {
        printemps: {
          projectId: "srv.printemps",
          files: {},
          binaries: [{ path: "overrides/artisan/close.1x1.png", hash: "h" }],
        },
      },
    });
    const onOpenTheme = vi.fn();
    render(<KitThemePage name="printemps" onOpenTheme={onOpenTheme} />);
    expect(screen.queryByTestId("kit-theme-unread")).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "Ouvrir le dossier du thème" }));
    expect(onOpenTheme).toHaveBeenCalled();
  });

  it("renames and deletes a theme of its own folder the server moves", async () => {
    const mine = { projectId: "srv.printemps", files: {}, binaries: [] };
    useKitStore.setState({ own: { printemps: { ...mine, canMove: true }, ete: mine } });
    const onRename = vi.fn().mockResolvedValue(undefined);
    const onDelete = vi.fn().mockResolvedValue(undefined);
    const { rerender } = render(
      <KitThemePage name="printemps" onRename={onRename} onDelete={onDelete} />,
    );
    fireEvent.click(screen.getByRole("button", { name: "Renommer" }));
    const dialog = screen.getByRole("dialog");
    const field = within(dialog).getByLabelText("Nom du thème");
    expect(field).toHaveValue("printemps");
    // Its own name, a name another theme has, a name that is no theme's: nothing is sent.
    expect(within(dialog).getByRole("button", { name: "Renommer" })).toBeDisabled();
    fireEvent.change(field, { target: { value: "ete" } });
    expect(within(dialog).getByRole("alert")).toHaveTextContent("porte déjà ce nom");
    fireEvent.change(field, { target: { value: "Été" } });
    expect(within(dialog).getByRole("alert")).toHaveTextContent("Minuscules, chiffres");
    expect(within(dialog).getByRole("button", { name: "Renommer" })).toBeDisabled();
    fireEvent.change(field, { target: { value: "avril" } });
    fireEvent.click(within(dialog).getByRole("button", { name: "Renommer" }));
    await waitFor(() => expect(onRename).toHaveBeenCalledWith("printemps", "avril"));
    await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());

    fireEvent.click(screen.getByRole("button", { name: "Supprimer" }));
    expect(screen.getByRole("dialog")).toHaveTextContent("themes/.artisan-trash/");
    expect(screen.getByRole("dialog")).not.toHaveTextContent("Ce thème est actif");
    fireEvent.click(within(screen.getByRole("dialog")).getByRole("button", { name: "Supprimer" }));
    await waitFor(() => expect(onDelete).toHaveBeenCalledWith("printemps"));

    // A theme the server does not move (an older server), or one the common images keep: neither is offered.
    rerender(<KitThemePage name="ete" onRename={onRename} onDelete={onDelete} />);
    expect(screen.queryByTestId("theme-moves")).toBeNull();
    rerender(<KitThemePage name="noel" onRename={onRename} onDelete={onDelete} />);
    expect(screen.queryByTestId("theme-moves")).toBeNull();
  });

  it("says a theme in place is taken off when deleted, and shows the server's refusal", async () => {
    useKitStore.setState({
      own: { printemps: { projectId: "srv.printemps", files: {}, binaries: [], canMove: true } },
      themes: ["printemps"],
    });
    const onDelete = vi.fn().mockRejectedValue(new Error("server_offline"));
    render(<KitThemePage name="printemps" onDelete={onDelete} />);
    // Without a way to rename, renaming is not offered.
    expect(screen.queryByRole("button", { name: "Renommer" })).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "Supprimer" }));
    const dialog = screen.getByRole("dialog");
    expect(dialog).toHaveTextContent("Ce thème est actif");
    fireEvent.click(within(dialog).getByRole("button", { name: "Supprimer" }));
    expect(await within(dialog).findByRole("alert")).toHaveTextContent("Le serveur est hors ligne");
    // The dialog stays open on a refusal.
    expect(screen.getByRole("dialog")).toBeInTheDocument();
  });

  it("exports a theme of its own folder, and says when the server could not be read", async () => {
    useKitStore.setState({
      own: { printemps: { projectId: "srv.printemps", files: {}, binaries: [] } },
    });
    const onExport = vi
      .fn()
      .mockResolvedValueOnce(undefined)
      .mockRejectedValue(new Error("server_offline"));
    const { rerender } = render(<KitThemePage name="printemps" onExport={onExport} />);
    fireEvent.click(screen.getByRole("button", { name: "Exporter" }));
    await waitFor(() => expect(onExport).toHaveBeenCalledWith("printemps"));
    await waitFor(() => expect(screen.getByRole("button", { name: "Exporter" })).toBeEnabled());
    expect(screen.queryByRole("alert")).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "Exporter" }));
    expect(await screen.findByRole("alert")).toHaveTextContent(
      "Le serveur est hors ligne : le thème ne peut pas être exporté.",
    );
    // A theme the common images still keep has no archive of its own.
    rerender(<KitThemePage name="noel" onExport={onExport} />);
    expect(screen.queryByRole("button", { name: "Exporter" })).toBeNull();
  });
});
