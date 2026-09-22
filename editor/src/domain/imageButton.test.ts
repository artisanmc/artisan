import { describe, expect, it } from "vitest";
import { imageButtonRect, imageButtonSize, rectanglePositions } from "./imageButton";

describe("image button footprint", () => {
  it.each([
    [8, 8, 1, 1],
    [16, 48, 1, 3],
    [48, 16, 3, 1],
    [32, 32, 2, 2],
    [17, 33, 2, 3],
  ])("uses the source pixels to reserve slots for a %i x %i image", (width, height, cols, rows) => {
    expect(imageButtonSize(width, height)).toEqual({ width: cols, height: rows });
  });
  it.each([
    [2, 1],
    [1, 2],
    [2, 2],
    [3, 2],
    [2, 3],
  ])("covers a %i by %i rectangle once", (width, height) => {
    const positions = rectanglePositions(10, width, height, "chest", 6);
    expect(imageButtonRect(positions, "chest", 6)).toEqual({ slot: 10, width, height });
  });
  it("rejects wrapping, holes, fractional sizes and positions outside the menu", () => {
    expect(() => rectanglePositions(8, 2, 1, "chest", 3)).toThrow();
    expect(() => rectanglePositions(0, 1.5, 2, "chest", 3)).toThrow();
    expect(imageButtonRect("0,2", "chest", 3)).toBeNull();
    expect(imageButtonRect("26,35", "chest", 3)).toBeNull();
  });
  it("uses the hopper and dropper grids", () => {
    expect(rectanglePositions(0, 2, 3, "dropper", 1)).toBe("0-1,3-4,6-7");
    expect(() => rectanglePositions(0, 2, 2, "hopper", 1)).toThrow();
  });
});
