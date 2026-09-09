import { act, render, screen } from "@testing-library/react";
import { expect, it, vi } from "vitest";
import { SplitPane } from "./SplitPane";

it("retains an inert pane until its exit completes and preserves the canvas", () => {
  vi.useFakeTimers();
  try {
    const pane = (open: boolean) => (
      <SplitPane
        animatePresence
        orientation="horizontal"
        primary={<div>Canvas</div>}
        secondary={open ? <button type="button">Item</button> : null}
        secondarySize={300}
        onSecondarySizeChange={() => {}}
      />
    );
    const view = render(pane(true));
    const canvas = screen.getByText("Canvas");
    view.rerender(pane(false));
    expect(screen.getByText("Item").closest("[inert]")).not.toBeNull();
    expect(screen.queryByRole("button", { name: "Item" })).toBeNull();
    act(() => vi.advanceTimersByTime(220));
    expect(screen.queryByText("Item")).toBeNull();
    expect(screen.getByText("Canvas")).toBe(canvas);
  } finally {
    vi.useRealTimers();
  }
});
