import type { Asset } from "@/domain/asset";
import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { AssetGrid } from "./AssetGrid";

// The list is virtual: every row is given, as with room to show them all.
vi.mock("@tanstack/react-virtual", () => ({
  useVirtualizer: ({ count }: { count: number }) => ({
    getTotalSize: () => count * 54,
    getVirtualItems: () => Array.from({ length: count }, (_, index) => ({ index, start: 0 })),
  }),
}));

const image = (name: string): Asset =>
  ({ id: name, projectId: "p", type: "glyph", name, width: 16, height: 16 }) as Asset;

describe("AssetGrid", () => {
  it("lists titled parts, each with its count, and shows the tiles of the open ones", () => {
    const toggle = vi.fn();
    render(
      <AssetGrid
        assets={[]}
        groups={[
          { key: "own", label: "Mine", assets: [image("blason")], open: true, onToggle: () => {} },
          {
            key: "shipped",
            label: "Shipped",
            assets: [image("button"), image("panel")],
            open: false,
            onToggle: toggle,
          },
        ]}
        selectedId={null}
        onSelect={() => {}}
      />,
    );
    const [mine, shipped] = screen.getAllByTestId("asset-group");
    expect(mine?.textContent).toBe("Mine1");
    expect(shipped?.textContent).toBe("Shipped2");
    expect(shipped?.getAttribute("aria-expanded")).toBe("false");
    expect(screen.getByAltText("blason")).toBeTruthy();
    expect(screen.queryByAltText("button")).toBeNull();
    fireEvent.click(shipped!);
    expect(toggle).toHaveBeenCalled();
  });
});
