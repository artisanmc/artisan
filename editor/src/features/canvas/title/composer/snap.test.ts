import { describe, expect, it } from "vitest";
import { snapDragPosition } from "./snap";

describe("snapDragPosition", () => {
  const scale = 2;
  const NONE = { shift: false, alt: false };

  it("default: rounds to nearest integer MC pixel", () => {
    expect(snapDragPosition(20.3, 10.6, scale, NONE)).toEqual({ x: 10, y: 5 });
    expect(snapDragPosition(21.0, 10.0, scale, NONE)).toEqual({ x: 11, y: 5 });
  });

  it("shift: passes raw sub-pixel coords through", () => {
    expect(snapDragPosition(21.0, 11.0, scale, { shift: true, alt: false })).toEqual({
      x: 10.5,
      y: 5.5,
    });
  });

  it("alt: snaps to multiples of 18 (slot grid)", () => {
    expect(snapDragPosition(36, 36, scale, { shift: false, alt: true })).toEqual({ x: 18, y: 18 });
    expect(snapDragPosition(0, 70, scale, { shift: false, alt: true })).toEqual({ x: 0, y: 36 });
  });

  it("alt wins over shift", () => {
    expect(snapDragPosition(36, 36, scale, { shift: true, alt: true })).toEqual({ x: 18, y: 18 });
  });
});
