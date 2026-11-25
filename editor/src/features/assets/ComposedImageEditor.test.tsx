import type { Asset } from "@/domain/asset";
import * as userAssetsApi from "@/lib/api/userAssets";
import type { ComposeRecipe } from "@/lib/pack/compose";
import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { ComposedImageEditor } from "./ComposedImageEditor";
import { useAssetStore } from "./assetStore";

vi.mock("@/state/authStore", () => ({
  useAuthStore: (sel: (s: { currentUser: { id: string } | null }) => unknown) =>
    sel({ currentUser: { id: "u1" } }),
}));
// The pictures are not fetched here: a layer is laid out from its asset's size.
vi.mock("@/lib/useAuthenticatedImage", () => ({
  useAuthenticatedImageUrl: (url: string) => url,
}));

const image = (name: string, width: number, height: number, extra: Partial<Asset> = {}): Asset => ({
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
  ...extra,
});

const recipe: ComposeRecipe = {
  layers: [
    { image: "kit:window.3", x: 0, y: 0, columns: 1, rows: 1 },
    { image: "kit:cell", x: 7, y: 17, columns: 9, rows: 3 },
    { image: "icon", x: 80, y: 4, columns: 1, rows: 1 },
  ],
  width: null,
  height: null,
};
const composed = image("hall", 176, 166, { compose: recipe, previewUrl: "data:," });

const layers = () => screen.getAllByTestId("compose-layer");
const px = (value: string) => Number.parseFloat(value);

describe("ComposedImageEditor", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
    useAssetStore.getState().reset();
    useAssetStore
      .getState()
      .setAssets([composed, image("icon", 16, 16), image("other", 8, 8, { compose: recipe })]);
  });

  it("lays the layers out at the game's pixels, a grid repeating its image", () => {
    render(<ComposedImageEditor projectId={"p1" as never} asset={composed} />);
    const stage = screen.getByTestId("compose-stage");
    // As large as its bottom layer, the kit's window of 3 rows, twice the size here.
    expect([px(stage.style.width), px(stage.style.height)]).toEqual([352, 332]);
    const [, grid, icon] = layers();
    expect([grid!.style.left, grid!.style.top]).toEqual(["14px", "34px"]);
    expect([px(grid!.style.width), px(grid!.style.height)]).toEqual([9 * 18 * 2, 3 * 18 * 2]);
    expect(grid!.style.backgroundSize).toBe("36px 36px");
    expect([icon!.style.left, icon!.style.top]).toEqual(["160px", "8px"]);
    // Listed from the top one down, a grid with its size.
    const items = screen.getAllByRole("listitem");
    expect(items.map((item) => within(item).getAllByRole("button")[0]!.textContent)).toEqual([
      "icon",
      "cell9 × 3",
      "window.3",
    ]);
  });

  it("moves a layer with the pointer and the keys, by pixels or by slots, and saves the recipe", async () => {
    const saved = vi
      .spyOn(userAssetsApi, "patchAsset")
      .mockImplementation(async (_project, _id, patch) => ({
        ...composed,
        compose: patch.compose,
      }));
    render(<ComposedImageEditor projectId={"p1" as never} asset={composed} />);
    expect(screen.queryByRole("button", { name: "Enregistrer les calques" })).toBeNull();

    const icon = layers()[2]!;
    fireEvent.pointerDown(icon, { clientX: 100, clientY: 100, pointerId: 1 });
    fireEvent.pointerMove(icon, { clientX: 107, clientY: 96, pointerId: 1 });
    fireEvent.pointerUp(icon, { pointerId: 1 });
    // Seven screen pixels at twice the size: four of the game's, rounded; four up: two.
    expect([layers()[2]!.style.left, layers()[2]!.style.top]).toEqual(["168px", "4px"]);
    fireEvent.pointerDown(layers()[2]!, { clientX: 0, clientY: 0, pointerId: 1 });
    fireEvent.pointerMove(layers()[2]!, { clientX: 40, clientY: 0, pointerId: 1, shiftKey: true });
    fireEvent.pointerUp(layers()[2]!, { pointerId: 1 });
    // Twenty of the game's pixels with Shift: one whole slot.
    expect(layers()[2]!.style.left).toBe(`${(84 + 18) * 2}px`);
    fireEvent.keyDown(layers()[2]!, { key: "ArrowDown" });
    fireEvent.keyDown(layers()[2]!, { key: "ArrowLeft", shiftKey: true });

    // The selected layer's fields: the grid gets a row.
    fireEvent.click(within(screen.getAllByRole("listitem")[1]!).getAllByRole("button")[0]!);
    fireEvent.change(screen.getByLabelText("Lignes"), { target: { value: "4" } });

    fireEvent.click(screen.getByRole("button", { name: "Enregistrer les calques" }));
    await waitFor(() => expect(saved).toHaveBeenCalledTimes(1));
    expect(saved.mock.calls[0]).toEqual([
      "p1",
      "hall",
      {
        compose: {
          ...recipe,
          layers: [
            recipe.layers[0],
            { ...recipe.layers[1], rows: 4 },
            { ...recipe.layers[2], x: 84, y: 3 },
          ],
        },
      },
    ]);
    // Saved: the store has the new recipe, and nothing is left to save.
    expect(useAssetStore.getState().assets[0]!.compose?.layers[1]?.rows).toBe(4);
  });

  it("reorders and removes layers, and adds a module image that is not a composed one", () => {
    render(<ComposedImageEditor projectId={"p1" as never} asset={composed} />);
    fireEvent.click(screen.getByRole("button", { name: "Reculer icon" }));
    fireEvent.click(screen.getByRole("button", { name: "Retirer window.3" }));
    expect(layers().map((layer) => layer.getAttribute("aria-label"))).toEqual([
      "Calque 1 : icon",
      "Calque 2 : cell",
    ]);
    // The bottom layer is now the icon: the image is as large as it reaches.
    expect(px(screen.getByTestId("compose-stage").style.width)).toBeGreaterThan(0);

    fireEvent.click(screen.getByRole("button", { name: "Image du module" }));
    const dialog = screen.getByRole("dialog");
    expect(within(dialog).queryByTitle(/^other/)).toBeNull();
    expect(within(dialog).queryByTitle(/^hall/)).toBeNull();
    fireEvent.click(within(dialog).getByTitle(/^icon/));
    expect(layers()).toHaveLength(3);
    expect(layers()[2]!.getAttribute("aria-label")).toBe("Calque 3 : icon");

    // Undone, the recipe is the saved one again.
    fireEvent.click(screen.getByRole("button", { name: "Annuler les changements" }));
    expect(layers()).toHaveLength(3);
    expect(layers()[0]!.getAttribute("aria-label")).toBe("Calque 1 : window.3");
  });

  it("gives the image a fixed size, which clips its layers", () => {
    render(<ComposedImageEditor projectId={"p1" as never} asset={composed} />);
    fireEvent.click(screen.getByRole("checkbox", { name: "Taille fixe" }));
    fireEvent.change(screen.getByLabelText("Largeur"), { target: { value: "54" } });
    fireEvent.change(screen.getByLabelText("Hauteur"), { target: { value: "36" } });
    const stage = screen.getByTestId("compose-stage");
    expect([px(stage.style.width), px(stage.style.height)]).toEqual([108, 72]);
  });
});
