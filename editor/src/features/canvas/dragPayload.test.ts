import type { Asset } from "@/domain/asset";
import { elementId, menuId } from "@/domain/ids";
import { describe, expect, it } from "vitest";
import {
  type DragPayload,
  draggableProps,
  droppableProps,
  readDrag,
  readDrop,
} from "./dragPayload";

/** What dnd-kit hands back on an `Active` / `Over`: the `data` ref of the hook call. */
const carrier = (data: Record<string, unknown>) => ({ data: { current: data } });

describe("drag payloads", () => {
  const payloads: DragPayload[] = [
    { kind: "material", material: "item:shop:sword" },
    { kind: "imageButton", asset: { id: "a1", projectId: "p1", width: 16, height: 16 } as Asset },
    {
      kind: "placementRow",
      menuId: menuId("shop:main"),
      elementId: elementId("el:1"),
      key: "row:a",
      material: "PAPER",
    },
  ];

  it("round-trips every payload through dnd-kit's data, ids holding ':' included", () => {
    for (const payload of payloads) {
      expect(readDrag(carrier(draggableProps(payload).data))).toEqual(payload);
    }
  });

  it("gives distinct ids to payloads whose fields would collide once joined by ':'", () => {
    const a = draggableProps({
      kind: "placementRow",
      menuId: menuId("m"),
      elementId: elementId("a:b"),
      key: "c",
    });
    const b = draggableProps({
      kind: "placementRow",
      menuId: menuId("m"),
      elementId: elementId("a"),
      key: "b:c",
    });
    expect(a.id).not.toBe(b.id);
  });

  it("reads a state drop target back typed", () => {
    const drop = {
      kind: "stateMaterial",
      menuId: menuId("project:menu"),
      elementId: elementId("el_1"),
      stateIndex: 2,
    } as const;
    expect(readDrop(carrier(droppableProps(drop).data))).toEqual(drop);
  });

  it("returns null for a drag or a target this module did not produce", () => {
    expect(readDrag(null)).toBeNull();
    expect(readDrag(carrier({ sortable: {} }))).toBeNull();
    expect(readDrop(undefined)).toBeNull();
    expect(readDrop(carrier({}))).toBeNull();
  });
});
