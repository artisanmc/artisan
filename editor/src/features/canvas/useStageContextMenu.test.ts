import type { Project } from "@/domain/types";
import { useSelectionStore } from "@/state/selectionStore";
import { act, renderHook } from "@testing-library/react";
import type Konva from "konva";
import { expect, it } from "vitest";
import { INVENTORY_TYPES } from "./inventoryTypes";
import { TEX_SCALE } from "./menuLayout";
import { useStageContextMenu } from "./useStageContextMenu";

it("keeps a menu + command selection when its context menu opens over a slot", () => {
  const project = {
    documents: {
      menu: [{ id: "a", rows: 3, layers: [] }],
      command: [{ id: "cmd" }],
    },
  } as unknown as Project;
  useSelectionStore.getState().set(["a", "cmd"]);
  const { result } = renderHook(() =>
    useStageContextMenu({
      project,
      layout: { a: { x: 0, y: 0 }, cmd: { x: 600, y: 0 } },
      viewport: { x: 0, y: 0, scale: 1 },
      wrapperRef: { current: document.createElement("div") },
      stageRef: { current: {} as Konva.Stage },
    }),
  );
  act(() =>
    result.current.openContextMenuAt(
      INVENTORY_TYPES.chest.firstSlotX * TEX_SCALE + 1,
      INVENTORY_TYPES.chest.firstSlotY * TEX_SCALE + 1,
    ),
  );
  expect(result.current.ctxMenu.target).toEqual({ kind: "entity", selectedIds: ["a", "cmd"] });
});

it("keeps a multiple-menu selection when its context menu opens over a slot", () => {
  const project = {
    documents: {
      menu: [
        { id: "a", rows: 3, layers: [] },
        { id: "b", rows: 3, layers: [] },
      ],
    },
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

it("keeps a multiple-item selection when its context menu opens over one of the items", () => {
  const project = {
    documents: {
      menu: [
        {
          id: "a",
          rows: 3,
          layers: [
            {
              elements: [
                { id: "x", positions: "0", display: { material: "STONE" } },
                { id: "y", positions: "1", display: { material: "DIRT" } },
              ],
            },
          ],
        },
      ],
    },
  } as unknown as Project;
  useSelectionStore.getState().set(["x", "y"]);
  const { result } = renderHook(() =>
    useStageContextMenu({
      project,
      layout: { a: { x: 0, y: 0 } },
      viewport: { x: 0, y: 0, scale: 1 },
      wrapperRef: { current: document.createElement("div") },
      stageRef: { current: {} as Konva.Stage },
    }),
  );
  act(() =>
    result.current.openContextMenuAt(
      INVENTORY_TYPES.chest.firstSlotX * TEX_SCALE + 1,
      INVENTORY_TYPES.chest.firstSlotY * TEX_SCALE + 1,
    ),
  );
  expect(result.current.ctxMenu.target).toEqual({ kind: "entity", selectedIds: ["x", "y"] });
});

it("keeps the selection on a background right-click, with the point to create at", () => {
  const project = {
    documents: { menu: [{ id: "a", rows: 3, layers: [] }] },
  } as unknown as Project;
  useSelectionStore.getState().set(["a"]);
  const stage = {} as Konva.Stage;
  const { result } = renderHook(() =>
    useStageContextMenu({
      project,
      layout: { a: { x: 0, y: 0 } },
      viewport: { x: 0, y: 0, scale: 1 },
      wrapperRef: { current: document.createElement("div") },
      stageRef: { current: stage },
    }),
  );
  act(() => result.current.openContextMenuAt(5000, 4000, stage));
  expect(result.current.ctxMenu.target).toEqual({
    kind: "entity",
    selectedIds: ["a"],
    world: { x: 5000, y: 4000 },
  });
});
