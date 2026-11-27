import { useKitStore } from "@/state/kitStore";
import { useProjectDraftStore } from "@/state/projectDraftStore";
import { act, fireEvent, render, screen, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { KitThemePage } from "./KitThemePage";
import { paletteFile } from "./ThemePalette";

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

describe("paletteFile", () => {
  it("writes the colours as a palette.yml, and no file for none", () => {
    expect(paletteFile(new Map([["primary", "#112233"]]))).toBe('primary: "#112233"\n');
    expect(paletteFile(new Map())).toBeNull();
  });
});

describe("the palette on a theme's page", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    // Like the real one: the file lands in the player's draft of the Project.
    writeDraftFile.mockReset().mockImplementation(async (id: string, path: string, content) => {
      const tree = { ...(useProjectDraftStore.getState().drafts[id]?.tree ?? {}) };
      if (content === null) delete tree[path];
      else tree[path] = content;
      useProjectDraftStore.setState({ drafts: { [id]: { baseline: {}, tree, at: 1 } } } as never);
    });
    useProjectDraftStore.setState({ drafts: {} });
    useKitStore.setState({
      read: {
        projectId: "srv.artisan",
        files: { "palette.yml": 'warning: "#aa5500"\n' },
        binaries: [],
      },
      themes: [],
      own: {
        noel: {
          projectId: "srv.noel",
          files: { "palette.yml": 'primary: "#b3261e"\nfrost: "#99ddff"\n' },
          binaries: [],
        },
      },
    });
  });
  afterEach(() => vi.useRealTimers());

  it("shows the theme's colours over the library's and the default ones", () => {
    render(<KitThemePage name="noel" />);
    expect(within(row("primary")).getByText("#b3261e")).toBeInTheDocument();
    expect(within(row("warning")).getByText("#aa5500")).toBeInTheDocument();
    expect(within(row("danger")).getByText("#d6453d")).toBeInTheDocument();
    expect(within(row("frost")).getByText("#99ddff")).toBeInTheDocument();
    // Only what the theme gives itself can be taken back.
    expect(within(row("primary")).getByRole("button")).toBeEnabled();
    expect(within(row("warning")).getByRole("button")).toBeDisabled();
    expect(screen.queryByTestId("kit-theme-palette-drafted")).toBeNull();
  });

  it("writes a picked colour to the theme's draft, once the picking stops", async () => {
    render(<KitThemePage name="noel" />);
    fireEvent.change(screen.getByLabelText("Couleur de success"), { target: { value: "#00ff00" } });
    fireEvent.change(screen.getByLabelText("Couleur de success"), { target: { value: "#00aa00" } });
    expect(within(row("success")).getByText("#00aa00")).toBeInTheDocument();
    expect(writeDraftFile).not.toHaveBeenCalled();
    await act(async () => {
      await vi.advanceTimersByTimeAsync(500);
    });
    expect(writeDraftFile).toHaveBeenCalledTimes(1);
    expect(writeDraftFile).toHaveBeenCalledWith(
      "srv.noel",
      "palette.yml",
      'primary: "#b3261e"\nfrost: "#99ddff"\nsuccess: "#00aa00"\n',
    );
    expect(screen.getByTestId("kit-theme-palette-drafted")).toBeInTheDocument();
  });

  it("takes a colour back, adds a name, and takes the file off when nothing is left", async () => {
    render(<KitThemePage name="noel" />);
    fireEvent.click(within(row("primary")).getByRole("button"));
    expect(within(row("primary")).getByText("#3b82f6")).toBeInTheDocument();
    fireEvent.click(within(row("frost")).getByRole("button"));
    expect(screen.queryByLabelText("Couleur de frost")).toBeNull();
    await act(async () => {
      await vi.advanceTimersByTimeAsync(500);
    });
    expect(writeDraftFile).toHaveBeenLastCalledWith("srv.noel", "palette.yml", null);
    const name = screen.getByLabelText("Nom d'une nouvelle couleur");
    fireEvent.change(name, { target: { value: "Bad Name" } });
    expect(screen.getByRole("button", { name: "Ajouter" })).toBeDisabled();
    fireEvent.change(name, { target: { value: "gold" } });
    fireEvent.click(screen.getByRole("button", { name: "Ajouter" }));
    expect(screen.getByLabelText("Couleur de gold")).toBeInTheDocument();
  });

  it("reads the player's draft of the theme before what is published, and says a failure", async () => {
    useProjectDraftStore.setState({
      drafts: {
        "srv.noel": {
          baseline: {},
          tree: { "palette.yml": 'primary: "#010203"\n' },
          at: 1,
        },
      },
    } as never);
    writeDraftFile.mockRejectedValue(new Error("draft_unavailable"));
    render(<KitThemePage name="noel" />);
    expect(within(row("primary")).getByText("#010203")).toBeInTheDocument();
    expect(screen.getByTestId("kit-theme-palette-drafted")).toBeInTheDocument();
    fireEvent.change(screen.getByLabelText("Couleur de danger"), { target: { value: "#ff0000" } });
    await act(async () => {
      await vi.advanceTimersByTimeAsync(500);
    });
    expect(screen.getByRole("alert")).toHaveTextContent("draft_unavailable");
  });

  it("offers no palette for a theme the library still keeps", () => {
    useKitStore.setState({
      read: {
        projectId: "srv.artisan",
        files: {},
        binaries: [{ path: "themes/vieux/assets/textures/close.1x1.png", hash: "h" }],
      },
      own: {},
    });
    render(<KitThemePage name="vieux" />);
    expect(screen.queryByTestId("kit-theme-palette")).toBeNull();
  });
});
