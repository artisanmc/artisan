import type { Asset } from "@/domain/asset";
import type { Modifier } from "@dnd-kit/core";
import { afterEach, expect, it } from "vitest";
import { draggableProps } from "./dragPayload";
import { anchorImageDragToCursor } from "./imageButtonDrag";
import { setStageGeometryProvider } from "./stageGeometry";

afterEach(() => setStageGeometryProvider(null));

function drag(start: { x: number; y: number }, scale: number) {
  setStageGeometryProvider(() => ({
    viewport: { x: 0, y: 0, scale },
    wrapperRect: { left: 0, top: 0, right: 1000, bottom: 800 },
  }));
  const args: Parameters<Modifier>[0] = {
    activatorEvent: new MouseEvent("mousedown", { clientX: start.x, clientY: start.y }),
    active: {
      id: "image",
      data: {
        current: draggableProps({
          kind: "imageButton",
          asset: { id: "a1", projectId: "p1", width: 48, height: 16 } as Asset,
        }).data,
      },
      rect: { current: { initial: null, translated: null } },
    },
    activeNodeRect: { left: 20, top: 100, width: 96, height: 108, right: 116, bottom: 208 },
    draggingNodeRect: null,
    containerNodeRect: null,
    over: null,
    overlayNodeRect: null,
    scrollableAncestors: [],
    scrollableAncestorRects: [],
    transform: { x: 500 - start.x, y: 350 - start.y, scaleX: 1, scaleY: 1 },
    windowRect: null,
  };
  return args;
}

it.each([0.5, 1, 2.5])(
  "centers the image on the same cursor when grabbed by thumbnail, name or badge at zoom %s",
  (scale) => {
    for (const start of [
      { x: 60, y: 125 },
      { x: 60, y: 178 },
      { x: 100, y: 200 },
    ]) {
      const result = anchorImageDragToCursor(drag(start, scale));
      expect(20 + result.x + (48 * 2 * scale) / 2).toBe(500);
      expect(100 + result.y + (16 * 2 * scale) / 2).toBe(350);
    }
  },
);

it("leaves other drags and keyboard activation unchanged", () => {
  const args = drag({ x: 60, y: 178 }, 1);
  expect(anchorImageDragToCursor({ ...args, active: null })).toBe(args.transform);
  expect(anchorImageDragToCursor({ ...args, activatorEvent: new KeyboardEvent("keydown") })).toBe(
    args.transform,
  );
});
