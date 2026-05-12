import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { ResizeHandles } from "./ResizeHandles";

// react-konva mock — renders each Rect as a div carrying the props the
// component sets on it (x/y/width/height/fill/stroke/cursor) plus the drag
// handlers. Each anchor div also gets `data-corner` so tests can target a
// specific corner.
//
// We simulate Konva's drag protocol by:
//  - "drag start"  → fireEvent.dragStart on the anchor div
//  - "drag move"   → fireEvent.drag with custom clientX/clientY (relayed via
//                    the mock's onDragMove handler with a fake target)
//  - "drag end"    → fireEvent.dragEnd
// The mock exposes `data-x` / `data-y` on each anchor so we know the starting
// stage coordinates, then forwards the simulated mouse position to the
// component's drag handler via a synthetic event whose `target.x()` and
// `target.y()` return the position attached to `__pos`.
//
// This stays close to how the production code reads drag positions —
// `e.target.x()` / `e.target.y()` — without spinning up a real stage.
vi.mock("react-konva", () => {
  const Rect = (props: {
    x?: number;
    y?: number;
    width?: number;
    height?: number;
    fill?: string;
    stroke?: string;
    draggable?: boolean;
    onDragMove?: (e: {
      evt: MouseEvent;
      target: { x: () => number; y: () => number; position: (p: { x: number; y: number }) => void };
    }) => void;
    onDragEnd?: (e: {
      evt: MouseEvent;
      target: { x: () => number; y: () => number; position: (p: { x: number; y: number }) => void };
    }) => void;
    onMouseEnter?: (e: {
      target: { getStage: () => { container: () => { style: { cursor: string } } } | null };
    }) => void;
    onMouseLeave?: (e: {
      target: { getStage: () => { container: () => { style: { cursor: string } } } | null };
    }) => void;
    [k: string]: unknown;
  }) => {
    return (
      <div
        data-testid="konva-rect"
        data-x={props.x}
        data-y={props.y}
        data-width={props.width}
        data-height={props.height}
        data-fill={props.fill}
        data-stroke={props.stroke}
        data-draggable={props.draggable ? "true" : "false"}
        data-corner={(props as { "data-corner"?: string })["data-corner"]}
        data-cursor={(props as { "data-cursor"?: string })["data-cursor"]}
        onMouseDown={(e) => {
          // Capture initial cursor position on the element for later math.
          (e.currentTarget as unknown as { __startX: number }).__startX = e.clientX;
          (e.currentTarget as unknown as { __startY: number }).__startY = e.clientY;
        }}
        onMouseMove={(e) => {
          if (!props.onDragMove) return;
          // Bail unless a drag is in progress (we only set __startX on mousedown).
          if ((e.currentTarget as unknown as { __startX?: number }).__startX === undefined) {
            return;
          }
          const evt = { shiftKey: e.shiftKey, altKey: e.altKey } as MouseEvent;
          const x = e.clientX;
          const y = e.clientY;
          props.onDragMove({
            evt,
            target: {
              x: () => x,
              y: () => y,
              position: () => {},
            },
          });
        }}
        onMouseUp={(e) => {
          if (!props.onDragEnd) return;
          if ((e.currentTarget as unknown as { __startX?: number }).__startX === undefined) {
            return;
          }
          const evt = { shiftKey: e.shiftKey, altKey: e.altKey } as MouseEvent;
          const x = e.clientX;
          const y = e.clientY;
          (e.currentTarget as unknown as { __startX?: number }).__startX = undefined;
          (e.currentTarget as unknown as { __startY?: number }).__startY = undefined;
          props.onDragEnd({
            evt,
            target: {
              x: () => x,
              y: () => y,
              position: () => {},
            },
          });
        }}
      />
    );
  };
  const Group = ({ children }: { children: React.ReactNode }) => (
    <div data-testid="konva-group">{children}</div>
  );
  return { Rect, Group };
});

