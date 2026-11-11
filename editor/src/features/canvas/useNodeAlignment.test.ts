import type { Project, ProjectId } from "@/domain/types";
import { useAlignmentStore } from "@/state/alignmentStore";
import { useProjectsStore } from "@/state/projectsStore";
import { renderHook } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { computeAndApplyAlignment, useNodeAlignment } from "./useNodeAlignment";

const PID = "p1" as ProjectId;
function seed() {
  useProjectsStore.setState({
    openProjects: {
      projectOrder: [PID],
      projects: [
        {
          id: PID,
          name: "p",
          source: "user_created",
          createdAt: "",
          updatedAt: "",
          documents: {
            menu: [
              { id: "m1", projectId: PID, title: [], rows: 3, layers: [] } as any,
              { id: "m2", projectId: PID, title: [], rows: 3, layers: [] } as any,
            ],
            command: [],
            dialog: [],
          },
          assets: [],
          dataSources: [],
          importedConnectors: [],
          i18nKeys: {},
          defaultLang: "en",
          canvasLayout: { "menu/m1": { x: 100, y: 100 }, "menu/m2": { x: 104, y: 600 } } as any,
        } as Project,
      ],
    },
  } as any);
}
function fakeNode(x0: number, y0: number) {
  let nx = x0;
  let ny = y0;
  return {
    x: (v?: number) => {
      if (v !== undefined) nx = v;
      return nx;
    },
    y: (v?: number) => {
      if (v !== undefined) ny = v;
      return ny;
    },
  };
}
describe("computeAndApplyAlignment", () => {
  it("snaps the node and publishes guides (Alt off)", () => {
    seed();
    useAlignmentStore.getState().clear();
    const node = fakeNode(104, 600);
    computeAndApplyAlignment(PID, "menu/m2", node as any, false);
    expect(node.x()).toBe(100); // aligned on m1.left (diff 4 <= threshold)
    expect(useAlignmentStore.getState().guides.length).toBeGreaterThan(0);
  });
  it("Alt on → no snap and no guide", () => {
    seed();
    useAlignmentStore.getState().clear();
    const node = fakeNode(104, 600);
    computeAndApplyAlignment(PID, "menu/m2", node as any, true);
    expect(node.x()).toBe(104);
    expect(useAlignmentStore.getState().guides).toEqual([]);
  });
});

describe("useNodeAlignment.onDragMove", () => {
  it("ignores events bubbled from a child (target.id != selfId)", () => {
    seed();
    useAlignmentStore.getState().clear();
    const { result } = renderHook(() => useNodeAlignment(PID, "menu/m2"));
    let nx = 104;
    let ny = 600;
    const slotNode = {
      id: () => "some_slot",
      x: (v?: number) => {
        if (v !== undefined) nx = v;
        return nx;
      },
      y: (v?: number) => {
        if (v !== undefined) ny = v;
        return ny;
      },
    };
    result.current.onDragMove({ target: slotNode, evt: { altKey: false } } as any);
    expect(nx).toBe(104); // no snap (event ignored)
    expect(useAlignmentStore.getState().guides).toEqual([]);
  });

  it("acts when target.id === selfId", () => {
    seed();
    useAlignmentStore.getState().clear();
    const { result } = renderHook(() => useNodeAlignment(PID, "menu/m2"));
    let nx = 104;
    let ny = 600;
    const menuNode = {
      id: () => "menu/m2",
      x: (v?: number) => {
        if (v !== undefined) nx = v;
        return nx;
      },
      y: (v?: number) => {
        if (v !== undefined) ny = v;
        return ny;
      },
    };
    result.current.onDragMove({ target: menuNode, evt: { altKey: false } } as any);
    expect(nx).toBe(100); // snap applied (m1.left)
  });
});
