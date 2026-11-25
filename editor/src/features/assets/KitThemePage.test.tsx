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
          files: { "overrides/colors.yml": 'colors: {"#3c8527": "#ffb7c5"}\n' },
          binaries: [{ path: "overrides/artisan/close.1x1.png", hash: "h" }],
        },
      },
    });
    const onOpenKit = vi.fn();
    render(<KitThemePage name="printemps" onBack={() => {}} onOpenKit={onOpenKit} />);
    expect(within(screen.getByTestId("kit-theme-colors")).getByText("#ffb7c5")).toBeInTheDocument();
    expect(
      within(screen.getByTestId("kit-theme-drawings")).getByText("close.1x1"),
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
});
