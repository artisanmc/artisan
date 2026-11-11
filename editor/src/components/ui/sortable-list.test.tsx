import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { SortableList } from "./sortable-list";

function rows(ids: string[], onMove = vi.fn()) {
  return render(
    <SortableList ids={ids} onMove={onMove} handleLabel="Reorder">
      {(index, handle) => (
        <>
          {handle}
          <span>{ids[index]}</span>
        </>
      )}
    </SortableList>,
  );
}

describe("SortableList", () => {
  it("renders one row per id, each with its drag handle", () => {
    rows(["a", "b", "c"]);
    expect(screen.getAllByRole("listitem").map((li) => li.textContent)).toEqual(["a", "b", "c"]);
    expect(screen.getAllByRole("button", { name: "Reorder" })).toHaveLength(3);
  });

  it("lifts a row with the keyboard and drops it one place lower", async () => {
    const onMove = vi.fn();
    rows(["a", "b", "c"], onMove);
    // jsdom lays nothing out: give each row a box, one under the other.
    screen.getAllByRole("listitem").forEach((li, i) => {
      li.getBoundingClientRect = () =>
        ({
          x: 0,
          y: i * 40,
          top: i * 40,
          left: 0,
          width: 200,
          height: 40,
          right: 200,
          bottom: i * 40 + 40,
          toJSON: () => ({}),
        }) as DOMRect;
    });
    const handle = screen.getAllByRole("button", { name: "Reorder" })[0]!;
    handle.focus();
    fireEvent.keyDown(handle, { code: "Space" });
    await new Promise((r) => setTimeout(r, 0));
    fireEvent.keyDown(document, { code: "ArrowDown" });
    await new Promise((r) => setTimeout(r, 0));
    fireEvent.keyDown(document, { code: "Space" });
    await new Promise((r) => setTimeout(r, 0));
    expect(onMove).toHaveBeenCalledWith(0, 1);
  });
});
