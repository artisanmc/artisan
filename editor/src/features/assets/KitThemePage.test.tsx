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
      theme: undefined,
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
    await waitFor(() => expect(onPutInPlace).toHaveBeenCalledWith("noel"));
  });

  it("takes off the theme in place, and says so of a theme the kit does not hold", async () => {
    useKitStore.setState({ theme: "noel" });
    const onPutInPlace = vi.fn().mockResolvedValue(undefined);
    const { unmount } = render(
      <KitThemePage name="noel" onBack={() => {}} onPutInPlace={onPutInPlace} />,
    );
    expect(screen.getByText("En place")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Retirer du serveur" }));
    await waitFor(() => expect(onPutInPlace).toHaveBeenCalledWith(null));
    unmount();
    render(<KitThemePage name="paques" onBack={() => {}} onPutInPlace={onPutInPlace} />);
    expect(screen.getByText(/n'a pas de thème « paques »/)).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Mettre en place sur le serveur" })).toBeNull();
  });
});
