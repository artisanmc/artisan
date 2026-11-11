import { render } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import { WidthResizeHandle } from "./WidthResizeHandle";

// react-konva renders to canvas which is unavailable in jsdom. Replace with
// plain divs — smoke tests only need mount-without-throw.
vi.mock("react-konva", () => ({
  Rect: (props: Record<string, unknown>) => (
    <div data-testid="konva-rect" data-x={props.x} data-y={props.y} />
  ),
}));

describe("WidthResizeHandle", () => {
  it("mounts without throwing", () => {
    const onResize = vi.fn();
    render(<WidthResizeHandle x={100} y={10} height={30} currentWidth={100} onResize={onResize} />);
    expect(onResize).not.toHaveBeenCalled();
  });

  it("mounts with optional onResizeEnd handler", () => {
    const onResize = vi.fn();
    const onResizeEnd = vi.fn();
    render(
      <WidthResizeHandle
        x={100}
        y={10}
        height={30}
        currentWidth={100}
        onResize={onResize}
        onResizeEnd={onResizeEnd}
      />,
    );
    expect(onResize).not.toHaveBeenCalled();
    expect(onResizeEnd).not.toHaveBeenCalled();
  });

  it("accepts an optional scale prop for canvas-px to MC-px conversion", () => {
    const onResize = vi.fn();
    render(
      <WidthResizeHandle
        x={200}
        y={0}
        height={40}
        currentWidth={100}
        scale={2}
        onResize={onResize}
      />,
    );
    expect(onResize).not.toHaveBeenCalled();
  });
});
