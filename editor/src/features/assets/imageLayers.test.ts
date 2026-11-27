import type { Asset } from "@/domain/asset";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { canHaveLayers, layerName, toLayers } from "./imageLayers";

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

  it("offers layers to any PNG, a texture as much as a glyph, never to a font", () => {
    expect(canHaveLayers(image("go"))).toBe(true);
    expect(canHaveLayers(image("go", { compose: recipe }))).toBe(false);
    expect(canHaveLayers(image("go", { type: "texture" }))).toBe(true);
    expect(canHaveLayers(image("go", { type: "font", width: 0, height: 0 }))).toBe(false);
    expect(canHaveLayers(image("go", { type: "font" }))).toBe(false);
  });

  it("keeps a texture a texture: its layer, the image it becomes", async () => {
    const texture = image("gem", { type: "texture", ascent: null, usages: [] });
    patchAsset.mockResolvedValue({ ...texture, name: "gem_layer" });
    composeAsset.mockResolvedValue({ ...texture, compose: recipe });
    await toLayers("p1", texture, new Set(["gem"]));
    expect(composeAsset.mock.calls[0]?.[1]).toMatchObject({ name: "gem", type: "texture" });
    expect(composeAsset.mock.calls[0]?.[1]).not.toHaveProperty("ascent");
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
      type: "glyph",
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

  it("gives the image the layers asked for, told the name its PNG took", async () => {
    patchAsset.mockResolvedValue(image("go_layer", { usages: [] }));
    composeAsset.mockResolvedValue(image("go", { compose: recipe }));
    await toLayers("p1", image("go"), new Set(["go"]), false, (layer) => ({
      width: 54,
      height: 18,
      layers: [
        { image: layer, x: 0, y: 0, columns: 1, rows: 1 },
        { image: "artisan:cell", x: 18, y: 0, columns: 2, rows: 1 },
      ],
    }));
    expect(composeAsset.mock.calls[0]?.[1].recipe).toEqual({
      width: 54,
      height: 18,
      layers: [
        { image: "go_layer", x: 0, y: 0, columns: 1, rows: 1 },
        { image: "artisan:cell", x: 18, y: 0, columns: 2, rows: 1 },
      ],
    });
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
});
