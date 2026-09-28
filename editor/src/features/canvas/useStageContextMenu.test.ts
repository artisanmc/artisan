import type { Project } from "@/domain/types";
import { useSelectionStore } from "@/state/selectionStore";
import { act, renderHook } from "@testing-library/react";
import type Konva from "konva";
import { expect, it } from "vitest";
import { INVENTORY_TYPES } from "./inventoryTypes";
import { TEX_SCALE } from "./menuLayout";
import { useStageContextMenu } from "./useStageContextMenu";

it("keeps a multiple-menu selection when its context menu opens over a slot", () => {
  const project = {
    menus: [
      { id: "a", rows: 3, layers: [] },
      { id: "b", rows: 3, layers: [] },
    ],
  } as unknown as Project;
  useSelectionStore.getState().set(["a", "b"]);
  const wrapper = document.createElement("div");
  const { result } = renderHook(() =>
    useStageContextMenu({
      project,
      layout: { a: { x: 0, y: 0 }, b: { x: 600, y: 0 } },
      viewport: { x: 0, y: 0, scale: 1 },
      wrapperRef: { current: wrapper },
      stageRef: { current: {} as Konva.Stage },
    }),
  );
  act(() =>
    result.current.openContextMenuAt(
      INVENTORY_TYPES.chest.firstSlotX * TEX_SCALE + 1,
      INVENTORY_TYPES.chest.firstSlotY * TEX_SCALE + 1,
    ),
  );
  expect(result.current.ctxMenu.target).toEqual({ kind: "entity", selectedIds: ["a", "b"] });
});
