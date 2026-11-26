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
    render(<KitThemePage name="noel" onBack={() => {}} onPutInPlace={onPutInPlace} />);
    const colors = screen.getByTestId("kit-theme-colors");
    expect(within(colors).getByText("#3c8527")).toBeInTheDocument();
    expect(within(colors).getByText("#b3261e")).toBeInTheDocument();
    expect(
      within(screen.getByTestId("kit-theme-drawings")).getByText("close.1x1"),
    ).toBeInTheDocument();
    // Without a scope its colours reach every image that follows them.
    expect(screen.getByTestId("kit-theme-scope")).toHaveTextContent(
      "Dans les images qui suivent les couleurs des thèmes",
    );
    expect(screen.getByText("Pas en place")).toBeInTheDocument();
    expect(screen.getByTestId("kit-theme-before")).toBeInTheDocument();
    expect(screen.getByTestId("kit-theme-after")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Mettre en place sur le serveur" }));
    await waitFor(() => expect(onPutInPlace).toHaveBeenCalledWith("noel", true));
  });

  it("takes off the theme in place, and says so of a theme the kit does not hold", async () => {
    useKitStore.setState({ themes: ["noel"] });
    const onPutInPlace = vi.fn().mockResolvedValue(undefined);
    const { unmount } = render(
      <KitThemePage name="noel" onBack={() => {}} onPutInPlace={onPutInPlace} />,
    );
    expect(screen.getByText("En place")).toBeInTheDocument();
    // Alone in place: there is no order to tell.
    expect(screen.queryByTestId("kit-theme-stack")).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "Retirer du serveur" }));
    await waitFor(() => expect(onPutInPlace).toHaveBeenCalledWith("noel", false));
    unmount();
    render(<KitThemePage name="paques" onBack={() => {}} onPutInPlace={onPutInPlace} />);
    expect(screen.getByText(/n'a pas de thème « paques »/)).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Mettre en place sur le serveur" })).toBeNull();
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
    render(<KitThemePage name="printemps" onBack={() => {}} onOpenKit={onOpenKit} />);
    expect(within(screen.getByTestId("kit-theme-colors")).getByText("#ffb7c5")).toBeInTheDocument();
    // A theme of one module says which.
    expect(screen.getByTestId("kit-theme-scope")).toHaveTextContent(
      "Dans les images du module guilds seulement",
    );
    expect(
      within(screen.getByTestId("kit-theme-drawings")).getByText("close.1x1"),
    ).toBeInTheDocument();
    // A module's image it redraws is named with its module.
    expect(
      within(screen.getByTestId("kit-theme-module-drawings")).getByText("guilds:banner"),
    ).toBeInTheDocument();
    // Its files are its own folder's, not the common images'.
    expect(screen.getByText(/themes\/printemps\/ : overrides\/colors.yml/)).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Ouvrir les images du serveur" })).toBeNull();
  });

  it("tells the order of the themes in place when there are several", () => {
    useKitStore.setState({ themes: ["hiver", "noel"] });
    render(<KitThemePage name="noel" onBack={() => {}} />);
    expect(screen.getByTestId("kit-theme-stack")).toHaveTextContent("hiver, noel");
  });
  it("picks one colour per ramp for a theme of its own folder, and writes the table", async () => {
    useKitStore.setState({
      own: {
        printemps: {
          projectId: "srv.printemps",
          files: { "overrides/colors.yml": 'colors: {"#a02824": "#102030"}\n' },
          binaries: [],
        },
      },
    });
    const onColors = vi.fn().mockResolvedValue(undefined);
    const onOpenTheme = vi.fn();
    render(
      <KitThemePage
        name="printemps"
        onBack={() => {}}
        onColors={onColors}
        onOpenTheme={onOpenTheme}
      />,
    );
    const ramps = within(screen.getByTestId("kit-theme-ramps"));
    // Each ramp shows what its main colour becomes in the theme.
    const main = ramps.getByLabelText("Couleur de : Principale (boutons)") as HTMLInputElement;
    expect(main.value).toBe("#3c8527");
    const danger = ramps.getByLabelText("Couleur de : Danger (supprimer, fermer)");
    expect((danger as HTMLInputElement).value).toBe("#102030");
    expect(screen.queryByRole("button", { name: "Enregistrer les couleurs" })).toBeNull();
    fireEvent.change(main, { target: { value: "#b3261e" } });
    // The shades follow, shown before anything is written.
    expect(within(screen.getByTestId("kit-theme-colors")).getByText("#3c8527")).toBeInTheDocument();
    expect(screen.getByTestId("kit-theme-after")).toHaveTextContent("pas encore enregistré");
    fireEvent.click(screen.getByRole("button", { name: "Enregistrer les couleurs" }));
    await waitFor(() => expect(onColors).toHaveBeenCalledTimes(1));
    const [name, table] = onColors.mock.calls[0] as [string, Map<number, number>];
    expect(name).toBe("printemps");
    expect(table.get(0x3c8527)).toBe(0xb3261e);
    expect(table.get(0xa02824)).toBe(0x102030);
    expect(table.size).toBeGreaterThan(2);
    // Cancelled, the theme's own table is back.
    fireEvent.click(screen.getByRole("button", { name: "Annuler" }));
    expect(main.value).toBe("#3c8527");
    expect(screen.queryByRole("button", { name: "Enregistrer les couleurs" })).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "Ouvrir le dossier du thème" }));
    expect(onOpenTheme).toHaveBeenCalled();
  });

  it("says a write was refused, and offers no picker for a theme the common images keep", async () => {
    useKitStore.setState({
      own: { printemps: { projectId: "srv.printemps", files: {}, binaries: [] } },
    });
    const onColors = vi.fn().mockRejectedValue(new Error("conflict"));
    const { unmount } = render(
      <KitThemePage name="printemps" onBack={() => {}} onColors={onColors} />,
    );
    fireEvent.change(screen.getByLabelText("Couleur de : Neutre (fenêtres, cadres)"), {
      target: { value: "#4a5a8c" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Enregistrer les couleurs" }));
    expect(await screen.findByRole("alert")).toHaveTextContent("a changé sur le serveur");
    unmount();
    render(<KitThemePage name="noel" onBack={() => {}} onColors={onColors} />);
    expect(screen.queryByTestId("kit-theme-ramps")).toBeNull();
  });

  it("renames and deletes a theme of its own folder the server moves", async () => {
    const mine = { projectId: "srv.printemps", files: {}, binaries: [] };
    useKitStore.setState({ own: { printemps: { ...mine, canMove: true }, ete: mine } });
    const onRename = vi.fn().mockResolvedValue(undefined);
    const onDelete = vi.fn().mockResolvedValue(undefined);
    const { rerender } = render(
      <KitThemePage name="printemps" onBack={() => {}} onRename={onRename} onDelete={onDelete} />,
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
    expect(screen.getByRole("dialog")).not.toHaveTextContent("Ce thème est en place");
    fireEvent.click(within(screen.getByRole("dialog")).getByRole("button", { name: "Supprimer" }));
    await waitFor(() => expect(onDelete).toHaveBeenCalledWith("printemps"));

    // A theme the server does not move (an older server), or one the common images keep: neither is offered.
    rerender(<KitThemePage name="ete" onBack={() => {}} onRename={onRename} onDelete={onDelete} />);
    expect(screen.queryByTestId("theme-moves")).toBeNull();
    rerender(
      <KitThemePage name="noel" onBack={() => {}} onRename={onRename} onDelete={onDelete} />,
    );
    expect(screen.queryByTestId("theme-moves")).toBeNull();
  });

  it("says a theme in place is taken off when deleted, and shows the server's refusal", async () => {
    useKitStore.setState({
      own: { printemps: { projectId: "srv.printemps", files: {}, binaries: [], canMove: true } },
      themes: ["printemps"],
    });
    const onDelete = vi.fn().mockRejectedValue(new Error("server_offline"));
    render(<KitThemePage name="printemps" onBack={() => {}} onDelete={onDelete} />);
    // Without a way to rename, renaming is not offered.
    expect(screen.queryByRole("button", { name: "Renommer" })).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "Supprimer" }));
    const dialog = screen.getByRole("dialog");
    expect(dialog).toHaveTextContent("Ce thème est en place");
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
    const { rerender } = render(
      <KitThemePage name="printemps" onBack={() => {}} onExport={onExport} />,
    );
    fireEvent.click(screen.getByRole("button", { name: "Exporter" }));
    await waitFor(() => expect(onExport).toHaveBeenCalledWith("printemps"));
    await waitFor(() => expect(screen.getByRole("button", { name: "Exporter" })).toBeEnabled());
    expect(screen.queryByRole("alert")).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "Exporter" }));
    expect(await screen.findByRole("alert")).toHaveTextContent(
      "Le serveur est hors ligne : le thème ne peut pas être exporté.",
    );
    // A theme the common images still keep has no archive of its own.
    rerender(<KitThemePage name="noel" onBack={() => {}} onExport={onExport} />);
    expect(screen.queryByRole("button", { name: "Exporter" })).toBeNull();
  });
});
