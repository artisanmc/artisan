import { fireEvent, render, screen } from "@testing-library/react";
import { useState } from "react";
import { describe, expect, it } from "vitest";
import { WorkspaceOverlay } from "./workspace-overlay";

/** Stateful child — its counter proves the content survives close/reopen. */
function Counter() {
  const [n, setN] = useState(0);
  return (
    <button type="button" onClick={() => setN(n + 1)}>
      count:{n}
    </button>
  );
}

function Harness() {
  const [open, setOpen] = useState(false);
  return (
    <>
      <button type="button" onClick={() => setOpen(true)}>
        open-overlay
      </button>
      <WorkspaceOverlay open={open} onClose={() => setOpen(false)} title="Test">
        <Counter />
      </WorkspaceOverlay>
    </>
  );
}

describe("WorkspaceOverlay keep-alive", () => {
  it("renders nothing before the first open", () => {
    render(<Harness />);
    expect(screen.queryByText(/count:/)).toBeNull();
  });

  it("keeps the content's state across close/reopen", () => {
    render(<Harness />);
    fireEvent.click(screen.getByText("open-overlay"));
    const counter = screen.getByText("count:0");
    fireEvent.click(counter);
    expect(screen.getByText("count:1")).toBeInTheDocument();

    // Close (Esc) — content stays mounted, hidden.
    fireEvent.keyDown(document, { key: "Escape" });
    // Reopen: the counter kept its value instead of resetting to 0.
    fireEvent.click(screen.getByText("open-overlay"));
    expect(screen.getByText("count:1")).toBeInTheDocument();
  });

  it("closed overlay does not block clicks on the page (no modal lock)", () => {
    render(<Harness />);
    fireEvent.click(screen.getByText("open-overlay"));
    fireEvent.keyDown(document, { key: "Escape" });
    // The trigger is reachable and clickable again after closing.
    fireEvent.click(screen.getByText("open-overlay"));
    expect(screen.getByText("count:0")).toBeInTheDocument();
    // The hidden wrapper carries the `hidden` class (display:none) — nothing
    // invisible sits above the page.
    fireEvent.keyDown(document, { key: "Escape" });
    const backdrop = screen.getByTestId("workspace-overlay-backdrop");
    expect(backdrop.parentElement?.className).toContain("hidden");
  });

  it("backdrop click closes", () => {
    render(<Harness />);
    fireEvent.click(screen.getByText("open-overlay"));
    fireEvent.click(screen.getByTestId("workspace-overlay-backdrop"));
    expect(screen.getByTestId("workspace-overlay-backdrop").parentElement?.className).toContain(
      "hidden",
    );
  });
});