function dragAnchor(el: HTMLElement, to: { clientX: number; clientY: number; shiftKey?: boolean }) {
  // Down at (0,0) — only existence matters for our mock's start gate.
  fireEvent.mouseDown(el, { clientX: 0, clientY: 0 });
  fireEvent.mouseMove(el, {
    clientX: to.clientX,
    clientY: to.clientY,
    shiftKey: to.shiftKey ?? false,
  });
  fireEvent.mouseUp(el, {
    clientX: to.clientX,
    clientY: to.clientY,
    shiftKey: to.shiftKey ?? false,
  });
}

function dragAnchorMoveOnly(
  el: HTMLElement,
  to: { clientX: number; clientY: number; shiftKey?: boolean },
) {
  fireEvent.mouseDown(el, { clientX: 0, clientY: 0 });
  fireEvent.mouseMove(el, {
    clientX: to.clientX,
    clientY: to.clientY,
    shiftKey: to.shiftKey ?? false,
  });
  // No mouseUp — caller decides when to end the drag.
}

describe("ResizeHandles", () => {
  it("renders 4 anchors at the 4 corners of the bounding rect", () => {
    render(<ResizeHandles x={10} y={20} width={100} height={50} onResize={() => {}} />);
    const anchors = screen.getAllByTestId("konva-rect");
    expect(anchors).toHaveLength(4);

    const byCorner = new Map<string, HTMLElement>();
    for (const a of anchors) {
      byCorner.set(a.getAttribute("data-corner") ?? "", a);
    }
    expect(byCorner.size).toBe(4);

    // Anchors are 8x8 centered on each corner → offset by -4.
    const ANCHOR_OFFSET = -4;
    expect(byCorner.get("nw")?.getAttribute("data-x")).toBe(String(10 + ANCHOR_OFFSET));
    expect(byCorner.get("nw")?.getAttribute("data-y")).toBe(String(20 + ANCHOR_OFFSET));
    expect(byCorner.get("ne")?.getAttribute("data-x")).toBe(String(10 + 100 + ANCHOR_OFFSET));
    expect(byCorner.get("ne")?.getAttribute("data-y")).toBe(String(20 + ANCHOR_OFFSET));
    expect(byCorner.get("sw")?.getAttribute("data-x")).toBe(String(10 + ANCHOR_OFFSET));
    expect(byCorner.get("sw")?.getAttribute("data-y")).toBe(String(20 + 50 + ANCHOR_OFFSET));
    expect(byCorner.get("se")?.getAttribute("data-x")).toBe(String(10 + 100 + ANCHOR_OFFSET));
    expect(byCorner.get("se")?.getAttribute("data-y")).toBe(String(20 + 50 + ANCHOR_OFFSET));
  });

  it("anchors have the expected visual styling (8x8, white fill, black stroke, draggable)", () => {
    render(<ResizeHandles x={0} y={0} width={50} height={50} onResize={() => {}} />);
    const anchors = screen.getAllByTestId("konva-rect");
    for (const a of anchors) {
      expect(a.getAttribute("data-width")).toBe("8");
      expect(a.getAttribute("data-height")).toBe("8");
      expect(a.getAttribute("data-fill")).toBe("#ffffff");
      expect(a.getAttribute("data-stroke")).toBe("#000000");
      expect(a.getAttribute("data-draggable")).toBe("true");
    }
  });

  it("opposing corners advertise nwse-resize / nesw-resize cursors", () => {
    render(<ResizeHandles x={0} y={0} width={50} height={50} onResize={() => {}} />);
    const anchors = screen.getAllByTestId("konva-rect");
    const cursors = new Map<string, string>();
    for (const a of anchors) {
      cursors.set(a.getAttribute("data-corner") ?? "", a.getAttribute("data-cursor") ?? "");
    }
    expect(cursors.get("nw")).toBe("nwse-resize");
    expect(cursors.get("se")).toBe("nwse-resize");
    expect(cursors.get("ne")).toBe("nesw-resize");
    expect(cursors.get("sw")).toBe("nesw-resize");
  });

  it("dragging SE anchor outward emits aspect-preserved dimensions", () => {
    // Bounding box: (0,0) → (100, 50). Aspect = 2.
    // Drag SE to (200, 100). Opposite corner = NW at (0, 0).
    //   dx = 200, dy = 100. dx/origW = 2.0; dy/origH = 2.0 — equal.
    // → new width = 200, new height = 100 (aspect preserved).
    const onResize = vi.fn();
    render(<ResizeHandles x={0} y={0} width={100} height={50} onResize={onResize} />);
    const anchors = screen.getAllByTestId("konva-rect");
    const se = anchors.find((a) => a.getAttribute("data-corner") === "se")!;
    dragAnchor(se, { clientX: 200, clientY: 100 });

    expect(onResize).toHaveBeenCalled();
    const last = onResize.mock.calls[onResize.mock.calls.length - 1]![0] as {
      width: number;
      height: number;
    };
    expect(last.width).toBeCloseTo(200);
    expect(last.height).toBeCloseTo(100);
  });

  it("when dx-proportion > dy-proportion, width wins and height snaps to aspect", () => {
    // Original: 100 × 50, aspect = 2.
    // Drag SE to (300, 80). Opposite = NW at (0,0).
    //   dx/origW = 3.0; dy/origH = 1.6. Width wins.
    // → width = 300, height = 300 / 2 = 150.
    const onResize = vi.fn();
    render(<ResizeHandles x={0} y={0} width={100} height={50} onResize={onResize} />);
    const se = screen
      .getAllByTestId("konva-rect")
      .find((a) => a.getAttribute("data-corner") === "se")!;
    dragAnchor(se, { clientX: 300, clientY: 80 });

    const last = onResize.mock.calls[onResize.mock.calls.length - 1]![0] as {
      width: number;
      height: number;
    };
    expect(last.width).toBeCloseTo(300);
    expect(last.height).toBeCloseTo(150);
  });

  it("when dy-proportion > dx-proportion, height wins and width snaps to aspect", () => {
    // Original 100×50, aspect = 2.
    // Drag SE to (110, 200). Opposite NW = (0, 0).
    //   dx/origW = 1.1; dy/origH = 4.0. Height wins.
    // → height = 200, width = 200 * 2 = 400.
    const onResize = vi.fn();
    render(<ResizeHandles x={0} y={0} width={100} height={50} onResize={onResize} />);
    const se = screen
      .getAllByTestId("konva-rect")
      .find((a) => a.getAttribute("data-corner") === "se")!;
    dragAnchor(se, { clientX: 110, clientY: 200 });

    const last = onResize.mock.calls[onResize.mock.calls.length - 1]![0] as {
      width: number;
      height: number;
    };
    expect(last.height).toBeCloseTo(200);
    expect(last.width).toBeCloseTo(400);
  });

  it("dragging NW (opposite SE fixed) shrinks dimensions correctly", () => {
    // Original (0,0)→(100,50), aspect = 2. SE opposite stays at (100, 50).
    // Drag NW to (50, 25). dx = |50 - 100| = 50, dy = |25 - 50| = 25.
    //   dx/origW = 0.5; dy/origH = 0.5 — tie → width wins (our rule).
    // → width = 50, height = 25.
    const onResize = vi.fn();
    render(<ResizeHandles x={0} y={0} width={100} height={50} onResize={onResize} />);
    const nw = screen
      .getAllByTestId("konva-rect")
      .find((a) => a.getAttribute("data-corner") === "nw")!;
    dragAnchor(nw, { clientX: 50, clientY: 25 });

    const last = onResize.mock.calls[onResize.mock.calls.length - 1]![0] as {
      width: number;
      height: number;
    };
    expect(last.width).toBeCloseTo(50);
    expect(last.height).toBeCloseTo(25);
  });

  it("emits onResize continuously during drag (every move)", () => {
    const onResize = vi.fn();
    render(<ResizeHandles x={0} y={0} width={100} height={50} onResize={onResize} />);
    const se = screen
      .getAllByTestId("konva-rect")
      .find((a) => a.getAttribute("data-corner") === "se")!;

    fireEvent.mouseDown(se, { clientX: 0, clientY: 0 });
    fireEvent.mouseMove(se, { clientX: 120, clientY: 60 });
    fireEvent.mouseMove(se, { clientX: 200, clientY: 100 });
    fireEvent.mouseMove(se, { clientX: 300, clientY: 150 });

    expect(onResize).toHaveBeenCalledTimes(3);
  });

  it("emits onResizeEnd exactly once on drag end with the final dimensions", () => {
    const onResize = vi.fn();
    const onResizeEnd = vi.fn();
    render(
      <ResizeHandles
        x={0}
        y={0}
        width={100}
        height={50}
        onResize={onResize}
        onResizeEnd={onResizeEnd}
      />,
    );
    const se = screen
      .getAllByTestId("konva-rect")
      .find((a) => a.getAttribute("data-corner") === "se")!;
    dragAnchor(se, { clientX: 300, clientY: 150 });

    expect(onResizeEnd).toHaveBeenCalledTimes(1);
    const final = onResizeEnd.mock.calls[0]![0] as { width: number; height: number };
    expect(final.width).toBeCloseTo(300);
    expect(final.height).toBeCloseTo(150);
  });

  it("clamps to a minimum size of 4 px on either axis", () => {
    // Original 100×50, aspect = 2. Drag SE inward past origin.
    // Target (1, 1). Opposite NW = (0, 0). dx = 1, dy = 1.
    //   dx/origW = 0.01, dy/origH = 0.02. Height wins → height = 1 → clamp to 4.
    //   width = 4 * 2 = 8.
    const onResize = vi.fn();
    render(<ResizeHandles x={0} y={0} width={100} height={50} onResize={onResize} />);
    const se = screen
      .getAllByTestId("konva-rect")
      .find((a) => a.getAttribute("data-corner") === "se")!;
    dragAnchor(se, { clientX: 1, clientY: 1 });

    const last = onResize.mock.calls[onResize.mock.calls.length - 1]![0] as {
      width: number;
      height: number;
    };
    // Minimum size constraint kicks in: both axes ≥ 4.
    expect(last.width).toBeGreaterThanOrEqual(4);
    expect(last.height).toBeGreaterThanOrEqual(4);
    // And the aspect ratio is still preserved when clamped.
    expect(last.width / last.height).toBeCloseTo(2);
  });

  it("shift held during drag is a no-op (still aspect-locked)", () => {
    // Original 100×50, aspect = 2.
    // Drag SE to (200, 200) with shift held. Without shift handling:
    //   dx/origW = 2.0; dy/origH = 4.0. Height wins → 200/400.
    // With (hypothetical) shift-stretch, this would NOT be aspect-locked.
    // We assert aspect IS preserved with shift held.
    const onResize = vi.fn();
    render(<ResizeHandles x={0} y={0} width={100} height={50} onResize={onResize} />);
    const se = screen
      .getAllByTestId("konva-rect")
      .find((a) => a.getAttribute("data-corner") === "se")!;
    dragAnchor(se, { clientX: 200, clientY: 200, shiftKey: true });

    const last = onResize.mock.calls[onResize.mock.calls.length - 1]![0] as {
      width: number;
      height: number;
    };
    expect(last.width / last.height).toBeCloseTo(2);
  });

  it("does not emit onResizeEnd when no drag end fires", () => {
    const onResizeEnd = vi.fn();
    render(
      <ResizeHandles
        x={0}
        y={0}
        width={100}
        height={50}
        onResize={() => {}}
        onResizeEnd={onResizeEnd}
      />,
    );
    const se = screen
      .getAllByTestId("konva-rect")
      .find((a) => a.getAttribute("data-corner") === "se")!;
    dragAnchorMoveOnly(se, { clientX: 200, clientY: 100 });
    expect(onResizeEnd).not.toHaveBeenCalled();
  });
});
