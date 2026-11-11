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

// PointerEvent isn't constructible in jsdom; a MouseEvent on a pointer-type
// carries button/clientX/clientY, which is all the hook reads.
function pdown(target: Element, button: number, clientX: number, clientY: number) {
  const e = new MouseEvent("pointerdown", {
    button,
    clientX,
    clientY,
    cancelable: true,
    bubbles: true,
  });
  act(() => {
    target.dispatchEvent(e);
  });
  return e;
}

describe("useMiddleClickPan", () => {
  it("ignores non-middle buttons", () => {
    const { child, setViewport, result } = setup();
    const e = pdown(child, 0, 10, 10);
    expect(e.defaultPrevented).toBe(false);
    expect(result.current.panning).toBe(false);
    expect(setViewport).not.toHaveBeenCalled();
  });

  it("ignores middle clicks outside the canvas wrapper", () => {
    const { result } = setup();
    const outside = document.createElement("div");
    document.body.appendChild(outside);
    const e = pdown(outside, 1, 5, 5);
    expect(e.defaultPrevented).toBe(false);
    expect(result.current.panning).toBe(false);
  });

  it("middle-drag inside the canvas pans by the screen delta (preventing autoscroll)", () => {
    const { child, setViewport, result } = setup({ x: 100, y: 50, scale: 2 });
    const e = pdown(child, 1, 200, 200);
    expect(e.defaultPrevented).toBe(true);
    expect(result.current.panning).toBe(true);

    act(() => window.dispatchEvent(new MouseEvent("pointermove", { clientX: 230, clientY: 180 })));
    // delta = (+30, -20); scale preserved.
    expect(setViewport).toHaveBeenLastCalledWith({ x: 130, y: 30, scale: 2 });

    act(() => window.dispatchEvent(new MouseEvent("pointerup")));
    expect(result.current.panning).toBe(false);
  });

  it("ends the pan even when the container swallows the middle button's release", () => {
    const { wrapper, child, result } = setup();
    // As `usePrimaryButtonOnly` does on the canvas container.
    wrapper.addEventListener(
      "pointerup",
      (e) => {
        if (e.button > 0) e.stopPropagation();
      },
      true,
    );
    pdown(child, 1, 0, 0);
    expect(result.current.panning).toBe(true);
    act(() => {
      child.dispatchEvent(new MouseEvent("pointerup", { button: 1, bubbles: true }));
    });
    expect(result.current.panning).toBe(false);
  });

  it("stops panning on window blur", () => {
    const { child, result } = setup();
    pdown(child, 1, 0, 0);
    expect(result.current.panning).toBe(true);
    act(() => window.dispatchEvent(new Event("blur")));
    expect(result.current.panning).toBe(false);
  });
});
