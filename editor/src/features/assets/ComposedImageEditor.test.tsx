import type { Asset } from "@/domain/asset";
import * as userAssetsApi from "@/lib/api/userAssets";
import type { ComposeRecipe } from "@/lib/pack/compose";
import { createImage, decodePng, encodePng } from "@/lib/pack/png";
import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { useState } from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { ComposedImageEditor } from "./ComposedImageEditor";
import type { StudioTool } from "./StudioFrame";
import { useAssetStore } from "./assetStore";
import { layerRef } from "./imageLayers";

vi.mock("@/state/authStore", () => ({
  useAuthStore: (sel: (s: { currentUser: { id: string } | null }) => unknown) =>
    sel({ currentUser: { id: "u1" } }),
}));
// The pictures are not fetched here: a layer is laid out from its asset's size.
vi.mock("@/lib/useAuthenticatedImage", () => ({
  useAuthenticatedImageUrl: (url: string) => url,
}));

/** The files that can be read to be drawn on, by asset id. */
const files: Record<string, Uint8Array | undefined> = {};
vi.mock("./assetBytes", () => ({
  assetBytes: async (a: Asset) => {
    const bytes = files[a.id];
    if (!bytes) throw new Error("image_unavailable:404");
    return bytes;
  },
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
const tool = (name: string) =>
  within(screen.getByRole("group", { name: "Outil" })).getByRole("button", { name });

/** The editor's parts one under the other, the tool held as the atelier holds it. */
function Stand({ asset = composed }: { asset?: Asset }) {
  const [held, setHeld] = useState<StudioTool>("move");
  const current = useAssetStore((s) => s.assets.find((a) => a.id === asset.id)) ?? asset;
  return (
    <ComposedImageEditor
      projectId={"p1" as never}
      asset={asset === composed ? current : asset}
      tool={held}
      onTool={setHeld}
      layout={(parts) => (
        <div onKeyDown={parts.keys}>
          {parts.rail}
          {parts.controls}
          {parts.stage}
          {parts.status}
          {parts.panels}
          {parts.actions}
          {parts.preview}
        </div>
      )}
    />
  );
}
const px = (value: string) => Number.parseFloat(value);

describe("ComposedImageEditor", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
    for (const id of Object.keys(files)) delete files[id];
    useAssetStore.getState().reset();
    useAssetStore
      .getState()
      .setAssets([composed, image("icon", 16, 16), image("other", 8, 8, { compose: recipe })]);
  });

  it("lays the layers out at the game's pixels, a grid repeating its image", () => {
    render(<Stand />);
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
      "cell9 × 3commune",
      "window.3commune",
    ]);
  });

  it("undoes and redoes what was done to the layers, a drag as one step", () => {
    render(<Stand />);
    const place = () => [layers()[2]!.style.left, layers()[2]!.style.top];
    const start = place();
    fireEvent.pointerDown(layers()[2]!, { clientX: 100, clientY: 100, pointerId: 1 });
    fireEvent.pointerMove(layers()[2]!, { clientX: 104, clientY: 100, pointerId: 1 });
    fireEvent.pointerMove(layers()[2]!, { clientX: 110, clientY: 100, pointerId: 1 });
    fireEvent.pointerUp(layers()[2]!, { pointerId: 1 });
    const dragged = place();
    fireEvent.keyDown(layers()[2]!, { key: "ArrowDown" });
    const nudged = place();
    expect(nudged).not.toEqual(dragged);

    const stage = screen.getByTestId("compose-stage");
    fireEvent.keyDown(stage, { key: "z", ctrlKey: true });
    expect(place()).toEqual(dragged);
    fireEvent.keyDown(stage, { key: "z", ctrlKey: true });
    expect(place()).toEqual(start);
    expect(screen.getByRole("button", { name: "Annuler" })).toBeDisabled();
    fireEvent.keyDown(stage, { key: "y", ctrlKey: true });
    expect(place()).toEqual(dragged);
    fireEvent.click(screen.getByRole("button", { name: "Rétablir" }));
    expect(place()).toEqual(nudged);
    fireEvent.click(screen.getByRole("button", { name: "Annuler" }));
    expect(place()).toEqual(dragged);
  });

  it("moves a layer with the pointer and the keys, by pixels or by slots, and saves the recipe", async () => {
    const saved = vi
      .spyOn(userAssetsApi, "patchAsset")
      .mockImplementation(async (_project, _id, patch) => ({
        ...composed,
        compose: patch.compose,
      }));
    render(<Stand />);
    expect(screen.getByRole("button", { name: "Enregistrer" })).toBeDisabled();

    const icon = layers()[2]!;
    fireEvent.pointerDown(icon, { clientX: 100, clientY: 100, pointerId: 1 });
    fireEvent.pointerMove(icon, { clientX: 107, clientY: 96, pointerId: 1 });
    fireEvent.pointerUp(icon, { pointerId: 1 });
    // Seven screen pixels at twice the size: four of the game's, rounded; four up: two.
    expect([layers()[2]!.style.left, layers()[2]!.style.top]).toEqual(["168px", "4px"]);
    fireEvent.pointerDown(layers()[2]!, { clientX: 0, clientY: 0, pointerId: 1 });
    fireEvent.pointerMove(layers()[2]!, { clientX: 40, clientY: 0, pointerId: 1, shiftKey: true });
    fireEvent.pointerUp(layers()[2]!, { pointerId: 1 });
    // With Shift the layer lands on the window's slots (from 7, 17), though it started off them.
    expect([layers()[2]!.style.left, layers()[2]!.style.top]).toEqual([
      `${(7 + 5 * 18) * 2}px`,
      `${(17 - 18) * 2}px`,
    ]);
    fireEvent.keyDown(layers()[2]!, { key: "ArrowDown" });
    // On a line: Shift and an arrow go one slot.
    fireEvent.keyDown(layers()[2]!, { key: "ArrowLeft", shiftKey: true });
    expect(layers()[2]!.style.left).toBe(`${(7 + 4 * 18) * 2}px`);
    // Between two lines: to the next one that way.
    fireEvent.keyDown(layers()[2]!, { key: "ArrowRight" });
    fireEvent.keyDown(layers()[2]!, { key: "ArrowRight", shiftKey: true });
    expect(layers()[2]!.style.left).toBe(`${(7 + 5 * 18) * 2}px`);
    fireEvent.keyDown(layers()[2]!, { key: "ArrowLeft", shiftKey: true });

    // The selected layer's fields: the grid gets a row.
    fireEvent.click(within(screen.getAllByRole("listitem")[1]!).getAllByRole("button")[0]!);
    fireEvent.change(screen.getByLabelText("Lignes"), { target: { value: "4" } });

    fireEvent.click(screen.getByRole("button", { name: "Enregistrer" }));
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
            { ...recipe.layers[2], x: 7 + 4 * 18, y: 0 },
          ],
        },
      },
    ]);
    // Saved: the store has the new recipe, and nothing is left to save.
    expect(useAssetStore.getState().assets[0]!.compose?.layers[1]?.rows).toBe(4);
  });

  it("gives a layer of a sliced image a size, by its fields and its corner's handle, and saves it", async () => {
    const framed = image("framed", 176, 166, {
      compose: {
        layers: [{ image: "panel", x: 7, y: 17, columns: 1, rows: 1 }],
        width: 176,
        height: 166,
      },
      previewUrl: "data:,",
    });
    useAssetStore
      .getState()
      .setAssets([
        framed,
        image("panel", 12, 10, { slice: { left: 3, right: 4, top: 2, bottom: 3 } }),
      ]);
    const saved = vi
      .spyOn(userAssetsApi, "patchAsset")
      .mockImplementation(async (_project, _id, patch) => ({ ...framed, compose: patch.compose }));
    render(<Stand asset={framed} />);
    // A sliced image: a size, and no count of repeats.
    fireEvent.pointerDown(layers()[0]!, { clientX: 0, clientY: 0, pointerId: 1 });
    fireEvent.pointerUp(layers()[0]!, { pointerId: 1 });
    expect(screen.queryByLabelText("Lignes")).toBeNull();
    expect(screen.getByLabelText("Largeur du calque")).toHaveValue(12);
    fireEvent.change(screen.getByLabelText("Largeur du calque"), { target: { value: "40" } });
    expect(layers()[0]!.style.width).toBe("80px");
    // The handle: ten screen pixels at twice the size are five of the game's; Shift, whole slots.
    const handle = screen.getByTestId("compose-resize");
    fireEvent.pointerDown(handle, { clientX: 0, clientY: 0, pointerId: 1 });
    fireEvent.pointerMove(handle, { clientX: 10, clientY: 10, pointerId: 1 });
    expect([layers()[0]!.style.width, layers()[0]!.style.height]).toEqual(["90px", "30px"]);
    fireEvent.pointerMove(handle, { clientX: 20, clientY: 40, pointerId: 1, shiftKey: true });
    fireEvent.pointerUp(handle, { pointerId: 1 });
    expect([layers()[0]!.style.width, layers()[0]!.style.height]).toEqual(["108px", "72px"]);
    // Never under its margins.
    fireEvent.change(screen.getByLabelText("Hauteur du calque"), { target: { value: "1" } });
    expect(layers()[0]!.style.height).toBe("10px");

    fireEvent.click(screen.getByRole("button", { name: "Enregistrer" }));
    await waitFor(() => expect(saved).toHaveBeenCalledTimes(1));
    expect(saved.mock.calls[0]![2].compose?.layers).toEqual([
      { image: "panel", x: 7, y: 17, columns: 1, rows: 1, width: 54, height: 5 },
    ]);
  });

  it("reorders and removes layers, and adds a module image that is not a composed one", () => {
    render(<Stand />);
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
    render(<Stand />);
    fireEvent.click(screen.getByRole("checkbox", { name: "Taille fixe" }));
    fireEvent.change(screen.getByLabelText("Largeur"), { target: { value: "54" } });
    fireEvent.change(screen.getByLabelText("Hauteur"), { target: { value: "36" } });
    const stage = screen.getByTestId("compose-stage");
    expect([px(stage.style.width), px(stage.style.height)]).toEqual([108, 72]);
  });
  it("draws a layer: empty, of the image's size, on top, and written only when the image is saved", async () => {
    const uploaded = vi
      .spyOn(userAssetsApi, "uploadAsset")
      .mockImplementation(async (_project, input) => image(input.name, 176, 166));
    const saved = vi
      .spyOn(userAssetsApi, "patchAsset")
      .mockImplementation(async (_project, _id, patch) => ({
        ...composed,
        compose: patch.compose as ComposeRecipe,
      }));
    render(<Stand />);
    fireEvent.click(screen.getByRole("button", { name: "Dessin" }));
    // The new layer is selected with a pencil in hand: it is drawn among the others.
    await waitFor(() => expect(tool("Crayon")).toHaveAttribute("aria-pressed", "true"));
    expect(screen.queryByTestId("compose-stage")).toBeNull();
    expect(screen.getByTestId("pixel-canvas")).toBeInTheDocument();
    expect(within(screen.getAllByRole("listitem")[0]!).getAllByRole("button")[0]).toHaveAttribute(
      "aria-pressed",
      "true",
    );
    // Nothing is written yet, and one step back takes the layer away.
    expect(uploaded).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole("button", { name: "Annuler" }));
    expect(within(screen.getByTestId("studio-layers")).getAllByRole("listitem")).toHaveLength(3);
    fireEvent.click(screen.getByRole("button", { name: "Rétablir" }));
    expect(within(screen.getByTestId("studio-layers")).getAllByRole("listitem")).toHaveLength(4);

    fireEvent.click(screen.getByRole("button", { name: "Enregistrer" }));
    await waitFor(() => expect(saved).toHaveBeenCalledTimes(1));
    // The layer's file first, then the layers that name it.
    expect(uploaded.mock.calls[0]?.[1]).toMatchObject({ name: "hall_layer", type: "glyph" });
    expect(uploaded.mock.invocationCallOrder[0]!).toBeLessThan(saved.mock.invocationCallOrder[0]!);
    const file = uploaded.mock.calls[0]?.[1].file as File;
    const { width, height } = decodePng(new Uint8Array(await file.arrayBuffer()));
    expect([width, height]).toEqual([176, 166]);
    expect((saved.mock.calls[0]?.[2].compose as ComposeRecipe).layers.at(-1)).toEqual({
      image: "hall_layer",
      x: 0,
      y: 0,
      columns: 1,
      rows: 1,
    });
    await waitFor(() => expect(screen.getByRole("button", { name: "Enregistrer" })).toBeDisabled());
  });

  it("reads a common image written `artisan:<name>` like the former `kit:<name>`", () => {
    // What the assistant's compose writes, and the editor since: the same image, the same label.
    const written: ComposeRecipe = {
      ...recipe,
      layers: [
        { ...recipe.layers[0]!, image: "artisan:window.3" },
        { ...recipe.layers[1]!, image: "artisan:cell" },
        recipe.layers[2]!,
      ],
    };
    render(<Stand asset={image("hall", 176, 166, { compose: written, previewUrl: "data:," })} />);
    const stage = screen.getByTestId("compose-stage");
    expect([px(stage.style.width), px(stage.style.height)]).toEqual([352, 332]);
    expect(layers().map((layer) => layer.getAttribute("aria-label"))).toEqual([
      "Calque 1 : window.3",
      "Calque 2 : cell",
      "Calque 3 : icon",
    ]);
    const [, grid] = layers();
    expect([px(grid!.style.width), px(grid!.style.height)]).toEqual([9 * 18 * 2, 3 * 18 * 2]);
  });

  it("writes a common image as `artisan:<name>`, a PNG of the module by its name", () => {
    expect(layerRef({ name: "kit:button.3x1" })).toBe("artisan:button.3x1");
    expect(layerRef({ name: "artisan:button.3x1" })).toBe("artisan:button.3x1");
    expect(layerRef({ name: "icon" })).toBe("icon");
  });

  it("draws on a PNG layer of the module, never on a common image", async () => {
    render(<Stand />);
    fireEvent.pointerDown(layers()[0] as HTMLElement);
    expect(screen.queryByRole("button", { name: "Dessiner sur ce calque" })).toBeNull();
    fireEvent.pointerDown(layers()[2] as HTMLElement);
    fireEvent.click(screen.getByRole("button", { name: "Dessiner sur ce calque" }));
    expect(tool("Crayon")).toHaveAttribute("aria-pressed", "true");
    expect(screen.queryByTestId("compose-stage")).toBeNull();
    // A common image selected is moved: the move tool takes over, the layers on the stage again.
    fireEvent.click(within(screen.getAllByRole("listitem")[2]!).getAllByRole("button")[0]!);
    await waitFor(() => expect(tool("Déplacer le calque")).toHaveAttribute("aria-pressed", "true"));
    expect(screen.getByTestId("compose-stage")).toBeInTheDocument();
  });

  it("keeps one history for the layers and the pixels, and writes both when the image is saved", async () => {
    files.icon = encodePng(createImage(16, 16));
    const uploaded = vi
      .spyOn(userAssetsApi, "uploadAsset")
      .mockImplementation(async (_project, input) =>
        image(input.name, 16, 16, { contentHash: "drawn" }),
      );
    const saved = vi
      .spyOn(userAssetsApi, "patchAsset")
      .mockImplementation(async (_project, _id, patch) => ({
        ...composed,
        compose: patch.compose as ComposeRecipe,
      }));
    render(<Stand />);
    const save = () => screen.getByRole("button", { name: "Enregistrer" });
    fireEvent.pointerDown(layers()[2] as HTMLElement);
    fireEvent.click(screen.getByRole("button", { name: "Dessiner sur ce calque" }));
    // The stage has no size here: the image is shown at the game's pixels.
    const canvas = await screen.findByTestId("pixel-canvas");
    fireEvent.pointerDown(canvas, { clientX: 5, clientY: 5, button: 0, pointerId: 1 });
    fireEvent.pointerUp(canvas, { pointerId: 1 });
    expect(save()).toBeEnabled();

    // Leaving the drawing writes nothing: the pixels stay in hand, shown on the layer.
    fireEvent.click(tool("Déplacer le calque"));
    expect(uploaded).not.toHaveBeenCalled();
    expect(layers()[2]!.style.backgroundImage).toContain("data:image/png");
    fireEvent.keyDown(layers()[2] as HTMLElement, { key: "ArrowRight" });
    expect(layers()[2]!.style.left).toBe("162px");

    // The steps go back in the order they were made: the move, then the stroke.
    const undo = () => fireEvent.click(screen.getByRole("button", { name: "Annuler" }));
    undo();
    expect(layers()[2]!.style.left).toBe("160px");
    expect(save()).toBeEnabled();
    undo();
    expect(save()).toBeDisabled();
    expect(screen.getByRole("button", { name: "Annuler" })).toBeDisabled();
    fireEvent.click(screen.getByRole("button", { name: "Rétablir" }));
    fireEvent.click(screen.getByRole("button", { name: "Rétablir" }));
    expect(layers()[2]!.style.left).toBe("162px");

    fireEvent.click(save());
    await waitFor(() => expect(saved).toHaveBeenCalledTimes(1));
    expect(uploaded).toHaveBeenCalledTimes(1);
    expect(uploaded.mock.calls[0]?.[1]).toMatchObject({ name: "icon", retouch: true });
    const file = uploaded.mock.calls[0]?.[1].file as File;
    const drawn = decodePng(new Uint8Array(await file.arrayBuffer()));
    expect(drawn.data[(5 * 16 + 5) * 4 + 3]).toBe(255);
    expect((saved.mock.calls[0]?.[2].compose as ComposeRecipe).layers[2]).toMatchObject({ x: 81 });
    expect(uploaded.mock.invocationCallOrder[0]!).toBeLessThan(saved.mock.invocationCallOrder[0]!);
    await waitFor(() => expect(save()).toBeDisabled());
  });

  it("gives a drawing tool the top drawing of the module, and none when the layers hold no drawing", () => {
    const { unmount } = render(<Stand />);
    fireEvent.click(tool("Gomme"));
    expect(tool("Gomme")).toHaveAttribute("aria-pressed", "true");
    // The icon, the one layer that is a PNG of the module, is the one drawn on.
    expect(within(screen.getAllByRole("listitem")[0]!).getAllByRole("button")[0]).toHaveAttribute(
      "aria-pressed",
      "true",
    );
    unmount();

    const common: ComposeRecipe = { ...recipe, layers: recipe.layers.slice(0, 2) };
    render(<Stand asset={image("frame", 176, 166, { compose: common, previewUrl: "data:," })} />);
    expect(tool("Crayon")).toHaveAttribute("aria-disabled", "true");
    fireEvent.click(tool("Crayon"));
    expect(tool("Déplacer le calque")).toHaveAttribute("aria-pressed", "true");
    expect(screen.getByTestId("compose-stage")).toBeInTheDocument();
  });
});
