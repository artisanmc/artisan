import { describe, expect, it } from "vitest";
import vector from "../../../../../testdata/mc-screen-conformance.json";
import {
  MC_SCREEN_PRESETS,
  bossBarAt,
  centeredScreen,
  guiScale,
  hotbarSelection,
  maxGuiScale,
  mcScreenLayout,
} from "./mcScreen";

describe("guiScale", () => {
  it.each(vector.scales)(
    "$window at $choice → $scale",
    ({ window: [w, h], choice, scale, gui }) => {
      const s = guiScale(w!, h!, choice as "auto" | number);
      expect(s).toBe(scale);
      const layout = mcScreenLayout(w!, h!, s);
      expect([layout.width, layout.height]).toEqual(gui);
    },
  );

  it("keeps every preset's GUI at least 320×240", () => {
    for (const { width, height } of MC_SCREEN_PRESETS) {
      const layout = mcScreenLayout(width, height, maxGuiScale(width, height));
      expect(layout.width).toBeGreaterThanOrEqual(320);
      expect(layout.height).toBeGreaterThanOrEqual(240);
    }
  });
});

describe("mcScreenLayout", () => {
  it.each(vector.layouts)("$window at ×$scale", (c) => {
    const layout = mcScreenLayout(c.window[0]!, c.window[1]!, c.scale);
    expect(layout).toMatchObject({
      centerX: c.centerX,
      hotbar: c.hotbar,
      xpBar: c.xpBar,
      statusTop: c.statusTop,
      actionBarTop: c.actionBarTop,
      titleTop: c.titleTop,
      subtitleTop: c.subtitleTop,
      chatBottom: c.chatBottom,
      chatInput: c.chatInput,
    });
    expect(hotbarSelection(layout, c.selection.slot)).toEqual(c.selection.rect);
    for (const b of c.bossBars) {
      const at = bossBarAt(layout, b.index);
      if (b.bar === null) expect(at).toBeNull();
      else expect(at).toEqual({ bar: b.bar, nameTop: b.nameTop });
    }
    for (const s of c.screens) {
      expect(centeredScreen(layout, s.size[0]!, s.size[1]!)).toEqual(s.rect);
    }
  });
});
