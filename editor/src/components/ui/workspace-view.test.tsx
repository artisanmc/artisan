import { fireEvent, render, screen } from "@testing-library/react";
import { useState } from "react";
import { describe, expect, it } from "vitest";
import { WorkspaceView } from "./workspace-view";

/** Stateful child — its counter proves the content survives leave/return. */
function Counter() {
  const [n, setN] = useState(0);
  return (
    <button type="button" onClick={() => setN(n + 1)}>
      count:{n}
    </button>
  );
}

function Harness() {
  const [active, setActive] = useState(false);
  return (
    <div className="relative">
      <button type="button" onClick={() => setActive(true)}>
        open-view
      </button>
      <WorkspaceView active={active} onExit={() => setActive(false)} title="Test">
        <Counter />
      </WorkspaceView>
    </div>
  );
}

describe("WorkspaceView keep-alive", () => {
  it("renders nothing before the first activation", () => {
    render(<Harness />);
    expect(screen.queryByText(/count:/)).toBeNull();
    expect(screen.queryByTestId("workspace-view")).toBeNull();
  });

  it("keeps the content's state across leave/return", () => {
    render(<Harness />);
    fireEvent.click(screen.getByText("open-view"));
    fireEvent.click(screen.getByText("count:0"));
    expect(screen.getByText("count:1")).toBeInTheDocument();

    // Leave (Esc) — content stays mounted, hidden.
    fireEvent.keyDown(document, { key: "Escape" });
    // Return: the counter kept its value instead of resetting to 0.
    fireEvent.click(screen.getByText("open-view"));
    expect(screen.getByText("count:1")).toBeInTheDocument();
  });

  it("carries the `hidden` class when inactive (canvas shows through)", () => {
    render(<Harness />);
    fireEvent.click(screen.getByText("open-view"));
    expect(screen.getByTestId("workspace-view").className).not.toContain("hidden");
    fireEvent.keyDown(document, { key: "Escape" });
    expect(screen.getByTestId("workspace-view").className).toContain("hidden");
  });

  it("close button exits", () => {
    render(<Harness />);
    fireEvent.click(screen.getByText("open-view"));
    fireEvent.click(screen.getByLabelText("Close"));
    expect(screen.getByTestId("workspace-view").className).toContain("hidden");
  });
});
