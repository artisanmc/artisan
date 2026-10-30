import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import type { OverlaySlotDeclaration } from "@artisan/editor-sdk";
import { readOverlayLayout } from "@artisan/editor-sdk";
import { OverlayComposer, clampY, writeEntry } from "./OverlayComposer";

const SLOTS: OverlaySlotDeclaration[] = [
  { name: "name", kind: "text", label: "Nom" },
  { name: "lines", kind: "text", label: "Texte" },
  { name: "choices", kind: "list", label: "Réponses" },
  { name: "portrait", kind: "image_slot", label: "Portrait" },
];

const LAYOUT = [
  { image: "box", x: -130, y: -92, note: "kept" },
  { text: "name", x: -120, y: -86, width: 240 },
  { list: "choices", x: -110, y: -31, width: 230, lines: 3 },
  { text: "" },
];

function setup(value: unknown = LAYOUT) {
  const onChange = vi.fn();
  render(<OverlayComposer projectId="p1" value={value} onChange={onChange} slots={SLOTS} />);
  return onChange;
}

describe("OverlayComposer", () => {
  it("lists every entry, an unreadable one with its problem, and offers the slots not placed", () => {
    setup();
    expect(screen.getByRole("button", { name: /^box\s*Image$/ })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /^Nom\s*Texte$/ })).toBeInTheDocument();
    expect(screen.getByText("Entrée illisible")).toBeInTheDocument();
    expect(screen.getByText(/missing_name/)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Texte" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Portrait" })).toBeInTheDocument();
    // The list placed: only its handle on the screen, no button to add it again.
    expect(screen.getAllByRole("button", { name: "Réponses" })).toHaveLength(1);
  });

  it("adds a slot not placed yet at the end of the list", () => {
    const onChange = setup();
    fireEvent.click(screen.getByRole("button", { name: "Portrait" }));
    expect(onChange).toHaveBeenCalledWith([
      ...LAYOUT,
      { image_slot: "portrait", x: -180, y: 8, anchor: "bottom" },
    ]);
  });

  it("writes a number typed in the panel over the entry, its other keys kept", () => {
    const onChange = setup();
    fireEvent.click(screen.getByRole("button", { name: /^box\s*Image$/ }));
    fireEvent.change(screen.getByLabelText("X"), { target: { value: "-100" } });
    expect(onChange).toHaveBeenLastCalledWith([
      { note: "kept", image: "box", x: -100, y: -92 },
      ...LAYOUT.slice(1),
    ]);
  });

  it("moves a layer dragged on the screen once, on release, by GUI pixels", () => {
    const onChange = setup();
    // 854×480 at GUI scale Auto is 2: 20 window px are 10 GUI px.
    const hit = screen.getByRole("button", { name: "Nom" });
    fireEvent.pointerDown(hit, { button: 0, pointerId: 1, clientX: 100, clientY: 100 });
    fireEvent.pointerMove(hit, { pointerId: 1, clientX: 120, clientY: 110 });
    expect(onChange).not.toHaveBeenCalled();
    fireEvent.pointerUp(hit, { pointerId: 1 });
    expect(onChange).toHaveBeenCalledTimes(1);
    expect(onChange.mock.calls[0]![0][1]).toEqual({ text: "name", x: -110, y: -81, width: 240 });
  });

  it("nudges the selected layer with the arrow keys, by 10 with Shift", () => {
    const onChange = setup();
    fireEvent.click(screen.getByRole("button", { name: /^box\s*Image$/ }));
    const stage = screen.getByLabelText(/Aperçu du HUD/);
    fireEvent.keyDown(stage, { key: "ArrowUp" });
    expect(onChange.mock.calls[0]![0][0]).toMatchObject({ x: -130, y: -93 });
    fireEvent.keyDown(stage, { key: "ArrowRight", shiftKey: true });
    expect(onChange.mock.calls[1]![0][0]).toMatchObject({ x: -120, y: -92 });
  });
});

describe("writeEntry", () => {
  it("replaces the layer's keys, drops a default, keeps the rest", () => {
    const [layer] = readOverlayLayout([{ text: "t", x: 0, y: 0, width: 10, lines: 2 }]).layers;
    if (layer?.kind !== "text") throw new Error("a text layer");
    const entry = { text: "t", x: 0, y: 0, width: 10, lines: 2, comment: "hi" };
    expect(writeEntry(entry, { ...layer, lines: 1 })).toEqual({
      comment: "hi",
      text: "t",
      x: 0,
      y: 0,
      width: 10,
    });
  });
});

describe("clampY", () => {
  it("keeps every row and the cursor of a layer within the pack's reach", () => {
    const [text, list] = readOverlayLayout([
      { text: "t", x: 0, y: 0, width: 10, lines: 3 },
      { list: "l", x: 0, y: 0, width: 10, lines: 2, cursor: { image: "c", x: 0, y: -4 } },
    ]).layers;
    expect(clampY(text!, 200)).toBe(166 - 22);
    expect(clampY(text!, -200)).toBe(-128);
    expect(clampY(list!, -200)).toBe(-124);
    expect(clampY(list!, 0)).toBe(0);
  });
});
