import type { Asset } from "@/domain/asset";
import type { ComposeRecipe } from "@/lib/pack/compose";
import { createImage, encodePng } from "@/lib/pack/png";
import { act, renderHook, waitFor } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { useImageDocument } from "./imageDocument";
import { copyImage, paint, pixelAt } from "./pixelTools";

const files: Record<string, Uint8Array> = {};
vi.mock("./assetBytes", () => ({
  assetBytes: async (a: Asset) => {
    const bytes = files[a.id];
    if (!bytes) throw new Error("image_unavailable:404");
    return bytes;
  },
}));

const asset = (name: string, contentHash = name): Asset =>
  ({ id: name, projectId: "p1", type: "glyph", name, width: 2, height: 2, contentHash }) as Asset;
const layer = (image: string, x = 0) => ({ image, x, y: 0, columns: 1, rows: 1 });
const first: ComposeRecipe = { width: null, height: null, layers: [layer("icon")] };
const INK = [9, 9, 9, 255] as const;

/** One stroke on `id`: a pixel painted, recorded as the editor does. */
function stroke(doc: ReturnType<typeof useImageDocument>, id: string, x: number) {
  const drawing = doc.drawing(id)!;
  const before = copyImage(drawing.image);
  paint(drawing.image, x, 0, [...INK]);
  doc.drew(id, before);
}

describe("useImageDocument", () => {
  it("undoes layers and pixels in the order they were changed, and redoes them", async () => {
    files.icon = encodePng(createImage(2, 2));
    const { result } = renderHook(() => useImageDocument(first));
    act(() => result.current.read(asset("icon")));
    await waitFor(() => expect(result.current.drawing("icon")).toBeDefined());
    const alpha = (x: number) => pixelAt(result.current.drawing("icon")!.image, x, 0)[3];

    act(() => stroke(result.current, "icon", 0));
    act(() => result.current.setRecipe((r) => ({ ...r, layers: [layer("icon", 5)] })));
    act(() => stroke(result.current, "icon", 1));
    expect([alpha(0), alpha(1), result.current.recipe.layers[0]?.x]).toEqual([255, 255, 5]);
    expect(result.current.dirty("icon")).toBe(true);

    act(() => result.current.undo());
    expect([alpha(0), alpha(1), result.current.recipe.layers[0]?.x]).toEqual([255, 0, 5]);
    act(() => result.current.undo());
    expect([alpha(0), alpha(1), result.current.recipe.layers[0]?.x]).toEqual([255, 0, 0]);
    act(() => result.current.undo());
    expect([alpha(0), result.current.dirty("icon"), result.current.canUndo]).toEqual([
      0,
      false,
      false,
    ]);
    act(() => result.current.redo());
    act(() => result.current.redo());
    act(() => result.current.redo());
    expect([alpha(0), alpha(1), result.current.recipe.layers[0]?.x]).toEqual([255, 255, 5]);
    expect(result.current.canRedo).toBe(false);
  });

  it("makes one step of a gesture, and of going back to what is saved", async () => {
    files.icon = encodePng(createImage(2, 2));
    const { result } = renderHook(() => useImageDocument(first));
    act(() => result.current.read(asset("icon")));
    await waitFor(() => expect(result.current.drawing("icon")).toBeDefined());
    for (const x of [1, 2, 3])
      act(() => result.current.setRecipe({ ...first, layers: [layer("icon", x)] }, "drag:1"));
    act(() => stroke(result.current, "icon", 0));
    act(() => result.current.discard(first));
    expect([result.current.recipe, result.current.dirty("icon")]).toEqual([first, false]);
    // The discard is undone at once, then the stroke, then the whole drag.
    act(() => result.current.undo());
    expect([result.current.recipe.layers[0]?.x, result.current.dirty("icon")]).toEqual([3, true]);
    act(() => result.current.undo());
    act(() => result.current.undo());
    expect([result.current.recipe, result.current.canUndo]).toEqual([first, false]);
  });

  it("keeps a layer with no file as a draft until it is written, then under its file's id", () => {
    const { result } = renderHook(() => useImageDocument(first));
    act(() => result.current.addDraft(asset("draft:icon_layer"), createImage(2, 2)));
    act(() => stroke(result.current, "draft:icon_layer", 0));
    expect(result.current.drawing("draft:icon_layer")?.draft).toBe(true);
    act(() => result.current.written("draft:icon_layer", asset("icon_layer", "h1")));
    expect(result.current.drawing("draft:icon_layer")).toBeUndefined();
    expect(result.current.drawing("icon_layer")).toMatchObject({ draft: false, hash: "h1" });
    expect(result.current.dirty("icon_layer")).toBe(false);
    // The stroke made before the save is still a step back, on the file's pixels.
    act(() => result.current.undo());
    expect(result.current.dirty("icon_layer")).toBe(true);
    // Its file is not read over the pixels in hand.
    act(() => result.current.read(asset("icon_layer", "h1")));
    expect(result.current.failed("icon_layer")).toBe(false);
  });
});
