import type { Asset } from "@/domain/asset";
import type { ElementId, MenuId } from "@/domain/types";
import { draggableProps, droppableProps } from "@/features/canvas/dragPayload";
import { describe, expect, it } from "vitest";
import { type DragEndFields, decodeDragEnd, dragStartMaterial } from "./workspaceDrop";

const pointer = { clientX: 10, clientY: 20 } as unknown as Event;

const carrier = (props: { data: object }) => ({
  data: { current: props.data as Record<string, unknown> },
});

function end(fields: Partial<DragEndFields>): DragEndFields {
  return {
    active: null,
    over: null,
    activatorEvent: pointer,
    delta: { x: 5, y: 7 },
    ...fields,
  };
}

const menuId = "m1" as MenuId;
const elementId = "e1" as ElementId;
const row = { menuId, elementId, key: "k", material: "STONE" };
const diamond = carrier(draggableProps({ kind: "material", material: "DIAMOND" }));
const rowDrag = carrier(draggableProps({ kind: "placementRow", ...row }));
const asset = { id: "a1", projectId: "p" } as unknown as Asset;
const imageDrag = carrier(draggableProps({ kind: "imageButton", asset }));

describe("dragStartMaterial", () => {
  it("shows the library material, the row's preview material, or nothing", () => {
    expect(dragStartMaterial(diamond)).toBe("DIAMOND");
    expect(dragStartMaterial(rowDrag)).toBe("STONE");
    expect(
      dragStartMaterial(carrier(draggableProps({ kind: "placementRow", ...row, material: "" }))),
    ).toBe("CHEST");
    expect(dragStartMaterial(imageDrag)).toBeUndefined();
  });
});

describe("decodeDragEnd", () => {
  it("drops a library material on the board at the release point", () => {
    expect(decodeDragEnd(end({ active: diamond }))).toEqual({
      kind: "stageMaterial",
      material: "DIAMOND",
      x: 15,
      y: 27,
    });
  });

  it("sets a state card's material when released over it", () => {
    const over = carrier(
      droppableProps({ kind: "stateMaterial", menuId, elementId, stateIndex: 2 }),
    );
    expect(decodeDragEnd(end({ active: diamond, over }))).toEqual({
      kind: "stateMaterial",
      material: "DIAMOND",
      menuId: "m1",
      elementId: "e1",
      stateIndex: 2,
    });
    // A target that is not a state card falls back to the board.
    expect(decodeDragEnd(end({ active: diamond, over: { data: { current: {} } } }))?.kind).toBe(
      "stageMaterial",
    );
  });

  it("releases an image button from the first touch or the mouse", () => {
    const touch = { touches: [{ clientX: 1, clientY: 2 }] } as unknown as Event;
    expect(decodeDragEnd(end({ active: imageDrag, activatorEvent: touch }))).toEqual({
      kind: "imageButton",
      asset,
      x: 6,
      y: 9,
    });
    expect(
      decodeDragEnd(
        end({ active: imageDrag, activatorEvent: { touches: [] } as unknown as Event }),
      ),
    ).toBeNull();
  });

  it("carries a placement row to its release point", () => {
    expect(decodeDragEnd(end({ active: rowDrag }))).toEqual({
      kind: "placementRow",
      row,
      x: 15,
      y: 27,
    });
  });

  it("ignores any other drag", () => {
    expect(decodeDragEnd(end({ active: { data: { current: {} } } }))).toBeNull();
  });
});
