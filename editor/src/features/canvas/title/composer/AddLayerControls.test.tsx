import { act, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { useUiStore } from "@/state/uiStore";

import { AddLayerControls } from "./AddLayerControls";

/**
 * jsdom doesn't implement PointerEvent — synthesize one that fireEvent
 * understands. We pass `clientX`/`clientY` through the EventInit and
 * mark it as a PointerEventInit. The event constructor we register
 * below mirrors the relevant fields onto the instance.
 */
class PointerEventStub extends MouseEvent {
  pointerId: number;
  pointerType: string;
  constructor(type: string, init: PointerEventInit = {}) {
    super(type, init);
    this.pointerId = init.pointerId ?? 1;
    this.pointerType = init.pointerType ?? "mouse";
  }
}

beforeEach(() => {
  // Reset the dragging store so tests don't bleed.
  useUiStore.setState({ draggingNewLayer: null } as any);
  // Polyfill PointerEvent for jsdom so window.dispatchEvent works.
  if (typeof (globalThis as any).PointerEvent === "undefined") {
    (globalThis as any).PointerEvent = PointerEventStub;
  }
  // Stub setPointerCapture/releasePointerCapture — jsdom doesn't implement them.
  if (!HTMLElement.prototype.setPointerCapture) {
    HTMLElement.prototype.setPointerCapture = function () {};
  }
  if (!HTMLElement.prototype.releasePointerCapture) {
    HTMLElement.prototype.releasePointerCapture = function () {};
  }
});

afterEach(() => {
  vi.restoreAllMocks();
});

function dispatchWindowPointer(type: "pointermove" | "pointerup", x: number, y: number) {
  const evt = new (globalThis as any).PointerEvent(type, {
    clientX: x,
    clientY: y,
    bubbles: true,
    pointerId: 1,
  });
  act(() => {
    window.dispatchEvent(evt);
  });
}

describe("AddLayerControls", () => {
  it("renders only + Image and the unified + Texte button", () => {
    render(<AddLayerControls onPlace={() => {}} />);
    expect(screen.getByTestId("add-layer-image")).toBeInTheDocument();
    expect(screen.getByTestId("add-layer-text")).toBeInTheDocument();
    expect(screen.queryByTestId("add-layer-textarea")).toBeNull();
  });

  it("click on + Image (pointerdown + pointerup at same position) fires onPlace('image', null)", () => {
    const onPlace = vi.fn();
    render(<AddLayerControls onPlace={onPlace} />);
    const btn = screen.getByTestId("add-layer-image");
    fireEvent.pointerDown(btn, { clientX: 10, clientY: 10, pointerId: 1 });
    dispatchWindowPointer("pointerup", 10, 10);
    expect(onPlace).toHaveBeenCalledTimes(1);
    expect(onPlace).toHaveBeenCalledWith("image", null);
  });

  it("click on + Text (pointerdown + pointerup at same position) fires onPlace('text', null)", () => {
    const onPlace = vi.fn();
    render(<AddLayerControls onPlace={onPlace} />);
    const btn = screen.getByTestId("add-layer-text");
    fireEvent.pointerDown(btn, { clientX: 10, clientY: 10, pointerId: 1 });
    dispatchWindowPointer("pointerup", 10, 10);
    expect(onPlace).toHaveBeenCalledTimes(1);
    expect(onPlace).toHaveBeenCalledWith("text", null);
  });


  it("pointerdown + significant move + pointerup fires onPlace(kind, { x, y })", () => {
    const onPlace = vi.fn();
    render(<AddLayerControls onPlace={onPlace} />);
    const btn = screen.getByTestId("add-layer-image");
    fireEvent.pointerDown(btn, { clientX: 10, clientY: 10, pointerId: 1 });
    dispatchWindowPointer("pointermove", 100, 100);
    dispatchWindowPointer("pointerup", 100, 100);
    expect(onPlace).toHaveBeenCalledTimes(1);
    expect(onPlace).toHaveBeenCalledWith("image", { x: 100, y: 100 });
  });

  it("pointerdown + tiny move + pointerup (< threshold) fires onPlace(kind, null)", () => {
    const onPlace = vi.fn();
    render(<AddLayerControls onPlace={onPlace} />);
    const btn = screen.getByTestId("add-layer-text");
    fireEvent.pointerDown(btn, { clientX: 10, clientY: 10, pointerId: 1 });
    dispatchWindowPointer("pointermove", 12, 11);
    dispatchWindowPointer("pointerup", 12, 11);
    expect(onPlace).toHaveBeenCalledTimes(1);
    expect(onPlace).toHaveBeenCalledWith("text", null);
  });

  it("during drag, useUiStore.draggingNewLayer is set to the current cursor position", () => {
    render(<AddLayerControls onPlace={() => {}} />);
    const btn = screen.getByTestId("add-layer-image");
    fireEvent.pointerDown(btn, { clientX: 10, clientY: 10, pointerId: 1 });
    dispatchWindowPointer("pointermove", 80, 90);
    expect(useUiStore.getState().draggingNewLayer).toEqual({ kind: "image", x: 80, y: 90 });
    dispatchWindowPointer("pointermove", 200, 220);
    expect(useUiStore.getState().draggingNewLayer).toEqual({ kind: "image", x: 200, y: 220 });
  });

  it("at pointerup, useUiStore.draggingNewLayer is reset to null", () => {
    render(<AddLayerControls onPlace={() => {}} />);
    const btn = screen.getByTestId("add-layer-text");
    fireEvent.pointerDown(btn, { clientX: 10, clientY: 10, pointerId: 1 });
    dispatchWindowPointer("pointermove", 100, 100);
    expect(useUiStore.getState().draggingNewLayer).not.toBeNull();
    dispatchWindowPointer("pointerup", 100, 100);
    expect(useUiStore.getState().draggingNewLayer).toBeNull();
  });

  it("draggingNewLayer is also reset to null when the gesture ends as a click (no significant move)", () => {
    render(<AddLayerControls onPlace={() => {}} />);
    const btn = screen.getByTestId("add-layer-image");
    fireEvent.pointerDown(btn, { clientX: 10, clientY: 10, pointerId: 1 });
    dispatchWindowPointer("pointerup", 11, 11);
    expect(useUiStore.getState().draggingNewLayer).toBeNull();
  });

  it("dragging away from a button doesn't trigger the other button's onPlace", () => {
    const onPlace = vi.fn();
    render(<AddLayerControls onPlace={onPlace} />);
    const imageBtn = screen.getByTestId("add-layer-image");
    fireEvent.pointerDown(imageBtn, { clientX: 10, clientY: 10, pointerId: 1 });
    dispatchWindowPointer("pointermove", 200, 200);
    dispatchWindowPointer("pointerup", 200, 200);
    // Exactly one call, and it's for "image" (not "text").
    expect(onPlace).toHaveBeenCalledTimes(1);
    expect(onPlace.mock.calls[0]?.[0]).toBe("image");
  });

  it("unmounting mid-drag clears draggingNewLayer (no leaked global state)", () => {
    const { unmount } = render(<AddLayerControls onPlace={() => {}} />);
    fireEvent.pointerDown(screen.getByTestId("add-layer-image"), {
      clientX: 10,
      clientY: 10,
      pointerId: 1,
    });
    dispatchWindowPointer("pointermove", 100, 100);
    expect(useUiStore.getState().draggingNewLayer).not.toBeNull();
    unmount();
    expect(useUiStore.getState().draggingNewLayer).toBeNull();
  });

  // --- Keyboard accessibility (P1.7 fix) ---

  it("Enter key on focused + Image button calls onPlace('image', null)", () => {
    const onPlace = vi.fn();
    render(<AddLayerControls onPlace={onPlace} />);
    const btn = screen.getByTestId("add-layer-image");
    // Browsers synthesize a `click` event with detail === 0 when a focused
    // <button> is activated via Enter or Space.
    fireEvent.click(btn, { detail: 0 });
    expect(onPlace).toHaveBeenCalledTimes(1);
    expect(onPlace).toHaveBeenCalledWith("image", null);
  });

  it("Enter key on focused + Text button calls onPlace('text', null)", () => {
    const onPlace = vi.fn();
    render(<AddLayerControls onPlace={onPlace} />);
    const btn = screen.getByTestId("add-layer-text");
    fireEvent.click(btn, { detail: 0 });
    expect(onPlace).toHaveBeenCalledTimes(1);
    expect(onPlace).toHaveBeenCalledWith("text", null);
  });


  it("pointerdown + pointerup + synthetic click (detail >= 1) fires onPlace exactly once", () => {
    // Reproduces the full browser sequence for a real mouse click:
    // pointerdown → pointerup → click (with detail = 1). The pointerup
    // handler resolves the gesture and invokes onPlace; the synthetic
    // click that follows must NOT double-fire.
    const onPlace = vi.fn();
    render(<AddLayerControls onPlace={onPlace} />);
    const btn = screen.getByTestId("add-layer-image");
    fireEvent.pointerDown(btn, { clientX: 10, clientY: 10, pointerId: 1 });
    dispatchWindowPointer("pointerup", 10, 10);
    // The browser would now dispatch a click with detail = 1; mimic that.
    fireEvent.click(btn, { detail: 1 });
    expect(onPlace).toHaveBeenCalledTimes(1);
    expect(onPlace).toHaveBeenCalledWith("image", null);
  });
});
