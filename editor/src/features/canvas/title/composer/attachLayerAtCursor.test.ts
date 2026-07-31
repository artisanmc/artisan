import { describe, expect, it } from "vitest";

import type { MenuId, Project, ProjectId } from "@/domain/types";
import type { StageGeometry } from "../../stageGeometry";

import { attachLayerAtCursor } from "./attachLayerAtCursor";

const PACK_ID = "p1" as ProjectId;
const MENU_A = "menu_a" as MenuId;
const MENU_B = "menu_b" as MenuId;

function project(canvasLayout: Record<string, { x: number; y: number }>): Project {
  return {
    id: PACK_ID,
    name: "p",
    source: "user_created",
    createdAt: "",
    updatedAt: "",
    menus: [
      { id: MENU_A, projectId: PACK_ID, title: [], rows: 3, layers: [] },
      { id: MENU_B, projectId: PACK_ID, title: [], rows: 3, layers: [] },
    ],
    commands: [],
    dialogs: [],
    assets: [],
    dataSources: [],
    importedConnectors: [],
    i18nKeys: {},
    defaultLang: "en",
    canvasLayout,
  } as any;
}

// Identity viewport + a 1000×700 wrapper anchored at (0, 0). Keeps the
// arithmetic in these tests trivially auditable.
const geometry: StageGeometry = {
  wrapperRect: { left: 0, top: 0, right: 1000, bottom: 700 },
  viewport: { x: 0, y: 0, scale: 1 },
};

describe("attachLayerAtCursor", () => {
  it("returns the menu id + layer-local MC px when cursor is on menu A's title bar", () => {
    // Menu A's origin is (40, 40) — its title-bar center sits at
    // (40 + 352/2, 40 + 34/2) = (216, 57). Cursor at (220, 50) → local
    // canvas (180, 10) → MC px (90, 5).
    const p = project({
      [MENU_A]: { x: 40, y: 40 },
      [MENU_B]: { x: 800, y: 40 },
    });
    const out = attachLayerAtCursor(p, geometry, { x: 220, y: 50 });
    expect(out).not.toBeNull();
    expect(out!.menuId).toBe(MENU_A);
    expect(out!.x).toBe(90);
    expect(out!.y).toBe(5);
  });

  it("picks menu B when the cursor is far closer to its title-bar center", () => {
    const p = project({
      [MENU_A]: { x: 40, y: 40 },
      [MENU_B]: { x: 600, y: 40 },
    });
    // Menu B's center = (600 + 176, 40 + 17) = (776, 57). Cursor right on top.
    const out = attachLayerAtCursor(p, geometry, { x: 776, y: 57 });
    expect(out!.menuId).toBe(MENU_B);
    expect(out!.x).toBe(88); // 776 - 600 = 176 → 88 MC px
    expect(out!.y).toBeCloseTo(8.5, 5); // 57 - 40 = 17 → 8.5 MC px
  });

  it("returns null when the cursor is farther than the threshold from every menu", () => {
    const p = project({
      [MENU_A]: { x: 0, y: 0 },
      [MENU_B]: { x: 0, y: 0 },
    });
    // Both menus' centers sit at (176, 17). Cursor at (900, 600) is well
    // beyond NEAREST_MENU_THRESHOLD_PX (200).
    const out = attachLayerAtCursor(p, geometry, { x: 900, y: 600 });
    expect(out).toBeNull();
  });

  it("respects the viewport transform (pan + scale)", () => {
    const p = project({
      [MENU_A]: { x: 0, y: 0 },
      [MENU_B]: { x: 600, y: 0 },
    });
    // Viewport panned by (100, 50) and scaled 2× — a screen cursor at
    // (452, 84) maps to canvas-space ((452-100)/2, (84-50)/2) = (176, 17)
    // which is exactly menu A's title-bar center.
    const panZoomGeometry: StageGeometry = {
      wrapperRect: { left: 0, top: 0, right: 2000, bottom: 1400 },
      viewport: { x: 100, y: 50, scale: 2 },
    };
    const out = attachLayerAtCursor(p, panZoomGeometry, { x: 452, y: 84 });
    expect(out!.menuId).toBe(MENU_A);
    expect(out!.x).toBe(88); // 176 / 2 = 88 MC px
    expect(out!.y).toBeCloseTo(8.5, 5);
  });

  it("ignores menus without an entry in canvasLayout (auto-layout fills them in)", () => {
    // No canvas layout — autoLayout assigns positions by index.
    const p = project({});
    const out = attachLayerAtCursor(p, geometry, { x: 5000, y: 5000 });
    // Far outside any auto-laid menu → null.
    expect(out).toBeNull();
  });
});
