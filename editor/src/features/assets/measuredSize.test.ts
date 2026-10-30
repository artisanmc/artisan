import type { Asset } from "@/domain/asset";
import { describe, expect, it } from "vitest";
import { assetSize } from "./measuredSize";

const asset = (width: number, height: number) =>
  ({ projectId: "p", name: "box", contentHash: "h", width, height }) as Asset;

describe("assetSize", () => {
  it("takes the descriptor's size, else the one measured from the image", () => {
    expect(assetSize(asset(260, 100), {})).toEqual({ width: 260, height: 100 });
    // A module's image: no descriptor, listed at 0 × 0 until measured.
    expect(assetSize(asset(0, 0), {})).toBeUndefined();
    expect(assetSize(asset(0, 0), { "p\u0000box\u0000h": { width: 260, height: 100 } })).toEqual({
      width: 260,
      height: 100,
    });
    expect(assetSize(undefined, {})).toBeUndefined();
  });
});
