import { describe, expect, it } from "vitest";
import {
  type Viewport,
  type WrapperRect,
  isInsideWrapper,
  screenToCanvasCoords,
} from "./screenToCanvasCoords";

const identity: Viewport = { x: 0, y: 0, scale: 1 };
const wrapper: WrapperRect = { left: 100, top: 50, right: 900, bottom: 650 };

describe("screenToCanvasCoords", () => {
  it("identity viewport: client - wrapper.topLeft", () => {
    const out = screenToCanvasCoords({ x: 250, y: 175 }, wrapper, identity);
    expect(out).toEqual({ x: 150, y: 125 });
  });

  it("pan offset only: subtracts pan after wrapper origin", () => {
    const viewport: Viewport = { x: 30, y: 20, scale: 1 };
    // client 250,175 → stage-local 150,125 → canvas (150-30, 125-20) = (120, 105)
    const out = screenToCanvasCoords({ x: 250, y: 175 }, wrapper, viewport);
    expect(out).toEqual({ x: 120, y: 105 });
  });

  it("scale only: divides by scale after wrapper origin", () => {
    const viewport: Viewport = { x: 0, y: 0, scale: 2 };
    // client 300,250 → stage-local 200,200 → canvas (200/2, 200/2) = (100, 100)
    const out = screenToCanvasCoords({ x: 300, y: 250 }, wrapper, viewport);
    expect(out).toEqual({ x: 100, y: 100 });
  });

  it("pan + scale combined", () => {
    const viewport: Viewport = { x: 50, y: 40, scale: 2 };
    // client 300,250 → stage-local 200,200 → canvas ((200-50)/2, (200-40)/2) = (75, 80)
    const out = screenToCanvasCoords({ x: 300, y: 250 }, wrapper, viewport);
    expect(out).toEqual({ x: 75, y: 80 });
  });

  it("out-of-bounds client point still maps to canvas space (no clamp)", () => {
    const out = screenToCanvasCoords({ x: 50, y: 25 }, wrapper, identity);
    expect(out).toEqual({ x: -50, y: -25 });
  });
});

describe("isInsideWrapper", () => {
  it("returns true for a point strictly inside", () => {
    expect(isInsideWrapper({ x: 500, y: 350 }, wrapper)).toBe(true);
  });

  it("treats the wrapper edges as inside", () => {
    expect(isInsideWrapper({ x: 100, y: 50 }, wrapper)).toBe(true);
    expect(isInsideWrapper({ x: 900, y: 650 }, wrapper)).toBe(true);
  });

  it("returns false when the point lies outside any edge", () => {
    expect(isInsideWrapper({ x: 99, y: 350 }, wrapper)).toBe(false);
    expect(isInsideWrapper({ x: 500, y: 49 }, wrapper)).toBe(false);
    expect(isInsideWrapper({ x: 901, y: 350 }, wrapper)).toBe(false);
    expect(isInsideWrapper({ x: 500, y: 651 }, wrapper)).toBe(false);
  });
});
