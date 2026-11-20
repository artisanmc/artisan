import type { LibraryItem } from "@/domain/library";
import { fireEvent, render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { MaterialPicker } from "./MaterialPicker";
import { useTextureStore } from "./textureStore";

// jsdom lays nothing out: the virtualizer is given a fixed window of rows, the way a
// browser would show only what fits in the dialog.
const VISIBLE_ROWS = 3;
vi.mock("@tanstack/react-virtual", () => ({
  useVirtualizer: ({ count, estimateSize }: { count: number; estimateSize: () => number }) => ({
    getTotalSize: () => count * estimateSize(),
    getVirtualItems: () =>
      Array.from({ length: Math.min(count, VISIBLE_ROWS) }, (_, i) => ({
        index: i,
        start: i * estimateSize(),
        size: estimateSize(),
      })),
  }),
}));

const ITEMS: LibraryItem[] = Array.from({ length: 1600 }, (_, i) => ({
  id: `item_${i}`,
  label: `Item ${i}`,
  category: "misc",
  texture: `item/item_${i}`,
}));

describe("MaterialPicker", () => {
  beforeEach(() => {
    const s = useTextureStore.getState();
    s.setData("1.21.4", ITEMS);
    s.setLibraryItems(ITEMS);
    s.setLibraryCustomData({ serverKeyId: "", items: [] });
  });

  it("mounts only the rows in view, not one icon per catalogue item", () => {
    render(<MaterialPicker trigger={<button type="button">open</button>} onPick={() => {}} />);
    fireEvent.click(screen.getByText("open"));
    const icons = screen.getByTestId("material-grid").querySelectorAll("img");
    expect(icons.length).toBeGreaterThan(0);
    expect(icons.length).toBeLessThanOrEqual(VISIBLE_ROWS * 8);
  });

  it("draws the icons from the atlas once it is loaded", () => {
    useTextureStore.getState().setAtlas({ url: "blob:atlas", rows: 50, index: { item_0: 0 } });
    render(<MaterialPicker trigger={<button type="button">open</button>} onPick={() => {}} />);
    fireEvent.click(screen.getByText("open"));
    const first = screen.getByTitle("Item 0");
    expect(first.querySelector("img")).toBeNull();
    expect(first.querySelector("[role=img]")?.getAttribute("style")).toContain("blob:atlas");
    useTextureStore.getState().setAtlas(null);
  });

  it("still finds and picks an item past the first rows through the search", () => {
    const onPick = vi.fn();
    render(<MaterialPicker trigger={<button type="button">open</button>} onPick={onPick} />);
    fireEvent.click(screen.getByText("open"));
    fireEvent.change(screen.getByRole("textbox"), { target: { value: "item_1599" } });
    fireEvent.click(screen.getByTitle("Item 1599"));
    expect(onPick).toHaveBeenCalledWith("item_1599");
  });
});
