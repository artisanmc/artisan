import { act, renderHook } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { useMiddleClickPan } from "./useMiddleClickPan";

function setup(viewport = { x: 0, y: 0, scale: 1 }) {
  const el = document.createElement("div");
  document.body.appendChild(el);
  const containerRef = { current: el } as React.RefObject<HTMLElement | null>;
  const setViewport = vi.fn();
  const { result, rerender } = renderHook(
    (vp: typeof viewport) => useMiddleClickPan({ containerRef, viewport: vp, setViewport }),
    { initialProps: viewport },
  );
  return { el, setViewport, result, rerender };
}

function mousedown(el: HTMLElement, button: number, clientX: number, clientY: number) {
  const e = new MouseEvent("mousedown", { button, clientX, clientY, cancelable: true, bubbles: true });
  el.dispatchEvent(e);
  return e;
}

describe("useMiddleClickPan", () => {
  it("ignores non-middle buttons", () => {
    const { el, setViewport, result } = setup();
    const e = mousedown(el, 0, 10, 10);
    expect(e.defaultPrevented).toBe(false);
    expect(result.current.isPanning()).toBe(false);
    expect(setViewport).not.toHaveBeenCalled();
  });

  it("middle-drag pans the viewport by the screen delta (preventing autoscroll)", () => {
    const { el, setViewport, result } = setup({ x: 100, y: 50, scale: 2 });
    const e = mousedown(el, 1, 200, 200);
    expect(e.defaultPrevented).toBe(true);
    expect(result.current.isPanning()).toBe(true);

    act(() => window.dispatchEvent(new MouseEvent("mousemove", { clientX: 230, clientY: 180 })));
    // delta = (+30, -20); scale preserved.
    expect(setViewport).toHaveBeenLastCalledWith({ x: 130, y: 30, scale: 2 });

    act(() => window.dispatchEvent(new MouseEvent("mouseup")));
    expect(result.current.isPanning()).toBe(false);
  });

  it("stops panning on window blur", () => {
    const { el, result } = setup();
    mousedown(el, 1, 0, 0);
    expect(result.current.isPanning()).toBe(true);
    act(() => window.dispatchEvent(new Event("blur")));
    expect(result.current.isPanning()).toBe(false);
  });
});
