import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import type { OverlaySlotDeclaration } from "@artisan/editor-sdk";
import { OverlaySlotsComposer, readFill } from "./OverlaySlotsComposer";

const SLOTS: OverlaySlotDeclaration[] = [
  { name: "name", kind: "text", label: "Nom" },
  { name: "portrait", kind: "image_slot", label: "Portrait" },
  { name: "badge", kind: "image_slot", label: "Insigne" },
];

const LAYOUT = [
  { image: "box", x: -130, y: -92 },
  { text: "name", x: -120, y: -86, width: 240 },
  { image_slot: "portrait", x: -190, y: 8, anchor: "bottom", default: "inconnu" },
  { image_slot: "badge", x: 100, y: -100 },
];

function setup(value: unknown = { portrait: { image: "marthe", x: 2 } }) {
  const onChange = vi.fn();
  render(
    <OverlaySlotsComposer
      projectId="p1"
      layout={LAYOUT}
      value={value}
      onChange={onChange}
      slots={SLOTS}
    />,
  );
  return onChange;
}

const zones = () =>
  screen
    .getAllByRole("button")
    .filter((b) => b.classList.contains("cursor-move"))
    .map((b) => b.getAttribute("aria-label"));

describe("OverlaySlotsComposer", () => {
  it("opens the image slots only: the mode's other layers draw but cannot be picked", () => {
    setup({});
    expect(zones()).toEqual(["Portrait", "Insigne"]);
    expect(screen.getByText("Sans image, le mode dessine inconnu.")).toBeInTheDocument();
    expect(screen.getByText("Sans image, rien n'est dessiné ici.")).toBeInTheDocument();
  });

  it("moves a given image by an offset from its slot, once, on release", () => {
    const onChange = setup();
    // 854×480 at GUI scale Auto is 2: 20 window px are 10 GUI px.
    const hit = screen.getByRole("button", { name: "Portrait" });
    fireEvent.pointerDown(hit, { button: 0, pointerId: 1, clientX: 100, clientY: 100 });
    fireEvent.pointerMove(hit, { pointerId: 1, clientX: 120, clientY: 90 });
    expect(onChange).not.toHaveBeenCalled();
    fireEvent.pointerUp(hit, { pointerId: 1 });
    expect(onChange).toHaveBeenCalledTimes(1);
    expect(onChange).toHaveBeenCalledWith({ portrait: { image: "marthe", x: 12, y: -5 } });
  });

  it("does not move a slot that shows its default", () => {
    const onChange = setup({});
    const hit = screen.getByRole("button", { name: "Portrait" });
    fireEvent.pointerDown(hit, { button: 0, pointerId: 1, clientX: 100, clientY: 100 });
    fireEvent.pointerMove(hit, { pointerId: 1, clientX: 140, clientY: 100 });
    fireEvent.pointerUp(hit, { pointerId: 1 });
    expect(onChange).not.toHaveBeenCalled();
  });

  it("puts an image back where the mode has its slot", () => {
    const onChange = setup({ portrait: { image: "marthe", x: 2, y: -6 }, other: "kept" });
    fireEvent.click(screen.getByRole("button", { name: "Revenir à la position du mode" }));
    expect(onChange).toHaveBeenCalledWith({ portrait: { image: "marthe" }, other: "kept" });
  });

  it("keeps the offset within the pack's reach", () => {
    const onChange = setup({ badge: { image: "star" } });
    fireEvent.change(screen.getByLabelText("Décalage Y"), { target: { value: "-100" } });
    // The slot's top at -100: 28 px higher reaches the limit, -128.
    expect(onChange).toHaveBeenLastCalledWith({ badge: { image: "star", y: -28 } });
  });
});

describe("readFill", () => {
  it("reads an asset alone or with its offset, and nothing else", () => {
    expect(readFill({ p: "marthe" }, "p")).toEqual({ image: "marthe", x: 0, y: 0 });
    expect(readFill({ p: { image: "marthe", x: 3, y: -6 } }, "p")).toEqual({
      image: "marthe",
      x: 3,
      y: -6,
    });
    expect(readFill({ p: { image: "", x: 3 } }, "p")).toBeNull();
    expect(readFill({ p: { image: "m", x: 1.5 } }, "p")).toEqual({ image: "m", x: 0, y: 0 });
    expect(readFill(undefined, "p")).toBeNull();
  });
});
