import type { Asset } from "@/domain/asset";
import * as userAssetsApi from "@/lib/api/userAssets";
import { useProjectBaselineStore } from "@/state/projectBaselineStore";
import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { ImageStudio, useStudioPrefs } from "./ImageStudio";
import { useAssetStore } from "./assetStore";

vi.mock("@/state/authStore", () => ({
  useAuthStore: (sel: (s: { currentUser: { id: string } | null }) => unknown) =>
    sel({ currentUser: { id: "u1" } }),
}));
vi.mock("@/lib/useAuthenticatedImage", () => ({
  useAuthenticatedImageUrl: (url: string) => url,
}));

const toLayers = vi.fn();
const flatten = vi.fn();
vi.mock("./imageLayers", async (original) => ({
  ...(await original<typeof import("./imageLayers")>()),
  toLayers: (...args: unknown[]) => toLayers(...args),
  flatten: (...args: unknown[]) => flatten(...args),
}));

const composed = (name: string, width: number, height: number, image: string): Asset =>
  ({
    id: name,
    projectId: "p1",
    type: "glyph",
    name,
    width,
    height,
    ascent: 8,
    codepoint: null,
    fontMeta: null,
    contentHash: name,
    createdAt: "",
    updatedAt: "",
    previewUrl: "data:,",
    compose: { layers: [{ image, x: 0, y: 0, columns: 1, rows: 1 }], width, height },
  }) as Asset;

describe("ImageStudio", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
    toLayers.mockReset();
    flatten.mockReset();
    useAssetStore.getState().reset();
    useProjectBaselineStore.setState({ binaryBaselines: {} } as never);
    useStudioPrefs.setState({ hidden: [], situation: true });
  });

  it("shows a window with its slots, the player's inventory and the title, each turned off alone", () => {
    render(
      <ImageStudio
        projectId={"p1" as never}
        asset={composed("hall", 176, 222, "kit:window.6")}
        onClose={() => {}}
      />,
    );
    expect(
      screen.getByText(/Fond de menu, 6 rangées · 176 × 222 px · 1 calque/),
    ).toBeInTheDocument();
    expect(screen.getByTestId("guide-slots")).toBeInTheDocument();
    expect(screen.getAllByTestId("guide-inventory")).toHaveLength(2);
    expect(screen.getByTestId("guide-title")).toBeInTheDocument();
    // A window is the menu: it is not shown inside another.
    expect(screen.queryByTestId("situation-preview")).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "Inventaire du joueur" }));
    expect(screen.queryByTestId("guide-inventory")).toBeNull();
    expect(screen.getByTestId("guide-slots")).toBeInTheDocument();
  });

  it("shows an image on slots in a menu, and goes back to the library", () => {
    const onClose = vi.fn();
    render(
      <ImageStudio
        projectId={"p1" as never}
        asset={composed("join", 54, 18, "kit:button.3x1")}
        onClose={onClose}
      />,
    );
    expect(screen.getByText(/Sur des slots, 3 × 1 · 54 × 18 px/)).toBeInTheDocument();
    expect(screen.getByTestId("situation-preview")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Titre" })).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "Dans un menu" }));
    expect(screen.queryByTestId("situation-preview")).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "Ressources" }));
    expect(onClose).toHaveBeenCalled();
  });

  it("adds a layer to a PNG, which becomes layers under its name, and flattens layers after a second click", async () => {
    const png = { ...composed("go", 54, 18, "x"), compose: undefined } as Asset;
    const layered = composed("go", 54, 18, "go_layer");
    toLayers.mockResolvedValue({
      layer: { ...png, id: "go_layer", name: "go_layer" },
      image: layered,
    });
    const patched = vi
      .spyOn(userAssetsApi, "patchAsset")
      .mockImplementation(
        async (_project, _id, patch) => ({ ...layered, compose: patch.compose }) as Asset,
      );
    useAssetStore.getState().setAssets([png, { ...png, id: "icon", name: "icon" }]);
    const { unmount } = render(
      <ImageStudio projectId={"p1" as never} asset={png} onClose={() => {}} />,
    );
    // A PNG is listed as its one layer, with nothing to flatten.
    expect(within(screen.getByTestId("studio-layers")).getAllByRole("listitem")).toHaveLength(1);
    expect(screen.queryByRole("button", { name: "Aplatir" })).toBeNull();
    expect(
      within(screen.getByRole("group", { name: "Outil" })).getByRole("button", {
        name: "Déplacer le calque",
      }),
    ).toHaveAttribute("aria-disabled", "true");
    fireEvent.click(screen.getByRole("button", { name: "Image du module" }));
    fireEvent.click(within(await screen.findByRole("dialog")).getByTitle(/^icon/));
    await waitFor(() => expect(patched).toHaveBeenCalledTimes(1));
    // The owner holds the PNG: it is renamed as the first layer, the picked image set over it.
    expect(toLayers.mock.calls[0]?.slice(1)).toEqual([png, new Set(["go", "icon"]), false]);
    expect(patched.mock.calls[0]?.slice(1)).toEqual([
      "go",
      {
        compose: {
          ...layered.compose,
          layers: [
            ...(layered.compose?.layers ?? []),
            { image: "icon", x: 0, y: 0, columns: 1, rows: 1 },
          ],
        },
      },
    ]);
    await waitFor(() =>
      expect(
        useAssetStore.getState().assets.find((a) => a.id === "go")?.compose?.layers,
      ).toHaveLength(2),
    );
    unmount();

    flatten.mockResolvedValue(png);
    render(<ImageStudio projectId={"p1" as never} asset={layered} onClose={() => {}} />);
    fireEvent.click(screen.getByRole("button", { name: "Aplatir" }));
    expect(flatten).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole("button", { name: "Aplatir en un seul dessin ?" }));
    await waitFor(() => expect(flatten).toHaveBeenCalledWith("p1", layered));
  });

  it("copies an image the module ships as the first layer, the owner holding no file of it", async () => {
    const png = { ...composed("go", 54, 18, "x"), compose: undefined } as Asset;
    const layered = composed("go", 54, 18, "go_layer");
    toLayers.mockResolvedValue({
      layer: { ...png, id: "go_layer", name: "go_layer" },
      image: layered,
    });
    vi.spyOn(userAssetsApi, "patchAsset").mockResolvedValue(layered);
    useProjectBaselineStore.setState({
      binaryBaselines: { p1: { "originals/assets/glyphs/go.png": { hash: "h", size: 1 } } },
    } as never);
    useAssetStore.getState().setAssets([png, { ...png, id: "icon", name: "icon" }]);
    render(<ImageStudio projectId={"p1" as never} asset={png} onClose={() => {}} />);
    fireEvent.click(screen.getByRole("button", { name: "Image du module" }));
    fireEvent.click(within(await screen.findByRole("dialog")).getByTitle(/^icon/));
    await waitFor(() => expect(toLayers).toHaveBeenCalledTimes(1));
    expect(toLayers.mock.calls[0]?.[3]).toBe(true);
  });
});
