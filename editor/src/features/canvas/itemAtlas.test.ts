import type { LibraryItem } from "@/domain/library";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ATLAS_COLUMNS, atlasStyle, loadItemAtlas } from "./itemAtlas";
import { useTextureStore } from "./textureStore";

const apiRequest = vi.fn();
vi.mock("@/lib/api/client", () => ({
  API_URL: "",
  apiRequest: (...args: unknown[]) => apiRequest(...args),
}));

const items: LibraryItem[] = Array.from({ length: 70 }, (_, i) => ({
  id: `Item_${i}`,
  label: `Item ${i}`,
  category: "misc",
}));

describe("item atlas", () => {
  beforeEach(() => {
    apiRequest.mockReset();
    URL.createObjectURL = vi.fn(() => "blob:atlas");
    URL.revokeObjectURL = vi.fn();
  });
  afterEach(() => useTextureStore.getState().setAtlas(null));

  it("places an item by its rank in the catalogue", () => {
    const atlas = { url: "blob:a", rows: 3, index: { first: 0, last: 2 * ATLAS_COLUMNS + 5 } };
    expect(atlasStyle(atlas, "FIRST")?.backgroundPosition).toBe("0% 0%");
    expect(atlasStyle(atlas, "last")?.backgroundPosition).toBe(`${(5 / 31) * 100}% 100%`);
    expect(atlasStyle(atlas, "last")?.backgroundSize).toBe(`${ATLAS_COLUMNS * 100}% 300%`);
    expect(atlasStyle(atlas, "unknown")).toBeUndefined();
    expect(atlasStyle(null, "first")).toBeUndefined();
  });

  it("asks once more while the hub is still downloading, then indexes the catalogue", async () => {
    apiRequest
      .mockResolvedValueOnce(new Response(null, { status: 503 }))
      .mockResolvedValueOnce({ status: 200, ok: true, blob: async () => ({}) as Blob });
    const wait = vi.fn(async () => {});
    await loadItemAtlas("1.21.4", items, () => true, wait);
    expect(apiRequest).toHaveBeenCalledTimes(2);
    expect(apiRequest.mock.calls[0][0]).toBe("/api/v1/item-atlas/1.21.4");
    const atlas = useTextureStore.getState().atlas;
    expect(atlas).toMatchObject({ url: "blob:atlas", rows: 3 });
    expect(atlas?.index.item_69).toBe(69);
  });

  it("keeps the pictures one by one when the hub has no atlas", async () => {
    apiRequest.mockResolvedValue(new Response(null, { status: 404 }));
    await loadItemAtlas(
      "1.21.4",
      items,
      () => true,
      async () => {},
    );
    expect(apiRequest).toHaveBeenCalledTimes(1);
    expect(useTextureStore.getState().atlas).toBeNull();
  });

  it("drops an atlas for a project the editor already left", async () => {
    apiRequest.mockResolvedValue({ status: 200, ok: true, blob: async () => ({}) as Blob });
    let current = true;
    const pending = loadItemAtlas("1.21.4", items, () => current);
    current = false;
    await pending;
    expect(useTextureStore.getState().atlas).toBeNull();
  });
});
