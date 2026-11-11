import { useUiStore } from "@/state/uiStore";
import { fireEvent, render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it } from "vitest";
import { CanvasToolbar } from "./CanvasToolbar";

describe("CanvasToolbar", () => {
  it("leaves the minimap toggle to the library tools", () => {
    render(<CanvasToolbar />);
    expect(screen.queryByRole("button", { name: /minimap/i })).toBeNull();
  });
  beforeEach(() => useUiStore.setState({ canvasMode: "select" }));
  it("renders the 2 modes and marks the active one via aria-pressed", () => {
    render(<CanvasToolbar />);
    const sel = screen.getByRole("button", { name: /select|sélection/i });
    const hand = screen.getByRole("button", { name: /pan|navigation/i });
    expect(sel).toHaveAttribute("aria-pressed", "true");
    expect(hand).toHaveAttribute("aria-pressed", "false");
  });
  it("clicking a mode selects it", () => {
    render(<CanvasToolbar />);
    fireEvent.click(screen.getByRole("button", { name: /pan|navigation/i }));
    expect(useUiStore.getState().canvasMode).toBe("hand");
  });
  it("offers the modes dropdown when onRearrange is provided", () => {
    render(<CanvasToolbar onRearrange={() => {}} />);
    expect(screen.getByRole("button", { name: /rearrange|réarranger/i })).toBeInTheDocument();
  });
});
