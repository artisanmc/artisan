import type { Asset } from "@/domain/asset";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { canHaveLayers, flatten, layerName, toLayers } from "./imageLayers";

const patchAsset = vi.fn();
const composeAsset = vi.fn();
const deleteAsset = vi.fn();
const uploadAsset = vi.fn();
vi.mock("@/lib/api/userAssets", () => ({
  patchAsset: (...args: unknown[]) => patchAsset(...args),
  composeAsset: (...args: unknown[]) => composeAsset(...args),
  deleteAsset: (...args: unknown[]) => deleteAsset(...args),
  uploadAsset: (...args: unknown[]) => uploadAsset(...args),
}));

const image = (name: string, more: Partial<Asset> = {}): Asset => ({
  id: name,
  projectId: "p1",
  type: "glyph",
  name,
  width: 54,
  height: 18,
  ascent: 8,
  codepoint: null,
  fontMeta: null,
  usages: ["button"],
  contentHash: "h",
  createdAt: "",
  updatedAt: "",
  ...more,
});
const recipe = { width: null, height: null, layers: [] };

describe("image layers", () => {
  beforeEach(() => {
    for (const mock of [patchAsset, composeAsset, deleteAsset, uploadAsset]) mock.mockReset();
  });

  it("offers layers to a PNG drawn as a glyph only", () => {
    expect(canHaveLayers(image("go"))).toBe(true);
    expect(canHaveLayers(image("go", { compose: recipe }))).toBe(false);
    expect(canHaveLayers(image("go", { type: "texture" }))).toBe(false);
    expect(canHaveLayers(image("go", { type: "font", width: 0, height: 0 }))).toBe(false);
  });

  it("names the layer after the image, free, without a kit piece's dots", () => {
    expect(layerName(image("go"), new Set(["go"]))).toBe("go_layer");
    expect(layerName(image("go"), new Set(["go", "go_layer"]))).toBe("go_layer_2");
    expect(layerName(image("button.3x1"), new Set())).toBe("button-3x1_layer");
  });

  it("turns a PNG into an image of the same name made of that PNG", async () => {
    patchAsset.mockResolvedValue(image("go_layer", { usages: [] }));
    composeAsset.mockResolvedValue(image("go", { compose: recipe }));
    const made = await toLayers("p1", image("go"), new Set(["go"]));
    expect(patchAsset).toHaveBeenCalledWith("p1", "go", { name: "go_layer", usages: [] });
    expect(composeAsset).toHaveBeenCalledWith("p1", {
      name: "go",
      recipe: {
        width: null,
        height: null,
        layers: [{ image: "go_layer", x: 0, y: 0, columns: 1, rows: 1 }],
      },
      usages: ["button"],
      ascent: 8,
    });
    expect(made.layer.name).toBe("go_layer");
    expect(made.image.compose).toBeDefined();
  });

  it("copies an image the module ships as the layer, the owner holding no file to rename", async () => {
    const shipped = image("go", { previewUrl: "data:image/png;base64,AQID" });
    uploadAsset.mockResolvedValue(image("go_layer", { usages: [] }));
    composeAsset.mockResolvedValue(image("go", { compose: recipe }));
    const made = await toLayers("p1", shipped, new Set(["go"]), true);
    expect(patchAsset).not.toHaveBeenCalled();
    const sent = uploadAsset.mock.calls[0]?.[1] as { file: File };
    expect(sent).toMatchObject({ name: "go_layer", type: "glyph", usages: [], ascent: 8 });
    expect([...new Uint8Array(await sent.file.arrayBuffer())]).toEqual([1, 2, 3]);
    expect(composeAsset.mock.calls[0]?.[1]).toMatchObject({
      name: "go",
      recipe: { layers: [{ image: "go_layer", x: 0, y: 0, columns: 1, rows: 1 }] },
      usages: ["button"],
    });
    expect(made.image.compose).toBeDefined();

    composeAsset.mockRejectedValue(new Error("refused"));
    deleteAsset.mockResolvedValue(undefined);
    await expect(toLayers("p1", shipped, new Set(), true)).rejects.toThrow("refused");
    expect(deleteAsset).toHaveBeenCalledWith("p1", "go_layer");
  });

  it("gives the PNG its name back when the recipe is refused", async () => {
    patchAsset.mockResolvedValue(image("go_layer", { usages: [] }));
    composeAsset.mockRejectedValue(new Error("refused"));
    await expect(toLayers("p1", image("go"), new Set())).rejects.toThrow("refused");
    expect(patchAsset).toHaveBeenLastCalledWith("p1", "go_layer", {
      name: "go",
      usages: ["button"],
    });
  });

  it("flattens a composed image into one PNG of its name, the recipe put back on a failure", async () => {
    const composed = image("go", { compose: recipe, previewUrl: "data:image/png;base64,AQID" });
    uploadAsset.mockResolvedValue(image("go"));
    expect((await flatten("p1", composed)).compose).toBeUndefined();
    expect(deleteAsset).toHaveBeenCalledWith("p1", "go");
    expect(uploadAsset.mock.calls[0]?.[1]).toMatchObject({
      name: "go",
      type: "glyph",
      usages: ["button"],
      ascent: 8,
    });
    uploadAsset.mockRejectedValue(new Error("offline"));
    composeAsset.mockResolvedValue(composed);
    await expect(flatten("p1", composed)).rejects.toThrow("offline");
    expect(composeAsset).toHaveBeenCalledWith("p1", {
      name: "go",
      recipe,
      usages: ["button"],
      ascent: 8,
    });
  });
});
