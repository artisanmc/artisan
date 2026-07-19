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
});
