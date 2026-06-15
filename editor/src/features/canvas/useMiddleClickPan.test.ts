import { act, renderHook } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { useMiddleClickPan } from "./useMiddleClickPan";

function setup(viewport = { x: 0, y: 0, scale: 1 }) {
  const wrapper = document.createElement("div");
  const child = document.createElement("canvas"); // stands in for the Konva canvas
  wrapper.appendChild(child);
  document.body.appendChild(wrapper);
  const containerRef = { current: wrapper } as React.RefObject<HTMLElement | null>;
  const setViewport = vi.fn();
  const { result } = renderHook(() => useMiddleClickPan({ containerRef, viewport, setViewport }));
  return { wrapper, child, setViewport, result };
}

afterEach(() => {
  document.body.innerHTML = "";
});

function down(target: Element, button: number, clientX: number, clientY: number) {
  const e = new MouseEvent("mousedown", { button, clientX, clientY, cancelable: true, bubbles: true });
  target.dispatchEvent(e);
  return e;
}

describe("useMiddleClickPan", () => {
  it("ignores non-middle buttons", () => {
    const { child, setViewport, result } = setup();
    const e = down(child, 0, 10, 10);
    expect(e.defaultPrevented).toBe(false);
    expect(result.current.isPanning()).toBe(false);
    expect(setViewport).not.toHaveBeenCalled();
  });

  it("ignores middle clicks outside the canvas wrapper", () => {
    const { result } = setup();
    const outside = document.createElement("div");
    document.body.appendChild(outside);
    const e = down(outside, 1, 5, 5);
    expect(e.defaultPrevented).toBe(false);
    expect(result.current.isPanning()).toBe(false);
  });

  it("middle-drag inside the canvas pans by the screen delta (preventing autoscroll)", () => {
    const { child, setViewport, result } = setup({ x: 100, y: 50, scale: 2 });
    const e = down(child, 1, 200, 200);
    expect(e.defaultPrevented).toBe(true);
    expect(result.current.isPanning()).toBe(true);

    act(() => window.dispatchEvent(new MouseEvent("mousemove", { clientX: 230, clientY: 180 })));
    // delta = (+30, -20); scale preserved.
    expect(setViewport).toHaveBeenLastCalledWith({ x: 130, y: 30, scale: 2 });

    act(() => window.dispatchEvent(new MouseEvent("mouseup")));
    expect(result.current.isPanning()).toBe(false);
  });

  it("stops panning on window blur", () => {
    const { child, result } = setup();
    down(child, 1, 0, 0);
    expect(result.current.isPanning()).toBe(true);
    act(() => window.dispatchEvent(new Event("blur")));
    expect(result.current.isPanning()).toBe(false);
  });
});
