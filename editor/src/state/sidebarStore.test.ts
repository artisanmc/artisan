import { describe, expect, it } from "vitest";
import { SIDEBAR_WIDTH, clampSidebarWidth, useSidebarStore } from "./sidebarStore";

describe("sidebar width", () => {
  it("clamps to the bounds and rounds", () => {
    expect(clampSidebarWidth(10)).toBe(SIDEBAR_WIDTH.min);
    expect(clampSidebarWidth(9999)).toBe(SIDEBAR_WIDTH.max);
    expect(clampSidebarWidth(300.6)).toBe(301);
  });

  it("persists the width next to the pinned state", () => {
    useSidebarStore.getState().setWidth(333);
    const stored = JSON.parse(localStorage.getItem("artisan-navigation") ?? "{}");
    expect(stored.state).toMatchObject({ width: 333 });
  });

  it("brings an out-of-range stored width back inside the bounds", async () => {
    localStorage.setItem(
      "artisan-navigation",
      JSON.stringify({ state: { pinned: true, width: 4000 }, version: 0 }),
    );
    await useSidebarStore.persist.rehydrate();
    expect(useSidebarStore.getState().width).toBe(SIDEBAR_WIDTH.max);
    expect(useSidebarStore.getState().pinned).toBe(true);
  });
});
