import { act, renderHook } from "@testing-library/react";
import type React from "react";
import { describe, expect, it, vi } from "vitest";
import { useMiddleClickPan } from "./useMiddleClickPan";

function mdEvent(button: number, clientX: number, clientY: number) {
  const preventDefault = vi.fn();
  return {
    event: { button, clientX, clientY, preventDefault } as unknown as React.MouseEvent,
    preventDefault,
  };
}

describe("useMiddleClickPan", () => {
  it("ignores non-middle buttons", () => {
    const setViewport = vi.fn();
    const { result } = renderHook(() =>
      useMiddleClickPan({ viewport: { x: 0, y: 0, scale: 1 }, setViewport }),
    );
    const left = mdEvent(0, 10, 10);
    act(() => result.current.onMouseDown(left.event));
    expect(left.preventDefault).not.toHaveBeenCalled();
    expect(result.current.isPanning()).toBe(false);
  });

  it("middle-drag pans the viewport by the screen delta (preventing autoscroll)", () => {
    const setViewport = vi.fn();
    const { result } = renderHook(() =>
      useMiddleClickPan({ viewport: { x: 100, y: 50, scale: 2 }, setViewport }),
    );
    const mid = mdEvent(1, 200, 200);
    act(() => result.current.onMouseDown(mid.event));
    expect(mid.preventDefault).toHaveBeenCalled();
    expect(result.current.isPanning()).toBe(true);

    act(() => window.dispatchEvent(new MouseEvent("mousemove", { clientX: 230, clientY: 180 })));
    // delta = (+30, -20); scale preserved.
    expect(setViewport).toHaveBeenLastCalledWith({ x: 130, y: 30, scale: 2 });

    act(() => window.dispatchEvent(new MouseEvent("mouseup")));
    expect(result.current.isPanning()).toBe(false);
  });

  it("stops panning on window blur", () => {
    const setViewport = vi.fn();
    const { result } = renderHook(() =>
      useMiddleClickPan({ viewport: { x: 0, y: 0, scale: 1 }, setViewport }),
    );
    act(() => result.current.onMouseDown(mdEvent(1, 0, 0).event));
    expect(result.current.isPanning()).toBe(true);
    act(() => window.dispatchEvent(new Event("blur")));
    expect(result.current.isPanning()).toBe(false);
  });
});
