import { describe, expect, it } from "vitest";
import { revealViewport, tweenViewport } from "./camera";

const view = { w: 1000, h: 800 };
const menu = { x: 0, y: 0, width: 352, height: 444 };

describe("revealViewport", () => {
  it("does not move when the Document is already fully visible", () => {
    expect(revealViewport(view, menu, { x: 100, y: 100, scale: 1 })).toBeNull();
  });

  it("centres an off-screen Document at the current scale", () => {
    const far = { ...menu, x: 3000, y: 2000 };
    const next = revealViewport(view, far, { x: 0, y: 0, scale: 0.8 });
    expect(next?.scale).toBe(0.8);
    // Le centre de la boîte tombe au centre de la vue.
    expect(next!.x + (far.x + far.width / 2) * next!.scale).toBeCloseTo(view.w / 2);
    expect(next!.y + (far.y + far.height / 2) * next!.scale).toBeCloseTo(view.h / 2);
  });

  it("moves when the Document is only partly visible", () => {
    expect(revealViewport(view, menu, { x: -200, y: 100, scale: 1 })).not.toBeNull();
  });

  it("zooms out when the Document cannot fit, never in", () => {
    const zoomedIn = revealViewport(view, { ...menu, x: 5000 }, { x: 0, y: 0, scale: 3 });
    expect(zoomedIn!.scale).toBeCloseTo((view.h - 96) / menu.height);
    const zoomedOut = revealViewport(view, { ...menu, x: 5000 }, { x: 0, y: 0, scale: 0.3 });
    expect(zoomedOut!.scale).toBe(0.3);
  });
});

describe("tweenViewport", () => {
  it("starts at the origin and ends at the target", () => {
    const a = { x: 0, y: 0, scale: 1 };
    const b = { x: 100, y: -50, scale: 0.5 };
    expect(tweenViewport(a, b, 0)).toEqual(a);
    expect(tweenViewport(a, b, 1)).toEqual(b);
  });
});
