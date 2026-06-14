import { describe, expect, it } from "vitest";
import type { Pack, PackId } from "@/domain/types";
import { useAccountStore } from "@/state/accountStore";
import { useAlignmentStore } from "@/state/alignmentStore";
import { computeAndApplyAlignment } from "./useNodeAlignment";

const PID = "p1" as PackId;
function seed() {
  useAccountStore.setState({ account: { id: "a" as any, packOrder: [PID], packs: [{
    id: PID, name: "p", source: "user_created", createdAt: "", updatedAt: "",
    menus: [{ id: "m1", packId: PID, title: [], rows: 3, layers: [] } as any,
            { id: "m2", packId: PID, title: [], rows: 3, layers: [] } as any],
    commands: [], dialogs: [], templates: [], assets: [], dataSources: [], importedConnectors: [],
    i18nKeys: {}, defaultLang: "en", canvasLayout: { m1: { x: 100, y: 100 }, m2: { x: 104, y: 600 } } as any,
  } as Pack] } } as any);
}
function fakeNode(x0: number, y0: number) {
  let nx = x0, ny = y0;
  return { x: (v?: number) => (v === undefined ? nx : ((nx = v), nx)), y: (v?: number) => (v === undefined ? ny : ((ny = v), ny)) };
}
describe("computeAndApplyAlignment", () => {
  it("snappe le nœud et publie des guides (Alt off)", () => {
    seed(); useAlignmentStore.getState().clear();
    const node = fakeNode(104, 600);
    computeAndApplyAlignment(PID, "m2", node as any, false);
    expect(node.x()).toBe(100); // aligné sur m1.left (diff 4 <= threshold)
    expect(useAlignmentStore.getState().guides.length).toBeGreaterThan(0);
  });
  it("Alt on → pas de snap ni guide", () => {
    seed(); useAlignmentStore.getState().clear();
    const node = fakeNode(104, 600);
    computeAndApplyAlignment(PID, "m2", node as any, true);
    expect(node.x()).toBe(104);
    expect(useAlignmentStore.getState().guides).toEqual([]);
  });
});
