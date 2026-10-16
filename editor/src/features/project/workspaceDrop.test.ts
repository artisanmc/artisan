import { IMAGE_BUTTON_DRAG_PREFIX } from "@/features/canvas/ImageButtonLibrary";
import { LIBRARY_DRAG_PREFIX } from "@/features/canvas/Library";
import { PLACEMENT_ROW_DRAG_PREFIX } from "@/features/canvas/placementDrop";
import { STATE_DROP_PREFIX } from "@/lib/stateDropId";
import { describe, expect, it } from "vitest";
import { type DragEndFields, decodeDragEnd, dragStartMaterial } from "./workspaceDrop";

const pointer = { clientX: 10, clientY: 20 } as unknown as Event;

function end(fields: Partial<DragEndFields>): DragEndFields {
  return {
    activeId: "",
    activeData: undefined,
    overId: null,
    activatorEvent: pointer,
    delta: { x: 5, y: 7 },
    ...fields,
  };
}

const row = { menuId: "m1", elementId: "e1", key: "k", material: "STONE" };

describe("dragStartMaterial", () => {
  it("shows the library material, the row's preview material, or nothing", () => {
    expect(dragStartMaterial(`${LIBRARY_DRAG_PREFIX}DIAMOND`, undefined)).toBe("DIAMOND");
    expect(dragStartMaterial(PLACEMENT_ROW_DRAG_PREFIX, { placementRow: row })).toBe("STONE");
    expect(
      dragStartMaterial(PLACEMENT_ROW_DRAG_PREFIX, { placementRow: { ...row, material: "" } }),
    ).toBe("CHEST");
    expect(dragStartMaterial(`${IMAGE_BUTTON_DRAG_PREFIX}a1`, {})).toBeUndefined();
  });
});

describe("decodeDragEnd", () => {
  it("drops a library material on the board at the release point", () => {
    expect(decodeDragEnd(end({ activeId: `${LIBRARY_DRAG_PREFIX}DIAMOND` }))).toEqual({
      kind: "stageMaterial",
      material: "DIAMOND",
      x: 15,
      y: 27,
    });
  });

  it("sets a state card's material when released over it", () => {
    expect(
      decodeDragEnd(
        end({ activeId: `${LIBRARY_DRAG_PREFIX}DIAMOND`, overId: `${STATE_DROP_PREFIX}m1:e1:2` }),
      ),
    ).toEqual({
      kind: "stateMaterial",
      material: "DIAMOND",
      menuId: "m1",
      elementId: "e1",
      stateIndex: 2,
    });
    // A malformed target falls back to the board.
    expect(
      decodeDragEnd(
        end({ activeId: `${LIBRARY_DRAG_PREFIX}DIAMOND`, overId: `${STATE_DROP_PREFIX}m1` }),
      )?.kind,
    ).toBe("stageMaterial");
  });

  it("releases an image button from the first touch or the mouse", () => {
    const asset = { id: "a1" };
    const touch = { touches: [{ clientX: 1, clientY: 2 }] } as unknown as Event;
    expect(
      decodeDragEnd(
        end({
          activeId: `${IMAGE_BUTTON_DRAG_PREFIX}a1`,
          activeData: { imageButton: asset },
          activatorEvent: touch,
        }),
      ),
    ).toEqual({ kind: "imageButton", asset, x: 6, y: 9 });
    expect(
      decodeDragEnd(end({ activeId: `${IMAGE_BUTTON_DRAG_PREFIX}a1`, activeData: {} })),
    ).toBeNull();
    expect(
      decodeDragEnd(
        end({
          activeId: `${IMAGE_BUTTON_DRAG_PREFIX}a1`,
          activeData: { imageButton: asset },
          activatorEvent: { touches: [] } as unknown as Event,
        }),
      ),
    ).toBeNull();
  });

  it("carries a placement row to its release point", () => {
    expect(
      decodeDragEnd(
        end({ activeId: PLACEMENT_ROW_DRAG_PREFIX, activeData: { placementRow: row } }),
      ),
    ).toEqual({ kind: "placementRow", row, x: 15, y: 27 });
  });

  it("ignores any other drag", () => {
    expect(decodeDragEnd(end({ activeId: "something-else" }))).toBeNull();
  });
});
